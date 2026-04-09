const TOKEN_KEY = 'apex_mobile_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function getBaseUrl(): string {
  return window.location.origin;
}

async function request<T>(path: string): Promise<T> {
  const resp = await fetch(`${getBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (resp.status === 401) {
    clearToken();
    window.location.hash = '#/auth';
    throw new Error('Unauthorized');
  }
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return resp.json();
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  gitRepo: string | null;
  sandboxId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  status: string;
  agentType: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export interface Message {
  id: string;
  taskId: string;
  role: string;
  content: ContentBlock[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export const api = {
  health: () => request<{ status: string; projects: number; threads: number }>('/health'),
  projects: () => request<Project[]>('/projects'),
  projectThreads: (projectId: string) => request<Thread[]>(`/projects/${projectId}/threads`),
  threadMessages: (threadId: string) => request<Message[]>(`/threads/${threadId}/messages`),
};
