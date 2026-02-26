import { WebSocketServer, WebSocket } from 'ws';
import { Daytona, Sandbox } from '@daytonaio/sdk';
import crypto from 'crypto';
import chalk from 'chalk';
import {
  TaskDefinition,
  OrchestratorSession,
  OrchestratorConfig,
  TaskResult,
  SDKUserMessage,
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  ContentBlock,
} from './types.js';

export class DaytonaWebSocketOrchestrator {
  private config: OrchestratorConfig;
  private wss: WebSocketServer | null = null;
  private daytona: Daytona | null = null;
  private sessions: Map<string, OrchestratorSession> = new Map();
  private pendingTasks: Map<string, TaskDefinition> = new Map();
  private onProgress?: (session: OrchestratorSession, message: SDKMessage) => void;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = {
      wsPort: config.wsPort || 9000,
      wsHost: config.wsHost || '0.0.0.0',
      daytonaApiKey: config.daytonaApiKey || process.env.DAYTONA_API_KEY,
      anthropicApiKey: config.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
      snapshot: config.snapshot || 'daytona-claude-l',
      timeoutMs: config.timeoutMs || 600000, // 10 minutes default
    };
  }

  /**
   * Set a callback for real-time progress updates
   */
  setProgressCallback(callback: (session: OrchestratorSession, message: SDKMessage) => void) {
    this.onProgress = callback;
  }

  /**
   * Initialize the orchestrator - start WebSocket server and Daytona client
   */
  async initialize(): Promise<void> {
    this.log('🚀', 'Initializing orchestrator...');

    // Initialize Daytona client
    this.daytona = new Daytona();
    this.log('✅', 'Daytona client initialized');

    // Start WebSocket server
    this.wss = new WebSocketServer({
      port: this.config.wsPort,
      host: this.config.wsHost,
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.wss.on('error', (err) => this.log('❌', `WebSocket server error: ${err.message}`));

    this.log('✅', `WebSocket server listening on ws://${this.config.wsHost}:${this.config.wsPort}`);
  }

  /**
   * Execute multiple tasks in parallel
   */
  async executeTasks(tasks: TaskDefinition[]): Promise<TaskResult[]> {
    this.log('📋', `Executing ${tasks.length} task(s) in parallel`);

    // Store tasks for when Claude connects
    for (const task of tasks) {
      this.pendingTasks.set(task.id, task);
    }

    // Create sandboxes and start Claude in each
    const sandboxPromises = tasks.map((task) => this.createSandboxForTask(task));
    await Promise.all(sandboxPromises);

    // Wait for all tasks to complete
    return this.waitForCompletion();
  }

  /**
   * Create a sandbox and start Claude with --sdk-url
   */
  private async createSandboxForTask(task: TaskDefinition): Promise<void> {
    this.log('🏗️', `Creating sandbox for task: ${task.name}`);

    const sessionId = crypto.randomUUID();

    try {
      // Create Daytona sandbox
      const sandbox = await this.daytona!.create({
        snapshot: this.config.snapshot,
        autoStopInterval: 0,
        timeout: 120,
      });

      this.log('✅', `Sandbox created: ${sandbox.id} for task: ${task.name}`);

      // Initialize session
      const session: OrchestratorSession = {
        id: sessionId,
        taskId: task.id,
        taskName: task.name,
        sandbox,
        sandboxId: sandbox.id,
        status: 'connecting',
        messages: [],
        startTime: Date.now(),
      };
      this.sessions.set(sessionId, session);

      // Get host IP that sandbox can reach
      const wsUrl = `ws://${await this.getHostIP()}:${this.config.wsPort}/${sessionId}`;

      // Start Claude in sandbox with --sdk-url
      const claudeCmd = [
        `export ANTHROPIC_API_KEY="${this.config.anthropicApiKey}"`,
        `claude --sdk-url "${wsUrl}" --dangerously-skip-permissions`,
      ].join(' && ');

      this.log('🤖', `Starting Claude in sandbox ${sandbox.id} with ws: ${wsUrl}`);

      // Run Claude asynchronously
      sandbox.process.executeSessionCommand(claudeCmd, { runAsync: true }).catch((err) => {
        this.log('❌', `Error starting Claude in ${sandbox.id}: ${err.message}`);
        session.status = 'error';
        session.error = err.message;
      });
    } catch (err) {
      this.log('❌', `Failed to create sandbox for task ${task.name}: ${err}`);
      throw err;
    }
  }

  /**
   * Handle WebSocket connection from Claude
   */
  private handleConnection(ws: WebSocket, req: any): void {
    // Extract session ID from URL path
    const urlPath = req.url || '/';
    const sessionId = urlPath.replace('/', '');

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log('⚠️', `Unknown session connected: ${sessionId}`);
      ws.close();
      return;
    }

    this.log('🔗', `Claude connected for task: ${session.taskName}`);
    session.websocket = ws as any;
    session.status = 'initializing';

    // Get the task definition
    const task = this.pendingTasks.get(session.taskId);
    if (!task) {
      this.log('❌', `No task found for session ${sessionId}`);
      ws.close();
      return;
    }

    // Send the user prompt
    const userMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: task.prompt,
      },
      parent_tool_use_id: null,
      session_id: crypto.randomUUID(),
    };

    ws.send(JSON.stringify(userMessage) + '\n');
    this.log('📤', `Sent prompt to ${session.taskName}: ${task.prompt.slice(0, 50)}...`);

    // Handle incoming messages from Claude
    ws.on('message', (data: Buffer) => this.handleMessage(session, data));

    ws.on('close', (code, reason) => {
      this.log('🔌', `Claude disconnected from ${session.taskName} (code: ${code})`);
      if (session.status !== 'completed' && session.status !== 'error') {
        session.status = 'error';
        session.error = `Disconnected unexpectedly (code: ${code})`;
      }
      session.endTime = Date.now();
    });

    ws.on('error', (err) => {
      this.log('❌', `WebSocket error for ${session.taskName}: ${err.message}`);
      session.status = 'error';
      session.error = err.message;
    });
  }

  /**
   * Handle incoming message from Claude
   */
  private handleMessage(session: OrchestratorSession, data: Buffer): void {
    const lines = data.toString().split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as SDKMessage;
        session.messages.push(msg);

        switch (msg.type) {
          case 'system':
            session.status = 'running';
            session.claudeSessionId = msg.session_id;
            session.model = msg.model;
            session.tools = msg.tools;
            this.log('⚙️', `[${session.taskName}] Initialized with ${msg.tools.length} tools`);
            break;

          case 'assistant':
            this.handleAssistantMessage(session, msg as SDKAssistantMessage);
            break;

          case 'result':
            this.handleResultMessage(session, msg as SDKResultMessage);
            break;
        }

        // Call progress callback
        if (this.onProgress) {
          this.onProgress(session, msg);
        }
      } catch (e) {
        // Not JSON, skip
      }
    }
  }

  /**
   * Handle assistant message (text or tool use)
   */
  private handleAssistantMessage(session: OrchestratorSession, msg: SDKAssistantMessage): void {
    const content = msg.message?.content || [];

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        this.log('💬', `[${session.taskName}] ${block.text.slice(0, 80)}${block.text.length > 80 ? '...' : ''}`);
      } else if (block.type === 'tool_use') {
        this.log('🔧', `[${session.taskName}] Using tool: ${block.name}`);
      }
    }
  }

  /**
   * Handle result message (task completion)
   */
  private handleResultMessage(session: OrchestratorSession, msg: SDKResultMessage): void {
    session.status = msg.is_error ? 'error' : 'completed';
    session.result = msg.result;
    session.costUsd = msg.total_cost_usd;
    session.endTime = Date.now();

    const duration = ((session.endTime - session.startTime) / 1000).toFixed(1);

    if (msg.is_error) {
      this.log('❌', `[${session.taskName}] Failed after ${duration}s: ${msg.result}`);
    } else {
      this.log('✅', `[${session.taskName}] Completed in ${duration}s (cost: $${msg.total_cost_usd?.toFixed(4)})`);
    }
  }

  /**
   * Wait for all tasks to complete
   */
  private async waitForCompletion(): Promise<TaskResult[]> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const allDone = Array.from(this.sessions.values()).every(
          (s) => s.status === 'completed' || s.status === 'error'
        );

        if (allDone || elapsed > this.config.timeoutMs!) {
          clearInterval(checkInterval);

          const results: TaskResult[] = Array.from(this.sessions.values()).map((session) => ({
            taskId: session.taskId,
            taskName: session.taskName,
            sandboxId: session.sandboxId,
            status: session.status === 'completed' ? 'success' : 'error',
            result: session.result,
            error: session.error,
            durationMs: (session.endTime || Date.now()) - session.startTime,
            costUsd: session.costUsd,
          }));

          resolve(results);
        }
      }, 1000);
    });
  }

  /**
   * Get preview URL for a sandbox
   */
  async getPreviewUrl(sandboxId: string, port: number): Promise<string | null> {
    const session = Array.from(this.sessions.values()).find((s) => s.sandboxId === sandboxId);
    if (!session) return null;

    try {
      const result = await session.sandbox.getPreviewLink(port);
      // Handle both string and object responses
      if (typeof result === 'string') {
        return result;
      } else if (result && typeof result === 'object' && 'url' in result) {
        return (result as any).url;
      }
      return String(result);
    } catch (err) {
      this.log('⚠️', `Failed to get preview URL for ${sandboxId}:${port}: ${err}`);
      return null;
    }
  }

  /**
   * Stop all sandboxes
   */
  async cleanup(): Promise<void> {
    this.log('🧹', 'Cleaning up...');

    for (const session of this.sessions.values()) {
      try {
        await session.sandbox.stop();
        this.log('⏹️', `Stopped sandbox: ${session.sandboxId}`);
      } catch (err) {
        this.log('⚠️', `Failed to stop sandbox ${session.sandboxId}: ${err}`);
      }
    }

    this.sessions.clear();
    this.pendingTasks.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.log('✅', 'Cleanup complete');
  }

  /**
   * Delete all sandboxes permanently
   */
  async deleteAllSandboxes(): Promise<void> {
    this.log('🗑️', 'Deleting all sandboxes...');

    for (const session of this.sessions.values()) {
      try {
        await session.sandbox.delete();
        this.log('🗑️', `Deleted sandbox: ${session.sandboxId}`);
      } catch (err) {
        this.log('⚠️', `Failed to delete sandbox ${session.sandboxId}: ${err}`);
      }
    }
  }

  /**
   * Get sessions
   */
  getSessions(): Map<string, OrchestratorSession> {
    return this.sessions;
  }

  /**
   * Get host URL that sandboxes can reach
   * For cloud sandboxes, this needs to be a public IP/domain or tunnel URL
   */
  private async getHostIP(): Promise<string> {
    // Priority:
    // 1. Explicit HOST_IP env var (can be ngrok URL, public IP, etc.)
    // 2. WS_HOST config (if set to something other than 0.0.0.0)
    // 3. Fallback for local testing
    
    if (process.env.HOST_IP) {
      return process.env.HOST_IP;
    }
    
    // For local testing only - won't work with cloud sandboxes
    this.log('⚠️', 'HOST_IP not set - sandboxes may not be able to connect!');
    this.log('💡', 'Set HOST_IP to your public IP or ngrok URL for cloud sandboxes');
    return 'localhost';
  }

  /**
   * Log with emoji prefix
   */
  private log(emoji: string, message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`${chalk.gray(timestamp)} ${emoji} ${message}`);
  }
}
