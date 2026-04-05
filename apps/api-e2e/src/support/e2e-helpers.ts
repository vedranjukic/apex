/**
 * Shared helpers for e2e tests that interact with real sandboxes.
 *
 * The agent WebSocket is a native Elysia WS at /ws/agent (NOT Socket.IO).
 * Messages use the JSON protocol: { type: string, payload: any }.
 */
import axios from 'axios';
import WebSocket from 'ws';
import { execSync } from 'child_process';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const wsUrl = `ws://${host}:${port}/ws/agent`;

// ── Types ────────────────────────────────────────────

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  _streaming?: boolean;
}

export interface AgentEvent {
  type: string;
  subtype?: string;
  message?: {
    type?: string;
    role?: string;
    content?: ContentBlock[];
    model?: string;
    stop_reason?: string;
  };
  session_id?: string;
  is_error?: boolean;
  total_cost_usd?: number;
}

export interface StatusEvent {
  threadId: string;
  status: string;
}

/**
 * Thin wrapper around a native WebSocket that speaks the Elysia agent
 * protocol ({ type, payload } JSON messages) and dispatches events by type.
 */
export class AgentSocket {
  private ws: WebSocket;
  private listeners = new Map<string, Set<(payload: any) => void>>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        const type = msg.type as string;
        const payload = msg.payload ?? msg;
        const handlers = this.listeners.get(type);
        if (handlers) {
          for (const fn of handlers) fn(payload);
        }
        const star = this.listeners.get('*');
        if (star) {
          for (const fn of star) fn({ type, payload });
        }
      } catch { /* ignore non-JSON */ }
    });
  }

  send(type: string, payload: Record<string, unknown>) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  on(type: string, fn: (payload: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  off(type: string, fn: (payload: any) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  disconnect() {
    try { this.ws.close(); } catch { /* ignore */ }
  }

  get connected() {
    return this.ws.readyState === WebSocket.OPEN;
  }
}

// ── Project helpers ──────────────────────────────────

export async function createProject(
  name: string,
  agentType = 'build',
  provider?: string,
): Promise<string> {
  const body: Record<string, string> = { name, agentType };
  if (provider) body.provider = provider;
  const res = await axios.post('/api/projects', body);
  expect([200, 201]).toContain(res.status);
  return res.data.id;
}

/**
 * Wait for the API server's sandbox managers to finish initializing.
 * On startup the API re-initializes managers multiple times; creating
 * a project during re-init causes a race condition (manager is undefined).
 */
export async function waitForApiSettled(maxWaitMs = 15_000): Promise<void> {
  const start = Date.now();
  let successCount = 0;
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await axios.get('/api/projects');
      if (res.status === 200) successCount++;
      if (successCount >= 2) return;
    } catch {
      successCount = 0;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function waitForSandbox(
  projectId: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await axios.get(`/api/projects/${projectId}`);
    if (res.data.status === 'running' && res.data.sandboxId) return;
    if (res.data.status === 'error') {
      throw new Error(`Provision failed: ${res.data.statusError}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Sandbox did not become ready in time');
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    await axios.delete(`/api/projects/${projectId}`);
  } catch {
    // ignore cleanup errors
  }
}

// ── Socket helpers ───────────────────────────────────

export async function connectSocket(retries = 3): Promise<AgentSocket> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ws = new WebSocket(wsUrl);
      const agentSocket = await new Promise<AgentSocket>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket connect timeout'));
        }, 15_000);
        ws.on('open', () => {
          clearTimeout(timer);
          resolve(new AgentSocket(ws));
        });
        ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return agentSocket;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`[e2e] WebSocket connect attempt ${attempt}/${retries} failed, retrying...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('unreachable');
}

export function subscribeProject(
  socket: AgentSocket,
  projectId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('subscribed', onSubscribed);
      reject(new Error('subscribe_project timeout'));
    }, 30_000);
    const onSubscribed = () => {
      clearTimeout(timer);
      socket.off('subscribed', onSubscribed);
      resolve();
    };
    socket.on('subscribed', onSubscribed);
    socket.send('subscribe_project', { projectId });
  });
}

// ── Thread helpers ───────────────────────────────────

export async function createThread(
  projectId: string,
  prompt: string,
): Promise<string> {
  const res = await axios.post(`/api/projects/${projectId}/threads`, {
    prompt,
  });
  expect([200, 201]).toContain(res.status);
  return res.data.id;
}

export async function getThreadStatus(threadId: string): Promise<string> {
  const res = await axios.get(`/api/threads/${threadId}`);
  return res.data.status;
}

// ── Event collection ─────────────────────────────────

/**
 * Collect agent events until a `result` event arrives or timeout.
 * Also captures `agent_status` events in the returned statuses array.
 */
export function collectAgentEvents(
  socket: AgentSocket,
  threadId: string,
  timeoutMs = 120_000,
): Promise<{
  events: AgentEvent[];
  statuses: StatusEvent[];
}> {
  return new Promise((resolve) => {
    const events: AgentEvent[] = [];
    const statuses: StatusEvent[] = [];

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ events, statuses });
    }, timeoutMs);

    const onMessage = (payload: any) => {
      if (payload.threadId !== threadId) return;
      const ev = payload.message;
      if (!ev) return;
      events.push(ev);
      if (ev.type === 'result') {
        cleanup();
        resolve({ events, statuses });
      }
    };

    const onError = (payload: any) => {
      if (payload.threadId !== threadId) return;
      events.push({ type: 'error', subtype: payload.error });
      cleanup();
      resolve({ events, statuses });
    };

    const onStatus = (payload: any) => {
      if (payload.threadId !== threadId) return;
      statuses.push(payload);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('agent_message', onMessage);
      socket.off('agent_error', onError);
      socket.off('agent_status', onStatus);
    };

    socket.on('agent_message', onMessage);
    socket.on('agent_error', onError);
    socket.on('agent_status', onStatus);
  });
}

/**
 * Wait for the first agent_message event on a thread (any type).
 */
export function waitForFirstMessage(
  socket: AgentSocket,
  threadId: string,
  timeoutMs = 120_000,
): Promise<AgentEvent | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    const onMessage = (payload: any) => {
      if (payload.threadId !== threadId) return;
      if (!payload.message) return;
      cleanup();
      resolve(payload.message);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('agent_message', onMessage);
    };

    socket.on('agent_message', onMessage);
  });
}

/**
 * Wait for a specific agent_status value on a thread.
 */
export function waitForStatus(
  socket: AgentSocket,
  threadId: string,
  targetStatus: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const onStatus = (payload: any) => {
      if (payload.threadId !== threadId) return;
      if (payload.status === targetStatus) {
        cleanup();
        resolve(true);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('agent_status', onStatus);
    };

    socket.on('agent_status', onStatus);
  });
}

// ── SSH sandbox exec ─────────────────────────────────

export interface SshAccess {
  sshUser: string;
  sshHost: string;
  sshPort: number;
  sandboxId: string;
  remotePath: string;
  expiresAt: string;
}

/**
 * Create an SSH access token for a project's sandbox via the Apex API.
 * Returns connection details (user, host, port) for use with `execInSandbox`.
 */
export async function getSshAccess(projectId: string): Promise<SshAccess> {
  const res = await axios.post(`/api/projects/${projectId}/ssh-access`);
  expect([200, 201]).toContain(res.status);
  return res.data;
}

/**
 * Execute a command inside a Daytona sandbox via SSH and return clean stdout.
 * No PTY noise, no escape codes — just the command's output.
 * Throws with both stdout and stderr if the command fails.
 */
export function execInSandbox(
  ssh: SshAccess,
  command: string,
  timeoutMs = 30_000,
): string {
  const sshCmd =
    `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ` +
    `-o LogLevel=ERROR -o ConnectTimeout=10 ` +
    `-p ${ssh.sshPort} ${ssh.sshUser}@${ssh.sshHost} ${escapeShellArg(command)}`;
  try {
    return execSync(sshCmd, { encoding: 'utf-8', timeout: timeoutMs }).trim();
  } catch (err: any) {
    const stdout = (err.stdout ?? '').toString().trim();
    const stderr = (err.stderr ?? '').toString().trim();
    // Daytona SSH may close the channel with exit 255 even when the remote
    // command succeeded and produced output. Treat it as success if we have stdout.
    if (stdout && err.status === 255) {
      return stdout;
    }
    throw new Error(
      `SSH exec failed (exit ${err.status}): ${command}\n` +
        (stdout ? `stdout: ${stdout}\n` : '') +
        (stderr ? `stderr: ${stderr}` : ''),
    );
  }
}

/**
 * Execute multiple commands in parallel inside a sandbox via async SSH.
 * Uses child_process.exec (async) so commands actually run concurrently.
 */
export function execInSandboxParallel(
  ssh: SshAccess,
  commands: string[],
  timeoutMs = 30_000,
): Promise<string[]> {
  const { exec } = require('child_process');
  return Promise.all(
    commands.map(
      (command) =>
        new Promise<string>((resolve, reject) => {
          const sshCmd =
            `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ` +
            `-o LogLevel=ERROR -o ConnectTimeout=10 ` +
            `-p ${ssh.sshPort} ${ssh.sshUser}@${ssh.sshHost} ${escapeShellArg(command)}`;
          exec(sshCmd, { encoding: 'utf-8', timeout: timeoutMs }, (err: any, stdout: string, stderr: string) => {
            if (err) {
              // Daytona SSH may close with exit 255 even after successful output
              if (stdout?.trim() && err.code === 255) {
                resolve(stdout.trim());
              } else {
                reject(new Error(
                  `SSH exec failed (exit ${err.code}): ${command}\n` +
                    (stdout ? `stdout: ${stdout.trim()}\n` : '') +
                    (stderr ? `stderr: ${stderr.trim()}` : ''),
                ));
              }
            } else {
              resolve(stdout.trim());
            }
          });
        }),
    ),
  );
}

/**
 * Wait until a command succeeds in the sandbox (retries with delay).
 * Useful for waiting until the bridge tunnel / CA cert are ready.
 */
export async function waitForSandboxReady(
  ssh: SshAccess,
  maxWaitMs = 60_000,
): Promise<void> {
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < maxWaitMs) {
    try {
      // First try a simple SSH echo to verify connectivity
      const echo = execInSandbox(ssh, 'echo OK', 10_000);
      if (echo !== 'OK') {
        lastError = `SSH echo returned: ${echo}`;
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      // Check env and try curl
      const envCheck = execInSandbox(
        ssh,
        'echo "PROXY=$HTTPS_PROXY CA=$(test -f /usr/local/share/ca-certificates/apex-proxy.crt && echo YES || echo NO) TUNNEL=$(ss -tln 2>/dev/null | grep 9339 | head -1 || echo none)"',
        10_000,
      );
      console.log(`[waitForSandboxReady] env: ${envCheck}`);

      const result = execInSandbox(
        ssh,
        'curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://example.com 2>&1 || echo CURL_FAIL',
        20_000,
      );
      if (result === '200') return;
      lastError = `curl=${result} ${envCheck}`;
    } catch (err: any) {
      lastError = err.message?.slice(0, 200) || String(err);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    `Sandbox proxy/tunnel not ready after ${maxWaitMs}ms. Last: ${lastError}`,
  );
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// ── Content block utilities ──────────────────────────

export function findToolUseBlocks(
  events: AgentEvent[],
  toolName?: string,
): ContentBlock[] {
  const assistantEvents = events.filter((e) => e.type === 'assistant');
  const blocks: ContentBlock[] = [];
  for (const ae of assistantEvents) {
    for (const b of ae.message?.content ?? []) {
      if (b.type !== 'tool_use') continue;
      if (toolName && b.name !== toolName) continue;
      blocks.push(b);
    }
  }
  return blocks;
}

export function findToolResultBlocks(
  events: AgentEvent[],
  toolUseId?: string,
): ContentBlock[] {
  const assistantEvents = events.filter((e) => e.type === 'assistant');
  const blocks: ContentBlock[] = [];
  for (const ae of assistantEvents) {
    for (const b of ae.message?.content ?? []) {
      if (b.type !== 'tool_result') continue;
      if (toolUseId && b.tool_use_id !== toolUseId) continue;
      blocks.push(b);
    }
  }
  return blocks;
}

export function findTextContent(events: AgentEvent[]): string[] {
  const texts: string[] = [];
  for (const ae of events.filter((e) => e.type === 'assistant')) {
    for (const b of ae.message?.content ?? []) {
      if (b.type === 'text' && b.text) texts.push(b.text);
    }
  }
  return texts;
}
