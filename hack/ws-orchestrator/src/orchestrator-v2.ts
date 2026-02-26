/**
 * Daytona WebSocket Orchestrator V2
 * 
 * Architecture: Host connects TO sandboxes via Daytona preview proxy
 * - Each sandbox runs a WebSocket bridge server (Node.js + ws)
 * - Bridge is uploaded via sandbox.fs.uploadFile() and started via session
 * - Orchestrator connects via wss:// preview URL with auth token
 * - No need for public IP/ngrok on host
 */

import WebSocket from 'ws';
import { Daytona, Sandbox } from '@daytonaio/sdk';
import { File } from 'node:buffer';
import crypto from 'crypto';
import chalk from 'chalk';
import {
  TaskDefinition,
  TaskResult,
} from './types.js';

const BRIDGE_PORT = 8080;
const BRIDGE_DIR = '/home/daytona/bridge';

interface SandboxSession {
  id: string;
  taskId: string;
  taskName: string;
  sandbox: Sandbox;
  sandboxId: string;
  previewUrl: string | null;
  previewToken: string | null;
  bridgeSessionId: string | null;
  ws: WebSocket | null;
  status: 'creating' | 'starting_bridge' | 'connecting' | 'running' | 'completed' | 'error';
  messages: any[];
  result?: string;
  error?: string;
  costUsd?: number;
  startTime: number;
  endTime?: number;
}

export interface OrchestratorV2Config {
  anthropicApiKey?: string;
  snapshot?: string;
  timeoutMs?: number;
}

export class DaytonaOrchestratorV2 {
  private config: Required<OrchestratorV2Config>;
  private daytona: Daytona | null = null;
  private sessions: Map<string, SandboxSession> = new Map();
  private onProgress?: (session: SandboxSession, data: any) => void;

  constructor(config: Partial<OrchestratorV2Config> = {}) {
    this.config = {
      anthropicApiKey: config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
      snapshot: config.snapshot || 'daytona-claude-l',
      timeoutMs: config.timeoutMs || 600000,
    };
  }

  setProgressCallback(callback: (session: SandboxSession, data: any) => void) {
    this.onProgress = callback;
  }

  async initialize(): Promise<void> {
    this.log('🚀', 'Initializing orchestrator V2...');
    this.daytona = new Daytona();
    this.log('✅', 'Daytona client ready');
  }

  async executeTasks(tasks: TaskDefinition[]): Promise<TaskResult[]> {
    this.log('📋', `Executing ${tasks.length} task(s) in parallel`);

    // Create sandboxes and start bridges in parallel
    const setupPromises = tasks.map((task) => this.setupSandbox(task));
    await Promise.all(setupPromises);

    // Wait for all to complete
    return this.waitForCompletion();
  }

  private async setupSandbox(task: TaskDefinition): Promise<void> {
    const sessionId = crypto.randomUUID();
    this.log('🏗️', `Creating sandbox for: ${task.name}`);

    try {
      // 1. Create sandbox
      const sandbox = await this.daytona!.create({
        snapshot: this.config.snapshot,
        autoStopInterval: 0,
      });

      const session: SandboxSession = {
        id: sessionId,
        taskId: task.id,
        taskName: task.name,
        sandbox,
        sandboxId: sandbox.id,
        previewUrl: null,
        previewToken: null,
        bridgeSessionId: null,
        ws: null,
        status: 'creating',
        messages: [],
        startTime: Date.now(),
      };
      this.sessions.set(sessionId, session);
      this.log('✅', `Sandbox ${sandbox.id} created for ${task.name}`);

      // 2. Upload bridge server code
      session.status = 'starting_bridge';
      this.log('📦', `[${task.name}] Uploading bridge...`);

      await sandbox.fs.createFolder(BRIDGE_DIR, '755');

      const bridgeCode = this.getBridgeScript();
      await sandbox.fs.uploadFile(
        `${BRIDGE_DIR}/bridge.js`,
        new File([Buffer.from(bridgeCode)], 'bridge.js', { type: 'text/plain' }),
      );

      // 3. Install ws dependency in bridge dir
      await sandbox.process.executeCommand('npm init -y', BRIDGE_DIR);
      await sandbox.process.executeCommand('npm install ws', BRIDGE_DIR);
      this.log('✅', `[${task.name}] Bridge dependencies installed`);

      // 4. Start bridge as background session
      const bridgeSessionId = `bridge-${task.id}`;
      session.bridgeSessionId = bridgeSessionId;
      await sandbox.process.createSession(bridgeSessionId);

      const { cmdId } = await sandbox.process.executeSessionCommand(bridgeSessionId, {
        command: `cd ${BRIDGE_DIR} && ANTHROPIC_API_KEY="${this.config.anthropicApiKey}" node bridge.js`,
        async: true,
      });
      this.log('✅', `[${task.name}] Bridge started (cmdId: ${cmdId})`);

      // 5. Wait for bridge to be ready
      await new Promise((r) => setTimeout(r, 2000));

      // Verify bridge is running
      const checkResult = await sandbox.process.executeCommand(`curl -s http://localhost:${BRIDGE_PORT}`);
      this.log('🔍', `[${task.name}] Bridge check: "${checkResult.result?.trim() || 'no response'}"`);

      // Check logs
      const logs = await sandbox.process.getSessionCommandLogs(bridgeSessionId, cmdId);
      if (logs) {
        this.log('📋', `[${task.name}] Bridge log: ${logs.trim().slice(0, 100)}`);
      }

      // 6. Get preview URL with auth token
      session.status = 'connecting';
      const previewInfo = await sandbox.getPreviewLink(BRIDGE_PORT);
      session.previewUrl = (previewInfo as any).url;
      session.previewToken = (previewInfo as any).token;
      this.log('🔗', `[${task.name}] Preview: ${session.previewUrl}`);

      // 7. Connect to bridge via WebSocket with auth headers
      await this.connectToBridge(session, task.prompt);

    } catch (err) {
      this.log('❌', `Failed to setup sandbox for ${task.name}: ${err}`);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'error';
        session.error = String(err);
        session.endTime = Date.now();
      }
    }
  }

  private async connectToBridge(session: SandboxSession, prompt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!session.previewUrl) {
        reject(new Error('No preview URL'));
        return;
      }

      // Convert HTTPS preview URL to WSS
      const wsUrl = session.previewUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://');

      this.log('🔌', `[${session.taskName}] Connecting: ${wsUrl}`);

      // Connect with Daytona auth headers
      const headers: Record<string, string> = {
        'X-Daytona-Skip-Preview-Warning': 'true',
      };
      if (session.previewToken) {
        headers['x-daytona-preview-token'] = session.previewToken;
      }

      const ws = new WebSocket(wsUrl, { headers, handshakeTimeout: 15000 });
      session.ws = ws;

      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout (15s)'));
      }, 15000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.log('✅', `[${session.taskName}] WebSocket connected`);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          session.messages.push(msg);

          if (msg.type === 'bridge_ready') {
            // Bridge is ready, send the task prompt
            session.status = 'running';
            this.log('📤', `[${session.taskName}] Sending prompt...`);
            ws.send(JSON.stringify({ type: 'start_claude', prompt }));
            resolve();
          } else if (msg.type === 'claude_message') {
            this.handleClaudeMessage(session, msg.data);
          } else if (msg.type === 'claude_stdout') {
            this.handleClaudeOutput(session, msg.data);
          } else if (msg.type === 'claude_exit') {
            session.status = msg.code === 0 ? 'completed' : 'error';
            session.endTime = Date.now();
            if (msg.code !== 0) {
              session.error = `Exit code: ${msg.code}`;
            }
            const duration = ((session.endTime - session.startTime) / 1000).toFixed(1);
            this.log(
              msg.code === 0 ? '✅' : '❌',
              `[${session.taskName}] Claude exited (code: ${msg.code}) after ${duration}s`,
            );
          } else if (msg.type === 'claude_error') {
            session.status = 'error';
            session.error = msg.error;
            session.endTime = Date.now();
          }

          // Progress callback
          if (this.onProgress) {
            this.onProgress(session, msg);
          }
        } catch {
          // Not JSON, ignore
        }
      });

      ws.on('close', (code) => {
        this.log('🔌', `[${session.taskName}] Disconnected (code: ${code})`);
        if (session.status !== 'completed' && session.status !== 'error') {
          session.status = 'error';
          session.error = `Disconnected (code: ${code})`;
          session.endTime = Date.now();
        }
      });

      ws.on('error', (err) => {
        this.log('❌', `[${session.taskName}] WebSocket error: ${err.message}`);
        clearTimeout(connectTimeout);
        reject(err);
      });

      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(connectTimeout);
        this.log('⚠️', `[${session.taskName}] HTTP ${res.statusCode}`);
        let body = '';
        res.on('data', (chunk: Buffer) => body += chunk.toString());
        res.on('end', () => {
          if (body) this.log('📋', `[${session.taskName}] Body: ${body.slice(0, 100)}`);
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 50)}`));
        });
      });
    });
  }

  private handleClaudeMessage(session: SandboxSession, msg: any) {
    // Structured claude_message from bridge (pre-parsed JSON)
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text?.length > 10) {
          this.log('💬', `[${session.taskName}] ${block.text.slice(0, 60)}...`);
        } else if (block.type === 'tool_use') {
          this.log('🔧', `[${session.taskName}] Tool: ${block.name}`);
        }
      }
    } else if (msg.type === 'result') {
      session.result = msg.result;
      session.costUsd = msg.total_cost_usd;
      const duration = ((Date.now() - session.startTime) / 1000).toFixed(1);
      this.log('✅', `[${session.taskName}] Done in ${duration}s ($${msg.total_cost_usd?.toFixed(4)})`);
    }
  }

  private handleClaudeOutput(session: SandboxSession, output: string) {
    // Raw claude_stdout - parse streaming JSON lines
    const lines = output.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        this.handleClaudeMessage(session, msg);
      } catch {
        // Not JSON line
      }
    }
  }

  private async waitForCompletion(): Promise<TaskResult[]> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const check = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const allDone = Array.from(this.sessions.values()).every(
          (s) => s.status === 'completed' || s.status === 'error',
        );

        if (allDone || elapsed > this.config.timeoutMs) {
          clearInterval(check);
          resolve(this.getResults());
        }
      }, 1000);
    });
  }

  private getResults(): TaskResult[] {
    return Array.from(this.sessions.values()).map((s) => ({
      taskId: s.taskId,
      taskName: s.taskName,
      sandboxId: s.sandboxId,
      status: s.status === 'completed' ? ('success' as const) : ('error' as const),
      result: s.result,
      error: s.error,
      durationMs: (s.endTime || Date.now()) - s.startTime,
      costUsd: s.costUsd,
    }));
  }

  async getPreviewUrl(sandboxId: string, port: number): Promise<{ url: string; token: string } | null> {
    const session = Array.from(this.sessions.values()).find((s) => s.sandboxId === sandboxId);
    if (!session) return null;

    try {
      const info = await session.sandbox.getPreviewLink(port);
      return {
        url: (info as any).url,
        token: (info as any).token,
      };
    } catch {
      return null;
    }
  }

  getSessions(): Map<string, SandboxSession> {
    return this.sessions;
  }

  async cleanup(): Promise<void> {
    this.log('🧹', 'Cleaning up...');

    for (const session of this.sessions.values()) {
      try {
        session.ws?.close();
        if (session.bridgeSessionId) {
          try {
            await session.sandbox.process.deleteSession(session.bridgeSessionId);
          } catch {}
        }
        await session.sandbox.delete();
        this.log('✅', `Deleted sandbox ${session.sandboxId}`);
      } catch (err) {
        this.log('⚠️', `Cleanup error for ${session.sandboxId}: ${err}`);
      }
    }

    this.sessions.clear();
    this.log('✅', 'Cleanup complete');
  }

  private getBridgeScript(): string {
    return `const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");

const PORT = ${BRIDGE_PORT};
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

let state = { ws: null, claude: null };

function log(emoji, msg) {
  console.log(new Date().toISOString() + " " + emoji + " " + msg);
}

// HTTP server for health checks + WebSocket upgrade
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("bridge-ok");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  log("🔗", "Orchestrator connected");
  state.ws = ws;
  ws.send(JSON.stringify({ type: "bridge_ready", port: PORT }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "start_claude") {
        if (state.claude) { state.claude.kill(); state.claude = null; }
        log("🤖", "Starting Claude with prompt: " + msg.prompt.slice(0, 50) + "...");

        state.claude = spawn("claude", [
          "--dangerously-skip-permissions",
          "--verbose",
          "--output-format", "stream-json",
          "-p", msg.prompt
        ], {
          env: { ...process.env, ANTHROPIC_API_KEY: API_KEY },
          stdio: ["ignore", "pipe", "pipe"]
        });

        let buffer = "";
        state.claude.stdout.on("data", (d) => {
          buffer += d.toString();
          const lines = buffer.split("\\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsed = JSON.parse(line);
                ws.send(JSON.stringify({ type: "claude_message", data: parsed }));
              } catch {
                ws.send(JSON.stringify({ type: "claude_stdout", data: line }));
              }
            }
          }
        });

        state.claude.stderr.on("data", (d) => {
          ws.send(JSON.stringify({ type: "claude_stderr", data: d.toString() }));
        });

        state.claude.on("close", (code) => {
          // Flush remaining buffer
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              ws.send(JSON.stringify({ type: "claude_message", data: parsed }));
            } catch {}
          }
          ws.send(JSON.stringify({ type: "claude_exit", code }));
          state.claude = null;
        });

        state.claude.on("error", (e) => {
          ws.send(JSON.stringify({ type: "claude_error", error: e.message }));
        });
      } else if (msg.type === "stop_claude") {
        if (state.claude) { state.claude.kill(); state.claude = null; }
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (e) { log("❌", "Parse error: " + e); }
  });

  ws.on("close", () => {
    log("🔌", "Disconnected");
    if (state.claude) { state.claude.kill(); state.claude = null; }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log("✅", "Bridge ready on port " + PORT);
});
`;
  }

  private log(emoji: string, message: string): void {
    const time = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`${chalk.gray(time)} ${emoji} ${message}`);
  }
}
