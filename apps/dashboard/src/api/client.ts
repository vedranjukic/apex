const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Users ─────────────────────────────────────────────
export const usersApi = {
  me: () => request<any>('/users/me'),
};

// ── Projects ──────────────────────────────────────────
export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string;
  sandboxId: string | null;
  sandboxSnapshot: string;
  status: string;
  statusError: string | null;
  agentType: string;
  gitRepo: string | null;
  agentConfig: Record<string, unknown> | null;
  forkedFromId: string | null;
  branchName: string | null;
  chats?: Chat[];
  createdAt: string;
  updatedAt: string;
}

export const projectsApi = {
  list: () => request<Project[]>('/projects'),
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (data: { name: string; description?: string; agentType?: string; gitRepo?: string }) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Project>) =>
    request<Project>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  getVscodeUrl: (id: string) =>
    request<{ url: string; token: string }>(`/projects/${id}/vscode-url`),
  createSshAccess: (id: string) =>
    request<{
      sshUser: string;
      sshHost: string;
      sshPort: number;
      sandboxId: string;
      remotePath: string;
      expiresAt: string;
    }>(`/projects/${id}/ssh-access`, { method: 'POST' }),
  fork: (id: string, branchName: string) =>
    request<Project>(`/projects/${id}/fork`, {
      method: 'POST',
      body: JSON.stringify({ branchName }),
    }),
  getForks: (id: string) =>
    request<Project[]>(`/projects/${id}/forks`),
};

// ── Chats ─────────────────────────────────────────────
export interface Chat {
  id: string;
  projectId: string;
  title: string;
  status: string;
  mode: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

export interface Message {
  id: string;
  taskId: string; // DB column name (internal)
  role: string;
  content: ContentBlock[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

// ── Config ────────────────────────────────────────────
export const configApi = {
  keybindings: () => request<Record<string, string>>('/config/keybindings'),
};

// ── Settings ─────────────────────────────────────────
export const settingsApi = {
  visible: () => request<{ visible: boolean }>('/settings/visible'),
  get: () => request<Record<string, string>>('/settings'),
  update: (settings: Record<string, string>) =>
    request<{ ok: boolean }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};

// ── Chats ─────────────────────────────────────────────
export const chatsApi = {
  listByProject: (projectId: string, search?: string) => {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<Chat[]>(`/projects/${projectId}/chats${q}`);
  },
  get: (id: string) => request<Chat>(`/chats/${id}`),
  create: (projectId: string, data: { prompt: string }) =>
    request<Chat>(`/projects/${projectId}/chats`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  messages: (id: string) => request<Message[]>(`/chats/${id}/messages`),
  updateStatus: (id: string, status: string) =>
    request<Chat>(`/chats/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/chats/${id}`, { method: 'DELETE' }),
};
