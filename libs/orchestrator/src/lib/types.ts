/**
 * Internal types for the orchestrator bridge layer.
 * These mirror the Claude Agent SDK WebSocket protocol.
 */

// ── Claude SDK message types ─────────────────────────
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export interface ClaudeSystemMessage {
  type: 'system';
  subtype: 'init';
  cwd: string;
  session_id: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: string;
  claude_code_version: string;
  uuid: string;
}

export interface ClaudeAssistantMessage {
  type: 'assistant';
  message: {
    model: string;
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    stop_reason: string | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  parent_tool_use_id: string | null;
  session_id: string;
  uuid: string;
}

export interface ClaudeResultMessage {
  type: 'result';
  subtype: 'success' | 'error';
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  stop_reason: string | null;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  permission_denials: unknown[];
  uuid: string;
}

export type ClaudeMessage =
  | ClaudeSystemMessage
  | ClaudeAssistantMessage
  | ClaudeResultMessage;

// ── Bridge protocol (sandbox <-> orchestrator) ───────
export interface BridgeReadyMessage {
  type: 'bridge_ready';
  port: number;
  sessionId?: string;
}

export interface BridgeClaudeMessage {
  type: 'claude_message';
  chatId?: string;
  data: ClaudeMessage;
}

export interface BridgeClaudeStdout {
  type: 'claude_stdout';
  chatId?: string;
  data: string;
}

export interface BridgeClaudeStderr {
  type: 'claude_stderr';
  chatId?: string;
  data: string;
}

export interface BridgeClaudeExit {
  type: 'claude_exit';
  chatId?: string;
  code: number;
}

export interface BridgeClaudeInput {
  type: 'claude_input';
  chatId?: string;
  data: string;
}

export interface BridgeClaudeError {
  type: 'claude_error';
  chatId?: string;
  error: string;
}

export interface BridgeClaudeUserAnswer {
  type: 'claude_user_answer';
  chatId: string;
  toolUseId: string;
  answer: string;
}

// ── Terminal bridge messages ─────────────────────────

export interface BridgeTerminalCreated {
  type: 'terminal_created';
  terminalId: string;
  name: string;
}

export interface BridgeTerminalOutput {
  type: 'terminal_output';
  terminalId: string;
  data: string;
}

export interface BridgeTerminalExit {
  type: 'terminal_exit';
  terminalId: string;
  exitCode: number;
}

export interface BridgeTerminalError {
  type: 'terminal_error';
  terminalId: string;
  error: string;
}

export interface BridgeTerminalListEntry {
  id: string;
  name: string;
  cols: number;
  rows: number;
  scrollback: string;
}

export interface BridgeTerminalList {
  type: 'terminal_list';
  terminals: BridgeTerminalListEntry[];
}

// ── Port scanning types ─────────────────────────────

export interface PortInfo {
  port: number;
  protocol: 'tcp';
  process: string;
}

export interface BridgePortsUpdate {
  type: 'ports_update';
  ports: PortInfo[];
}

// ── File system types ────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface BridgeFileChanged {
  type: 'file_changed';
  dirs: string[];
}

// ── Search types ─────────────────────────────────────

export interface SearchMatch {
  line: number;
  content: string;
}

export interface SearchResult {
  filePath: string;
  matches: SearchMatch[];
}

// ── Git types ────────────────────────────────────────

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface GitFileEntry {
  path: string;
  status: GitFileStatus;
  oldPath?: string;
}

export interface GitStatusData {
  branch: string | null;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  conflicted: GitFileEntry[];
  ahead: number;
  behind: number;
}

export interface GitBranchEntry {
  name: string;
  lastUsed: number;
  isCurrent: boolean;
  isRemote: boolean;
}

// ── Layout persistence messages ──────────────────────

export interface LayoutData {
  terminalPanelOpen: boolean;
  terminalPanelHeight: number;
  activeTerminalId: string | null;
  activeChatId: string | null;
}

export interface BridgeLayoutSaved {
  type: 'layout_saved';
  ok: boolean;
}

export interface BridgeLayoutData {
  type: 'layout_data';
  data: LayoutData | null;
}

// ── Union of all bridge messages ─────────────────────

export type BridgeMessage =
  | BridgeReadyMessage
  | BridgeClaudeMessage
  | BridgeClaudeInput
  | BridgeClaudeStdout
  | BridgeClaudeStderr
  | BridgeClaudeExit
  | BridgeClaudeError
  | BridgeClaudeUserAnswer
  | BridgeTerminalCreated
  | BridgeTerminalOutput
  | BridgeTerminalExit
  | BridgeTerminalError
  | BridgeTerminalList
  | BridgeLayoutSaved
  | BridgeLayoutData
  | BridgeFileChanged
  | BridgePortsUpdate;

// ── Sandbox session tracking ─────────────────────────
export type SandboxSessionStatus =
  | 'creating'
  | 'cloning_repo'
  | 'starting_bridge'
  | 'connecting'
  | 'running'
  | 'completed'
  | 'error';

export interface SandboxSession {
  id: string;
  sandboxId: string;
  previewUrl: string | null;
  previewToken: string | null;
  bridgeSessionId: string | null;
  status: SandboxSessionStatus;
  messages: BridgeMessage[];
  result?: string;
  error?: string;
  costUsd?: number;
  startTime: number;
  endTime?: number;
}

export interface OrchestratorConfig {
  anthropicApiKey?: string;
  snapshot?: string;
  timeoutMs?: number;
}
