import { Sandbox } from '@daytonaio/sdk';

// SDK Message Types (from Claude Agent SDK)
export interface SDKUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  parent_tool_use_id: string | null;
  session_id: string;
  uuid?: string;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export interface SDKSystemMessage {
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

export interface SDKAssistantMessage {
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

export interface SDKResultMessage {
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

export type SDKMessage = SDKSystemMessage | SDKAssistantMessage | SDKResultMessage;

// Orchestrator Types
export interface TaskDefinition {
  id: string;
  name: string;
  prompt: string;
  workingDir?: string;
}

export interface OrchestratorSession {
  id: string;
  taskId: string;
  taskName: string;
  sandbox: Sandbox;
  sandboxId: string;
  status: 'connecting' | 'initializing' | 'running' | 'completed' | 'error';
  websocket?: WebSocket;
  claudeSessionId?: string;
  model?: string;
  tools?: string[];
  messages: SDKMessage[];
  result?: string;
  error?: string;
  costUsd?: number;
  startTime: number;
  endTime?: number;
}

export interface OrchestratorConfig {
  wsPort: number;
  wsHost: string;
  daytonaApiKey?: string;
  anthropicApiKey?: string;
  snapshot?: string;
  timeoutMs?: number;
}

export interface TaskResult {
  taskId: string;
  taskName: string;
  sandboxId: string;
  status: 'success' | 'error';
  result?: string;
  error?: string;
  durationMs: number;
  costUsd?: number;
  previewUrls?: Record<number, string>;
}
