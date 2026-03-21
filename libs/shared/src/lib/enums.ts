// ── Project ──────────────────────────────────────────
export enum ProjectStatus {
  Creating = 'creating',
  Starting = 'starting',
  Running = 'running',
  Stopped = 'stopped',
  Error = 'error',
}

export enum AgentType {
  Build = 'build',
  Plan = 'plan',
  Sisyphus = 'sisyphus',
}

export enum SandboxProvider {
  Daytona = 'daytona',
  Docker = 'docker',
}

// ── Task ─────────────────────────────────────────────
export enum TaskStatus {
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
