/**
 * Tests for the OpenCode serve-based bridge script.
 *
 * Validates that:
 * 1. getBridgeScript() generates valid JS with the serve adapter
 * 2. The serve adapter uses HTTP API + SSE for communication
 * 3. The bridge core routes messages correctly
 * 4. Session management maps threads to OpenCode sessions
 */
import { describe, it, expect } from 'vitest';
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
    const count = (script.match(/"ask_user_resolved"/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('should check pendingAskUser before fallback', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('pendingAskUser.get(msg.toolUseId)');
  });

  it('should fall back to threadId matching in handleUserAnswer', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('entry.threadId === msg.threadId');
  });

  it('should emit bridge_ready on connection', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"bridge_ready"');
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
