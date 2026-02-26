import { AgentType, ProjectStatus, TaskStatus } from './enums.js';
import { IAgentConfig, IContentBlock, IMessageMetadata } from './interfaces.js';

// ── User DTOs ────────────────────────────────────────
export interface CreateUserDto {
  email: string;
  name: string;
  avatarUrl?: string;
  oauthProvider?: string;
  oauthProviderId?: string;
}

export interface UpdateUserDto {
  name?: string;
  avatarUrl?: string;
}

// ── Project DTOs ─────────────────────────────────────
export interface CreateProjectDto {
  name: string;
  description?: string;
  agentType: AgentType;
  sandboxSnapshot?: string;
  agentConfig?: IAgentConfig;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  agentConfig?: IAgentConfig;
}

// ── Task DTOs ────────────────────────────────────────
export interface CreateTaskDto {
  title: string;
  prompt: string; // initial prompt sent to the agent
}

export interface UpdateTaskDto {
  title?: string;
  status?: TaskStatus;
}

// ── Message DTOs ─────────────────────────────────────
export interface CreateMessageDto {
  role: string;
  content: IContentBlock[];
  metadata?: IMessageMetadata;
}

// ── WebSocket Events ─────────────────────────────────
export interface WsSendPrompt {
  event: 'send_prompt';
  data: {
    taskId: string;
    prompt: string;
  };
}

export interface WsAgentMessage {
  event: 'agent_message';
  data: {
    taskId: string;
    message: {
      role: string;
      content: IContentBlock[];
      metadata?: IMessageMetadata;
    };
  };
}

export interface WsAgentStatus {
  event: 'agent_status';
  data: {
    taskId: string;
    status: TaskStatus;
  };
}

export interface WsAgentError {
  event: 'agent_error';
  data: {
    taskId: string;
    error: string;
  };
}

export type WsClientEvent = WsSendPrompt;
export type WsServerEvent = WsAgentMessage | WsAgentStatus | WsAgentError;

// ── SSH Access ──────────────────────────────────────
export interface SshAccessResponse {
  sshUser: string;
  sshHost: string;
  sshPort: number;
  sandboxId: string;
  remotePath: string;
  expiresAt: string;
}

export interface OpenInIDEParams {
  ide: 'cursor' | 'vscode';
  sshUser: string;
  sshHost: string;
  sshPort: number;
  sandboxId: string;
  remotePath: string;
}
