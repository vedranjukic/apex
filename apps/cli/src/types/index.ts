export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  sandboxId?: string;
  provider: 'daytona' | 'docker' | 'local' | 'apple-container';
  status: 'creating' | 'running' | 'stopped' | 'error';
  agentType: 'build' | 'plan' | 'sisyphus';
  gitRepo?: string;
  agentConfig: Record<string, any>;
  localDir?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title?: string;
  status: 'active' | 'completed' | 'error';
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  tokenCount?: number;
  createdAt: string;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;
  input?: any;
  content?: any;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface Settings {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CliConfig {
  dbPath: string;
  anthropicApiKey?: string;
  daytonaApiKey?: string;
  daytonaApiUrl?: string;
  openaiApiKey?: string;
  defaultProvider: Project['provider'];
  defaultAgentType: Project['agentType'];
}

export interface BridgeMessage {
  type: string;
  data: any;
  timestamp?: number;
}

export interface AgentOutput {
  type: 'content' | 'tool_use' | 'tool_result' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: any;
  isError?: boolean;
}