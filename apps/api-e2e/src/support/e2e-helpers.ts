/**
 * Shared helpers for e2e tests that interact with real sandboxes.
 *
 * The agent WebSocket is a native Elysia WS at /ws/agent (NOT Socket.IO).
 * Messages use the JSON protocol: { type: string, payload: any }.
 */
import axios from 'axios';
import WebSocket from 'ws';

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
