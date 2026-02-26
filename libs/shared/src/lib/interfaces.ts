import {
  AgentType,
  MessageRole,
  ProjectStatus,
  TaskStatus,
} from './enums.js';

// ── User ─────────────────────────────────────────────
export interface IUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  oauthProvider: string | null;
  oauthProviderId: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

// ── Project ──────────────────────────────────────────
export interface IAgentConfig {
  model?: string;
  snapshotOverride?: string;
  apiKeyRef?: string; // reference, never the raw key
  [key: string]: unknown;
}

export interface IProject {
  id: string;
  userId: string;
  name: string;
  description: string;
  sandboxId: string | null;
  sandboxSnapshot: string;
  status: ProjectStatus;
  agentType: AgentType;
  agentConfig: IAgentConfig;
  forkedFromId: string | null;
  branchName: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Task ─────────────────────────────────────────────
export interface ITask {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

// ── Message ──────────────────────────────────────────
export interface IContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
}

export interface IMessageMetadata {
  model?: string;
  stopReason?: string | null;
  costUsd?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  [key: string]: unknown;
}

export interface IMessage {
  id: string;
  taskId: string;
  role: MessageRole;
  content: IContentBlock[];
  metadata: IMessageMetadata;
  createdAt: string;
}
