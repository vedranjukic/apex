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
  provider: string;
  status: ProjectStatus;
  agentType: AgentType | string;
  agentConfig: IAgentConfig;
  forkedFromId: string | null;
  branchName: string | null;
  mergeStatus: IMergeStatusData | null;
  createdAt: string;
  updatedAt: string;
}

// ── Task ─────────────────────────────────────────────
export interface ITask {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  agentType?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Message ──────────────────────────────────────────
export interface IImageSource {
  type: 'base64';
  media_type: string;
  data: string;
}

export interface IContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
  source?: IImageSource;
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

// ── Merge Status ─────────────────────────────────────
export interface IMergeStatusData {
  mergeable: boolean | null;
  mergeable_state: string;
  checks_status: 'pending' | 'success' | 'failure' | 'neutral';
  merge_behind_by: number;
  last_checked: string;
  pr_state: 'open' | 'closed' | 'merged';
}

// ── Secrets ──────────────────────────────────────────
export interface ISecret {
  id: string;
  userId: string;
  projectId: string | null;
  repositoryId: string | null; // GitHub repository in "owner/repo" format
  name: string;
  value: string;
  domain: string;
  authType: string;
  isSecret: boolean; // true for secrets, false for environment variables
  description: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface ISecretListItem {
  id: string;
  name: string;
  domain: string;
  authType: string;
  isSecret: boolean;
  description: string | null;
  projectId: string | null;
  repositoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateSecretInput {
  name: string;
  value: string;
  domain: string;
  authType?: string;
  isSecret?: boolean;
  description?: string;
  projectId?: string | null;
  repositoryId?: string | null;
}
