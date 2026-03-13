/**
 * Tests for the multi-agent bridge script.
 *
 * Validates that:
 * 1. getBridgeScript() generates valid JS for each agent type
 * 2. Each adapter normalizes output into the expected format
 * 3. The bridge core routes messages to the correct adapter
 *
 * These tests eval() portions of the generated bridge script to test
 * adapter logic in isolation without spawning real agent processes.
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

  it('should accept agentType parameter', () => {
    const claude = getBridgeScript(8080, '/tmp/test', 'claude_code');
    const opencode = getBridgeScript(8080, '/tmp/test', 'open_code');
    const codex = getBridgeScript(8080, '/tmp/test', 'codex');

    expect(claude).toContain('AGENT_TYPE = "claude_code"');
    expect(opencode).toContain('AGENT_TYPE = "open_code"');
    expect(codex).toContain('AGENT_TYPE = "codex"');
  });

  it('should default to claude_code when agentType is omitted', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('AGENT_TYPE = "claude_code"');
  });

  it('should include all three adapter definitions', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('claudeAdapter');
    expect(script).toContain('openCodeAdapter');
    expect(script).toContain('codexAdapter');
  });

  it('should include adapter registry', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('claude_code: claudeAdapter');
    expect(script).toContain('open_code: openCodeAdapter');
    expect(script).toContain('codex: codexAdapter');
  });

  it('should use normalized message types (claude_message, claude_exit, claude_error)', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"claude_message"');
    expect(script).toContain('"claude_exit"');
    expect(script).toContain('"claude_error"');
  });

  it('should handle start_claude messages', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"start_claude"');
    expect(script).toContain('handleStartAgent');
  });

  it('should escape projectDir with double quotes', () => {
    const script = getBridgeScript(8080, '/home/user/"test"');
    expect(script).toContain('\\"test\\"');
  });
});

describe('Claude adapter', () => {
  it('should spawn with correct CLI args in generated code', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('"--output-format", "stream-json"');
    expect(script).toContain('"--input-format", "stream-json"');
    expect(script).toContain('"--dangerously-skip-permissions"');
    expect(script).toContain('"--verbose"');
  });

  it('should use pty.spawn for Claude', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('pty.spawn("claude"');
  });

  it('should have long-lived process model', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toMatch(/claudeAdapter[\s\S]*?processModel:\s*"long-lived"/);
  });

  it('should handle plan mode with disallowed tools', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('"AskUserQuestion,Edit,Write,MultiEdit"');
  });

  it('should handle ask mode with disallowed tools', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('"AskUserQuestion,Edit,Write,MultiEdit,Bash"');
  });

  it('should pipe follow-ups as JSONL user messages', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('type: "user"');
    expect(script).toContain('role: "user"');
  });

  it('should pipe user answers as tool_result', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('type: "tool_result"');
    expect(script).toContain('tool_use_id');
  });

  it('should pass ANTHROPIC_API_KEY to Claude process', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('ANTHROPIC_API_KEY: API_KEY');
  });

  it('should support --resume for session continuation', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('"--resume"');
  });

  it('should support --model flag', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'claude_code');
    expect(script).toContain('"--model"');
  });
});

describe('OpenCode adapter', () => {
  it('should use opencode run with --format json', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toContain('"run", "--format", "json"');
  });

  it('should use the full opencode binary path', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toContain('/home/daytona/.opencode/bin/opencode');
  });

  it('should have per-prompt process model', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toMatch(/openCodeAdapter[\s\S]*?processModel:\s*"per-prompt"/);
  });

  it('should normalize OpenCode tool names to Claude-style names', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toContain('bash: "Bash"');
    expect(script).toContain('read: "Read"');
    expect(script).toContain('glob: "Glob"');
    expect(script).toContain('grep: "Grep"');
    expect(script).toContain('apply_patch: "Write"');
  });

  it('should emit system init with sessionID', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toContain('type: "system"');
    expect(script).toContain('subtype: "init"');
    expect(script).toContain('session_id:');
  });

  it('should emit result event on step_finish with reason stop', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toContain('type: "result"');
    expect(script).toContain('subtype: "success"');
    expect(script).toContain('total_cost_usd:');
  });

  it('should support --session for follow-ups', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toContain('"--session"');
  });

  it('should return null from sendFollowUp (per-prompt respawn)', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'open_code');
    expect(script).toMatch(/openCodeAdapter[\s\S]*?sendFollowUp[\s\S]*?return null/);
  });
});

describe('Codex adapter', () => {
  it('should spawn codex app-server with stdio', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"codex", ["app-server", "--listen", "stdio://"]');
  });

  it('should have long-lived process model', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toMatch(/codexAdapter[\s\S]*?processModel:\s*"long-lived"/);
  });

  it('should send initialize JSON-RPC on spawn', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('method: "initialize"');
    expect(script).toContain('clientInfo');
    expect(script).toContain('"apex"');
  });

  it('should send initialized notification after handshake', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('method: "initialized"');
  });

  it('should send thread/start after initialize', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"thread/start"');
    expect(script).toContain('"danger-full-access"');
    expect(script).toContain('approvalPolicy');
  });

  it('should send turn/start with user prompt', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"turn/start"');
    expect(script).toContain('threadId');
  });

  it('should handle thread/started notification and capture threadId', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"thread/started"');
    expect(script).toContain('entry.threadId');
  });

  it('should normalize commandExecution items to Bash tool_use', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"commandExecution"');
    expect(script).toContain('name: "Bash"');
  });

  it('should normalize agentMessage items to text content blocks', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"agentMessage"');
    expect(script).toContain('type: "text"');
  });

  it('should normalize fileChange items to Write tool_use', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"fileChange"');
    expect(script).toContain('name: "Write"');
  });

  it('should handle item/agentMessage/delta for text streaming', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"item/agentMessage/delta"');
    expect(script).toContain('textBuf');
  });

  it('should handle turn/completed and emit result event', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toContain('"turn/completed"');
    expect(script).toContain('type: "result"');
  });

  it('should send follow-up turns via turn/start on same thread', () => {
    const script = getBridgeScript(8080, '/tmp/test', 'codex');
    expect(script).toMatch(/codexAdapter[\s\S]*?sendFollowUp[\s\S]*?turn\/start/);
  });
});

describe('Bridge core routing', () => {
  it('should route start_claude to handleStartAgent', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('if (msg.type === "start_claude") { handleStartAgent(msg)');
  });

  it('should route claude_user_answer to handleUserAnswer', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('msg.type === "claude_user_answer"');
    expect(script).toContain('handleUserAnswer(msg)');
  });

  it('should route stop_claude to handleStopAgent', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('msg.type === "stop_claude"');
    expect(script).toContain('handleStopAgent(msg)');
  });

  it('should select adapter based on agentType field in message', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('msg.agentType || AGENT_TYPE');
  });

  it('should fall back to AGENT_TYPE constant when no agentType in message', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('|| AGENT_TYPE');
  });

  it('should kill all agent processes on WS disconnect', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('Orchestrator disconnected');
    expect(script).toContain('adapter.kill');
  });

  it('should handle per-prompt adapter by respawning on follow-up', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('processModel === "long-lived"');
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
    expect(script).toContain('parseNetstatOutput');
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
    const pendingCount = (script.match(/"ask_user_resolved"/g) || []).length;
    expect(pendingCount).toBeGreaterThanOrEqual(2); // resolve + timeout
  });

  it('should check pendingAskUser before adapter sendUserAnswer', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('pendingAskUser.get(msg.toolUseId)');
  });

  it('should emit bridge_ready on connection', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"bridge_ready"');
  });
});
