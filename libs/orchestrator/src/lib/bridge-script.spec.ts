/**
 * Tests for the OpenCode-only bridge script.
 *
 * Validates that:
 * 1. getBridgeScript() generates valid JS with the OpenCode adapter
 * 2. The OpenCode adapter normalizes output into the expected format
 * 3. The bridge core routes messages correctly
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

  it('should not include Claude or Codex adapters', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).not.toContain('claudeAdapter');
    expect(script).not.toContain('codexAdapter');
    expect(script).not.toContain('app-server');
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

describe('OpenCode adapter', () => {
  it('should use opencode run with --format json', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"run", "--format", "json"');
  });

  it('should use the full opencode binary path', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('/home/daytona/.opencode/bin/opencode');
  });

  it('should support --agent flag for agent selection', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"--agent"');
  });

  it('should support -m flag for model selection', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"-m"');
  });

  it('should normalize OpenCode tool names to Claude-style names', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('bash: "Bash"');
    expect(script).toContain('read: "Read"');
    expect(script).toContain('glob: "Glob"');
    expect(script).toContain('grep: "Grep"');
    expect(script).toContain('apply_patch: "Write"');
  });

  it('should emit system init with sessionID', () => {
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

  it('should support --session for follow-ups', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"--session"');
  });

  it('should default agent to build when not specified', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('agent || "build"');
  });
});

describe('Bridge core routing', () => {
  it('should route start_claude to handleStartAgent', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('"start_claude"');
    expect(script).toContain('handleStartAgent(msg)');
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

  it('should read agent name from msg.agent or msg.agentType', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('msg.agent || msg.agentType');
  });

  it('should kill all agent processes on WS disconnect', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('Orchestrator disconnected');
    expect(script).toContain('killEntry');
  });

  it('should always respawn (per-prompt model)', () => {
    const script = getBridgeScript(8080, '/tmp/test');
    expect(script).toContain('Killing existing OpenCode');
    expect(script).not.toContain('processModel');
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
});
