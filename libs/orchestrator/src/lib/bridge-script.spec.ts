/**
 * Tests for the OpenCode serve-based bridge script.
 *
 * Validates that:
 * 1. getBridgeScript() generates valid JS with the serve adapter
 * 2. The serve adapter uses HTTP API + SSE for communication
 * 3. The bridge core routes messages correctly
 * 4. Session management maps threads to OpenCode sessions
 * 5. Working directory context is injected for continued sessions
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { getBridgeScript } from './bridge-script';

describe('getBridgeScript', () => {
  it('should generate a non-empty string', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toBeTruthy();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(1000);
  });

  it('should not include legacy AGENT_TYPE constant', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).not.toContain('AGENT_TYPE');
  });

  it('should not include legacy adapters', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).not.toContain('claudeAdapter');
    expect(script).not.toContain('codexAdapter');
    expect(script).not.toContain('app-server');
  });

  it('should use normalized message types (agent_message, agent_exit, agent_error)', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"agent_message"');
    expect(script).toContain('"agent_exit"');
    expect(script).toContain('"agent_error"');
  });

  it('should handle start_agent messages', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"start_agent"');
    expect(script).toContain('handleStartAgent');
  });

  it('should escape projectDir with double quotes', () => {
    const script = getBridgeScript(8080, '/home/user/"test"');
    expect(script).toContain('\\"test\\"');
  });
});

describe('OpenCode serve adapter', () => {
  it('should not use opencode run (replaced by serve mode)', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).not.toContain('"run", "--format", "json"');
  });

  it('should start opencode serve with port and hostname', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('startOpenCodeServe');
    expect(script).toContain('"serve"');
    expect(script).toContain('"--port"');
    expect(script).toContain('"--hostname"');
    expect(script).toContain('"127.0.0.1"');
  });

  it('should resolve the opencode binary path dynamically', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('which opencode');
  });

  it('should poll /global/health for readiness', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('pollHealth');
    expect(script).toContain('/global/health');
    expect(script).toContain('res.healthy');
  });

  it('should connect to SSE /event endpoint', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('connectSSE');
    expect(script).toContain('/event');
    expect(script).toContain('handleSSEEvent');
  });

  it('should use prompt_async with polling for sending prompts', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('/prompt_async');
    expect(script).toContain('sendPrompt');
    expect(script).toContain('pollSession');
  });

  it('should create sessions via POST /session', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('ocFetch("POST", "/session"');
    expect(script).toContain('title: threadId');
  });

  it('should poll session messages for text, tool, and step-finish parts', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('pollSession');
    expect(script).toContain('part.type === "text"');
    expect(script).toContain('part.type === "tool"');
    expect(script).toContain('part.type === "step-finish"');
  });

  it('should detect session idle via polling and emit exit', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('session/status');
    expect(script).toContain('st.type === "idle"');
    expect(script).toContain('emitAgentExit(threadId, 0)');
  });

  it('should deduplicate polled parts by ID', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('emittedParts');
    expect(script).toContain('emittedParts.has(pid)');
  });

  it('should normalize OpenCode tool names to display names', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('bash: "Bash"');
    expect(script).toContain('read: "Read"');
    expect(script).toContain('glob: "Glob"');
    expect(script).toContain('grep: "Grep"');
    expect(script).toContain('apply_patch: "Write"');
    expect(script).toContain('task: "Task"');
  });

  it('should emit system init with session_id', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('type: "system"');
    expect(script).toContain('subtype: "init"');
    expect(script).toContain('session_id:');
  });

  it('should emit result event on step_finish with reason stop', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('type: "result"');
    expect(script).toContain('subtype: "success"');
    expect(script).toContain('total_cost_usd:');
  });

  it('should default agent to build when not specified', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('agent || "build"');
  });

  it('should split model string into providerID and modelID', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('providerID:');
    expect(script).toContain('modelID:');
  });
});

describe('Session management', () => {
  it('should maintain threadToSession and sessionToThread maps', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('threadToSession');
    expect(script).toContain('sessionToThread');
  });

  it('should track active threads', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('activeThreads');
    expect(script).toContain('activeThreads.add(threadId)');
    expect(script).toContain('activeThreads.delete(threadId)');
  });

  it('should abort existing session before sending new prompt', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('Aborting running session');
    expect(script).toContain('/abort');
  });

  it('should accumulate costs per session', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('sessionCosts');
  });

  it('should clean up bidirectional mappings on session change', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('oldThread');
    expect(script).toContain('oldSession');
  });
});

describe('Bridge core routing', () => {
  it('should route start_agent to handleStartAgent (async)', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"start_agent"');
    expect(script).toContain('handleStartAgent(msg)');
    expect(script).toContain('.catch');
  });

  it('should route agent_user_answer to handleUserAnswer', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('msg.type === "agent_user_answer"');
    expect(script).toContain('handleUserAnswer(msg)');
  });

  it('should route stop_agent to handleStopAgent using abort API', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('msg.type === "stop_agent"');
    expect(script).toContain('handleStopAgent(msg)');
    expect(script).toContain('/abort');
  });

  it('should read agent name from msg.agent or msg.agentType', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('msg.agent || msg.agentType');
  });

  it('should abort all sessions on WS disconnect', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('Orchestrator disconnected');
    expect(script).toContain('activeThreads.clear()');
  });

  it('should not include PTY-based agent processes', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).not.toContain('agentProcesses');
    expect(script).not.toContain('killEntry');
  });

  it('should not include agent_input handler (no PTY)', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).not.toContain('"agent_input"');
  });
});

describe('Shared infrastructure', () => {
  it('should include terminal management', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('terminal_create');
    expect(script).toContain('terminal_input');
    expect(script).toContain('terminal_resize');
    expect(script).toContain('terminal_close');
    expect(script).toContain('terminal_list');
  });

  it('should include file watcher', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('inotifywait');
    expect(script).toContain('file_changed');
  });

  it('should include port scanning', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('ports_update');
    expect(script).toContain('/proc/net/tcp');
  });

  it('should exclude opencode serve port from port scanning', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('OC_PORT');
    expect(script).toContain('INTERNAL_PORTS');
  });

  it('should include preview URL endpoint', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('/internal/preview-url');
  });

  it('should include ask-user MCP endpoint', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('/internal/ask-user');
    expect(script).toContain('AskUserQuestion');
  });

  it('should emit ask_user_pending when question is asked', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"ask_user_pending"');
    expect(script).toContain('questionId');
  });

  it('should emit ask_user_resolved when answer received or timeout', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"ask_user_resolved"');
    const callCount = (script.match(/emitAskUserResolved\(/g) || []).length;
    expect(callCount).toBeGreaterThanOrEqual(4);
  });

  it('should check pendingAskUser before fallback', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('pendingAskUser.get(msg.toolUseId)');
  });

  it('should fall back to threadId matching in handleUserAnswer', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('entry.threadId === msg.threadId');
  });

  it('should emit bridge_ready on connection with thread journal summary', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"bridge_ready"');
    expect(script).toContain('getThreadJournalSummary()');
  });

  it('should auto-restart opencode serve on exit', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('opencode serve exited');
    expect(script).toContain('startOpenCodeServe');
  });

  it('should reconnect SSE curl on exit or error', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('SSE curl exited');
    expect(script).toContain('SSE curl error');
    expect(script).toContain('setTimeout(connectSSE');
  });

  it('should auto-approve permission requests from opencode serve', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"permission.updated"');
    expect(script).toContain('Auto-approving permission');
    expect(script).toContain('/permission/');
    expect(script).toContain('reply: "always"');
  });
});

describe('Event journal and replay', () => {
  it('should define EVENTS_DIR for journal file storage', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('EVENTS_DIR');
    expect(script).toContain('/.apex/events');
  });

  it('should define journalEvent function that assigns seq and appends JSONL', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('function journalEvent(');
    expect(script).toContain('threadSeqCounters');
    expect(script).toContain('appendFileSync');
    expect(script).toContain('msg._seq = seq');
  });

  it('should journal events in emitAgentMessage before sending via WS', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    const emitFn = script.slice(
      script.indexOf('function emitAgentMessage('),
      script.indexOf('function emitAgentExit('),
    );
    expect(emitFn).toContain('journalEvent(threadId, msg)');
    const journalIdx = emitFn.indexOf('journalEvent');
    const sendIdx = emitFn.indexOf('state.ws.send');
    expect(journalIdx).toBeLessThan(sendIdx);
  });

  it('should set threadJournalStatus on emitAgentExit and emitAgentError', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    const exitFn = script.slice(
      script.indexOf('function emitAgentExit('),
      script.indexOf('function emitAgentError('),
    );
    expect(exitFn).toContain('threadJournalStatus.set(threadId');
    expect(exitFn).toContain('"completed"');

    const errorFn = script.slice(
      script.indexOf('function emitAgentError('),
      script.indexOf('function emitAskUserPending('),
    );
    expect(errorFn).toContain('threadJournalStatus.set(threadId, "error")');
  });

  it('should journal ask_user_pending and ask_user_resolved via helper functions', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('function emitAskUserPending(');
    expect(script).toContain('function emitAskUserResolved(');
    const pendingFn = script.slice(
      script.indexOf('function emitAskUserPending('),
      script.indexOf('function emitAskUserResolved('),
    );
    expect(pendingFn).toContain('journalEvent(threadId');
  });

  it('should define getThreadJournalSummary that scans journal files', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('function getThreadJournalSummary()');
    expect(script).toContain('readdirSync(EVENTS_DIR)');
    expect(script).toContain('.endsWith(".jsonl")');
  });

  it('should define replayJournal that reads JSONL and sends entries after afterSeq', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('function replayJournal(threadId, afterSeq)');
    expect(script).toContain('entry.seq > afterSeq');
    expect(script).toContain('entry.msg._replay = true');
    expect(script).toContain('"replay_complete"');
  });

  it('should handle request_replay messages from orchestrator', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"request_replay"');
    expect(script).toContain('replayJournal(msg.threadId');
  });

  it('should clear thread journal at the start of handleStartAgent', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('function clearThreadJournal(');
    const startAgent = script.slice(
      script.indexOf('async function handleStartAgent('),
      script.indexOf('async function handleStartAgent(') + 300,
    );
    expect(startAgent).toContain('clearThreadJournal(threadId)');
  });

  it('should prune stale journal files older than 24 hours on boot', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('Prune stale journal');
    expect(script).toContain('86400000');
  });

  it('should set journal status to active when emitStartAck receives started', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    const ackFn = script.slice(
      script.indexOf('function emitStartAck('),
      script.indexOf('function emitStartAck(') + 300,
    );
    expect(ackFn).toContain('status === "started"');
    expect(ackFn).toContain('threadJournalStatus.set(threadId, "active")');
  });
});

/**
 * Regression tests for agent cwd drift between prompts.
 *
 * When the agent sends a follow-up prompt to an existing OpenCode session,
 * the shell's working directory may have drifted from the project root
 * (e.g. after a `cd` in a previous turn). The bridge must prepend a
 * [cwd: PROJECT_DIR] context marker so the agent knows where to operate.
 */
describe('cwd context injection for continued sessions', () => {
  const PROJECT_DIR = '/home/daytona/my-project';

  // ── Static analysis tests ──────────────────────────

  it('should track whether the session is continued via isContinuedSession flag', () => {
    const script = getBridgeScript(8080, PROJECT_DIR);
    expect(script).toContain('var isContinuedSession = !!ocSessionId');
  });

  it('should mark stored sessionId reuse as a continued session', () => {
    const script = getBridgeScript(8080, PROJECT_DIR);
    const sendPromptFn = script.slice(
      script.indexOf('async function sendPrompt('),
      script.indexOf('function pollSession('),
    );
    const matches = sendPromptFn.match(/isContinuedSession\s*=\s*true/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('should prepend [cwd: PROJECT_DIR] to prompt for continued sessions', () => {
    const script = getBridgeScript(8080, PROJECT_DIR);
    expect(script).toContain('if (isContinuedSession && PROJECT_DIR)');
    expect(script).toContain('"[cwd: " + PROJECT_DIR + "]\\n\\n" + prompt');
  });

  it('should use effectivePrompt in the prompt_async payload, not raw prompt', () => {
    const script = getBridgeScript(8080, PROJECT_DIR);
    expect(script).toContain('text: effectivePrompt');
  });

  it('should default effectivePrompt to the raw prompt for new sessions', () => {
    const script = getBridgeScript(8080, PROJECT_DIR);
    expect(script).toContain('var effectivePrompt = prompt');
  });

  // ── Functional VM-based tests ──────────────────────
  //
  // Evaluates the generated bridge script in an isolated VM context with
  // mocked Node modules, then exercises sendPrompt() end-to-end.

  /**
   * Create a VM sandbox that evaluates the full bridge script with mocked
   * dependencies. Returns helpers to manipulate internal state and inspect
   * what was sent to OpenCode's prompt_async endpoint.
   */
  function createBridgeSandbox(projectDir: string) {
    const script = getBridgeScript(8080, projectDir);

    // Collect all POST /session/:id/prompt_async payloads
    const promptAsyncCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    // Collect all POST /session creation calls
    const sessionCreateCalls: Array<{ body: Record<string, unknown> }> = [];

    const noopFn = () => {};
    const noopStream = { on: noopFn, pipe: noopFn, pause: noopFn, resume: noopFn };
    const noopServer = { listen: noopFn, on: noopFn, address: () => ({ port: 0 }) };
    const noopWs = { on: noopFn, send: noopFn, readyState: 1 };

    function mockHttpRequest(opts: { path: string; method: string }, cb: (res: unknown) => void) {
      const url = opts.path;
      const method = opts.method;

      let responseBody = 'null';
      let statusCode = 200;

      if (method === 'POST' && url === '/session') {
        const data = { chunks: '' };
        return {
          on: noopFn,
          write(chunk: string) { data.chunks += chunk; },
          end() {
            try { sessionCreateCalls.push({ body: JSON.parse(data.chunks) }); } catch {}
            responseBody = JSON.stringify({ id: 'oc-session-new' });
            const res = { statusCode, on: (evt: string, fn: (d?: string) => void) => {
              if (evt === 'data') fn(responseBody);
              if (evt === 'end') fn();
            }};
            cb(res);
          },
        };
      }

      if (method === 'POST' && /\/session\/[^/]+\/prompt_async/.test(url)) {
        const data = { chunks: '' };
        return {
          on: noopFn,
          write(chunk: string) { data.chunks += chunk; },
          end() {
            try { promptAsyncCalls.push({ url, body: JSON.parse(data.chunks) }); } catch {}
            statusCode = 204;
            const res = { statusCode, on: (evt: string, fn: (d?: string) => void) => {
              if (evt === 'end') fn();
            }};
            cb(res);
          },
        };
      }

      if (method === 'GET' && url.includes('/session/status')) {
        responseBody = JSON.stringify({ 'oc-session-existing': { type: 'idle' } });
      } else if (method === 'GET' && url.includes('/message')) {
        responseBody = JSON.stringify([]);
      }

      return {
        on: noopFn,
        write: noopFn,
        end() {
          const res = { statusCode, on: (evt: string, fn: (d?: string) => void) => {
            if (evt === 'data') fn(responseBody);
            if (evt === 'end') fn();
          }};
          cb(res);
        },
      };
    }

    const fsMock = {
      accessSync: noopFn,
      writeFileSync: noopFn,
      readFileSync: () => '{}',
      existsSync: () => false,
      readdirSync: () => [],
      unlinkSync: noopFn,
      mkdirSync: noopFn,
      appendFileSync: noopFn,
      statSync: () => ({ mtimeMs: Date.now() }),
      constants: { X_OK: 1 },
    };

    const modules: Record<string, unknown> = {
      http: { createServer: () => noopServer, request: mockHttpRequest },
      ws: Object.assign(function WS() { return noopWs; }, { WebSocketServer: function WSS() { return { on: noopFn }; } }),
      child_process: { spawn: () => ({ ...noopStream, stdout: noopStream, stderr: noopStream, pid: 1, on: noopFn, kill: noopFn }), execSync: () => Buffer.from('opencode') },
      'node-pty': { spawn: () => ({ ...noopStream, onData: noopFn, onExit: noopFn, write: noopFn, resize: noopFn, kill: noopFn, pid: 1 }) },
      crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) },
      https: { request: mockHttpRequest, Agent: function() {} },
      url: { parse: (u: string) => ({ hostname: 'localhost', port: 80, path: u }) },
      net: { createServer: () => noopServer, createConnection: () => noopStream },
      fs: fsMock,
      tls: { connect: () => ({ ...noopStream, authorized: true }), createSecureContext: noopFn },
      path: { join: (...parts: string[]) => parts.join('/'), dirname: (p: string) => p, resolve: (...parts: string[]) => parts.join('/'), basename: (p: string) => p },
    };

    const context = vm.createContext({
      require: (mod: string) => {
        const m = modules[mod];
        if (!m) throw new Error('Mock not available for module: ' + mod);
        return m;
      },
      process: { env: { HOME: '/home/daytona', SHELL: '/bin/bash' }, platform: 'linux' },
      console: { log: noopFn, error: noopFn, warn: noopFn },
      setTimeout: (fn: () => void) => { fn(); return 0; },
      setInterval: () => 0,
      clearInterval: noopFn,
      clearTimeout: noopFn,
      Buffer,
      JSON,
      Map,
      Set,
      Array,
      Object,
      String,
      Number,
      Error,
      Promise,
      Date,
      Math,
      RegExp,
      parseInt,
      parseFloat,
      isNaN,
      encodeURIComponent,
      decodeURIComponent,
    });

    // Append accessors so we can reach internal state from outside the VM
    const testScript = script + `
globalThis.__sendPrompt = sendPrompt;
globalThis.__threadToSession = threadToSession;
globalThis.__sessionToThread = sessionToThread;
globalThis.__activeThreads = activeThreads;
globalThis.__sessionEmittedParts = sessionEmittedParts;
globalThis.__sessionCosts = sessionCosts;
globalThis.__state = state;
`;

    vm.runInNewContext(testScript, context);

    return {
      sendPrompt: context.__sendPrompt as (
        threadId: string, prompt: string, agent?: string, model?: string,
        sessionId?: string, images?: unknown[], agentSettings?: unknown,
      ) => Promise<void>,
      threadToSession: context.__threadToSession as Map<string, string>,
      sessionToThread: context.__sessionToThread as Map<string, string>,
      activeThreads: context.__activeThreads as Set<string>,
      sessionEmittedParts: context.__sessionEmittedParts as Map<string, Set<string>>,
      sessionCosts: context.__sessionCosts as Map<string, number>,
      state: context.__state as { ws: unknown },
      promptAsyncCalls,
      sessionCreateCalls,
    };
  }

  it('should NOT prepend cwd for first prompt in a new session', async () => {
    const sb = createBridgeSandbox(PROJECT_DIR);
    sb.state.ws = { readyState: 1, send: () => {} };

    await sb.sendPrompt('thread-1', 'hello world');

    expect(sb.promptAsyncCalls).toHaveLength(1);
    const sent = sb.promptAsyncCalls[0];
    const textPart = sent.body.parts as Array<{ type: string; text: string }>;
    const text = textPart.find(p => p.type === 'text')!.text;
    expect(text).toBe('hello world');
    expect(text).not.toContain('[cwd:');
  });

  it('should prepend [cwd: PROJECT_DIR] for second prompt in the same thread', async () => {
    const sb = createBridgeSandbox(PROJECT_DIR);
    sb.state.ws = { readyState: 1, send: () => {} };

    // First prompt creates a new session
    await sb.sendPrompt('thread-1', 'first message');
    expect(sb.promptAsyncCalls).toHaveLength(1);
    expect(sb.threadToSession.get('thread-1')).toBeTruthy();

    // Second prompt reuses the session → should have cwd prefix
    await sb.sendPrompt('thread-1', 'create commit and push');
    expect(sb.promptAsyncCalls).toHaveLength(2);

    const secondCall = sb.promptAsyncCalls[1];
    const textPart = (secondCall.body.parts as Array<{ type: string; text: string }>)
      .find(p => p.type === 'text')!.text;
    expect(textPart).toBe(`[cwd: ${PROJECT_DIR}]\n\ncreate commit and push`);
  });

  it('should prepend cwd when reusing a stored sessionId', async () => {
    const sb = createBridgeSandbox(PROJECT_DIR);
    sb.state.ws = { readyState: 1, send: () => {} };

    // Simulate a stored session from a previous bridge lifecycle
    await sb.sendPrompt('thread-2', 'resume work', undefined, undefined, 'oc-session-existing');
    expect(sb.promptAsyncCalls).toHaveLength(1);

    const textPart = (sb.promptAsyncCalls[0].body.parts as Array<{ type: string; text: string }>)
      .find(p => p.type === 'text')!.text;
    expect(textPart).toBe(`[cwd: ${PROJECT_DIR}]\n\nresume work`);
  });

  it('should fall back to HOME when projectDir is empty and still prepend cwd', async () => {
    const sb = createBridgeSandbox('');
    sb.state.ws = { readyState: 1, send: () => {} };

    await sb.sendPrompt('thread-3', 'first');
    await sb.sendPrompt('thread-3', 'second');

    // PROJECT_DIR falls back to process.env.HOME (/home/daytona), so cwd is still prepended
    const secondText = (sb.promptAsyncCalls[1].body.parts as Array<{ type: string; text: string }>)
      .find(p => p.type === 'text')!.text;
    expect(secondText).toBe('[cwd: /home/daytona]\n\nsecond');
  });

  it('should preserve user prompt text after the cwd prefix', async () => {
    const sb = createBridgeSandbox(PROJECT_DIR);
    sb.state.ws = { readyState: 1, send: () => {} };

    await sb.sendPrompt('thread-4', 'first');
    const userPrompt = 'please run:\ngit status\ngit diff --staged';
    await sb.sendPrompt('thread-4', userPrompt);

    const textPart = (sb.promptAsyncCalls[1].body.parts as Array<{ type: string; text: string }>)
      .find(p => p.type === 'text')!.text;
    expect(textPart).toContain(userPrompt);
    expect(textPart).toBe(`[cwd: ${PROJECT_DIR}]\n\n${userPrompt}`);
  });
});
