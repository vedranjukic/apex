/**
 * Internal types for the orchestrator bridge layer.
 * These mirror the OpenCode agent WebSocket protocol.
 */

// ── Agent message types ─────────────────────────────
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export interface AgentSystemMessage {
  type: 'system';
  subtype: 'init';
  cwd: string;
  session_id: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: string;
  uuid: string;
}

export interface AgentAssistantMessage {
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

export interface AgentResultMessage {
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

export type AgentMessage =
  | AgentSystemMessage
  | AgentAssistantMessage
  | AgentResultMessage;

// ── Bridge protocol (sandbox <-> orchestrator) ───────
export interface BridgeReadyMessage {
  type: 'bridge_ready';
  port: number;
  sessionId?: string;
}

export interface BridgeAgentMessage {
  type: 'agent_message';
  threadId?: string;
  data: AgentMessage;
}

export interface BridgeAgentStdout {
  type: 'agent_stdout';
  threadId?: string;
  data: string;
}

export interface BridgeAgentStderr {
  type: 'agent_stderr';
  threadId?: string;
  data: string;
}

export interface BridgeAgentExit {
  type: 'agent_exit';
  threadId?: string;
  code: number;
}

export interface BridgeAgentInput {
  type: 'agent_input';
  threadId?: string;
  data: string;
}

export interface BridgeAgentError {
  type: 'agent_error';
  threadId?: string;
  error: string;
}

export interface BridgeCatchup {
  type: 'agent_catchup';
  threadId: string;
  blocks: Array<{ type: string; [key: string]: unknown }>;
}

export interface BridgeAgentUserAnswer {
  type: 'agent_user_answer';
  threadId: string;
  toolUseId: string;
  answer: string;
}

export interface BridgeAskUserPending {
  type: 'ask_user_pending';
  threadId: string;
  questionId: string;
}

export interface BridgeAskUserResolved {
  type: 'ask_user_resolved';
  threadId: string;
  questionId: string;
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

// ── LSP bridge messages ─────────────────────────────

export interface BridgeLspData {
  type: 'lsp_data';
  language: string;
  jsonrpc: Record<string, unknown>;
}

export interface BridgeLspResponse {
  type: 'lsp_response';
  language: string;
  jsonrpc: Record<string, unknown>;
}

export type LspServerStatus = 'starting' | 'ready' | 'error' | 'stopped';

export interface BridgeLspStatus {
  type: 'lsp_status';
  language: string;
  status: LspServerStatus;
  error?: string;
}

// ── Port scanning types ─────────────────────────────

export interface PortInfo {
  port: number;
  protocol: 'tcp';
  process: string;
  command: string;
}

export interface BridgePortsUpdate {
  type: 'ports_update';
  ports: PortInfo[];
}

// ── Port relay types ──────────────────────────────────

export interface BridgePortRelayStarted {
  type: 'port_relay_started';
  targetPort: number;
  localPort: number;
}

export interface BridgePortRelayStopped {
  type: 'port_relay_stopped';
  targetPort: number;
}

export interface BridgePortRelayError {
  type: 'port_relay_error';
  port: number;
  error: string;
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
  activeThreadId: string | null;
}

export interface BridgeLayoutSaved {
  type: 'layout_saved';
  ok: boolean;
}

export interface BridgeLayoutData {
  type: 'layout_data';
  data: LayoutData | null;
}

export interface BridgeRunningSessions {
  type: 'running_sessions';
  sessions: Array<{ threadId: string; sessionId: string }>;
}

export interface BridgeStartAgentAck {
  type: 'start_agent_ack';
  threadId: string;
  status: 'processing' | 'started' | 'failed';
  sessionId?: string;
  error?: string;
}

// ── Union of all bridge messages ─────────────────────

export type BridgeMessage =
  | BridgeReadyMessage
  | BridgeAgentMessage
  | BridgeAgentInput
  | BridgeAgentStdout
  | BridgeAgentStderr
  | BridgeAgentExit
  | BridgeAgentError
  | BridgeCatchup
  | BridgeAgentUserAnswer
  | BridgeAskUserPending
  | BridgeAskUserResolved
  | BridgeTerminalCreated
  | BridgeTerminalOutput
  | BridgeTerminalExit
  | BridgeTerminalError
  | BridgeTerminalList
  | BridgeLayoutSaved
  | BridgeLayoutData
  | BridgeFileChanged
  | BridgePortsUpdate
  | BridgePortRelayStarted
  | BridgePortRelayStopped
  | BridgePortRelayError
  | BridgeLspData
  | BridgeLspResponse
  | BridgeLspStatus
  | BridgeRunningSessions
  | BridgeStartAgentAck;

// ── Sandbox session tracking ─────────────────────────
export type SandboxSessionStatus =
  | 'creating'
  | 'cloning_repo'
  | 'starting_bridge'
  | 'connecting'
  | 'running'
  | 'waiting_for_input'
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

export interface SandboxAdvancedSettings {
  customImage?: string;
  environmentVariables?: Record<string, string>;
  memoryMB?: number;
  cpus?: number;
  diskGB?: number;
}

export interface OrchestratorConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  githubToken?: string;
  snapshot?: string;
  /** Container image for Docker / Apple Container providers. */
  image?: string;
  timeoutMs?: number;
  /** Sandbox provider backend. Defaults to `"daytona"`. */
  provider?: 'daytona' | 'docker' | 'apple-container' | 'local';
  /** Base URL of the LLM proxy (e.g. `http://localhost:6000` or a Daytona
   *  proxy sandbox preview URL).  When set, containers receive proxy URLs
   *  instead of raw API keys. */
  proxyBaseUrl?: string;
  /** Auth token that regular sandboxes send as their "API key" to the LLM
   *  proxy.  When set, used instead of the hardcoded `sk-proxy-placeholder`. */
  proxyAuthToken?: string;
  /** PEM-encoded CA certificate for the MITM secrets proxy. */
  secretsProxyCaCert?: string;
  /** Port the MITM secrets proxy listens on (default 9350). */
  secretsProxyPort?: number;
  /** Base URL of the Apex API server for secrets proxy resolution.
   *  Separate from `proxyBaseUrl` because the LLM proxy may live on a
   *  different host (e.g. a Daytona proxy sandbox) while the secrets proxy
   *  always runs alongside the Apex API. */
  secretsProxyBaseUrl?: string;
  /** Secret env var names to write as placeholders in the container .env.
   *  SDKs can initialize with the placeholder; the proxy replaces it at HTTP level. */
  secretPlaceholders?: Record<string, string>;
  /** Memory allocation in MB for container sandboxes. Defaults to 4096 (4 GB). */
  memoryMB?: number;
  /** Number of CPU cores for container sandboxes. */
  cpus?: number;
  /** Git author name for commits inside sandboxes. */
  gitUserName?: string;
  /** Git author email for commits inside sandboxes. */
  gitUserEmail?: string;
}
