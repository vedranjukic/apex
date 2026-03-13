// ── Project ──────────────────────────────────────────
export enum ProjectStatus {
  Creating = 'creating',
  Starting = 'starting',
  Running = 'running',
  Stopped = 'stopped',
  Error = 'error',
}

export enum AgentType {
  ClaudeCode = 'claude_code',
  OpenCode = 'open_code',
  Codex = 'codex',
}

// ── Task ─────────────────────────────────────────────
export enum TaskStatus {
  Idle = 'idle',
  Running = 'running',
  WaitingForInput = 'waiting_for_input',
  Completed = 'completed',
  Error = 'error',
}

// ── Message ──────────────────────────────────────────
export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
  ToolUse = 'tool_use',
  ToolResult = 'tool_result',
}
