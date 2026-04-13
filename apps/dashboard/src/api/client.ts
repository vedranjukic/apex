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
export interface GitHubContextData {
  type: 'issue' | 'pull';
  number: number;
  title: string;
  body: string;
  url: string;
  branch?: string;
  labels?: string[];
}

export interface MergeStatusData {
  mergeable: boolean | null;
  mergeable_state: string;
  checks_status: 'pending' | 'success' | 'failure' | 'neutral';
  merge_behind_by: number;
  last_checked: string;
  pr_state: 'open' | 'closed' | 'merged';
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string;
  sandboxId: string | null;
  sandboxSnapshot: string;
  provider: string;
  status: string;
  statusError: string | null;
  agentType: string;
  gitRepo: string | null;
  agentConfig: Record<string, unknown> | null;
  githubContext: GitHubContextData | null;
  forkedFromId: string | null;
  branchName: string | null;
  mergeStatus: MergeStatusData | null;
  threads?: Thread[];
  createdAt: string;
  updatedAt: string;
}

export const projectsApi = {
  list: () => request<Project[]>('/projects'),
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (data: { name: string; description?: string; agentType?: string; provider?: string; gitRepo?: string; gitBranch?: string; localDir?: string; githubContext?: GitHubContextData; autoStartPrompt?: string; sandboxConfig?: { customImage?: string; environmentVariables?: Record<string, string>; memoryMB?: number; cpus?: number; diskGB?: number } }) =>
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
  stop: (id: string) =>
    request<Project>(`/projects/${id}/stop`, { method: 'POST' }),
  start: (id: string) =>
    request<Project>(`/projects/${id}/start`, { method: 'POST' }),
  restart: (id: string) =>
    request<Project>(`/projects/${id}/restart`, { method: 'POST' }),
  fork: (id: string, branchName: string) =>
    request<Project>(`/projects/${id}/fork`, {
      method: 'POST',
      body: JSON.stringify({ branchName }),
    }),
  getForks: (id: string) =>
    request<Project[]>(`/projects/${id}/forks`),
};

// ── Threads ──────────────────────────────────────────
export interface ThreadPlanData {
  id: string;
  title: string;
  filename: string;
  content: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  status: string;
  mode: string | null;
  agentType: string | null;
  model: string | null;
  planData: ThreadPlanData | null;
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

export interface ImageSource {
  type: 'base64';
  media_type: string;
  data: string;
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
  source?: ImageSource;
  _streaming?: boolean;
}

// ── Config ────────────────────────────────────────────
export interface ProviderStatus {
  type: string;
  available: boolean;
  reason?: string;
}

export const configApi = {
  keybindings: () => request<Record<string, string>>('/config/keybindings'),
  providers: () => request<{ providers: ProviderStatus[] }>('/config/providers'),
};

// ── Settings ─────────────────────────────────────────
export type SettingSource = 'settings' | 'env' | 'none';

export interface SettingEntry {
  value: string;
  source: SettingSource;
}

export const settingsApi = {
  visible: () => request<{ visible: boolean }>('/settings/visible'),
  get: () => request<Record<string, SettingEntry>>('/settings'),
  update: (settings: Record<string, string>) =>
    request<{ ok: boolean }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};

// ── Secrets ──────────────────────────────────────────
export interface Secret {
  id: string;
  name: string;
  domain: string;
  authType: string;
  isSecret: boolean; // true for secrets, false for environment variables
  description: string | null;
  projectId: string | null;
  repositoryId: string | null; // GitHub repository in "owner/repo" format
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecretInput {
  name: string;
  value: string;
  domain: string;
  authType?: string;
  isSecret?: boolean;
  description?: string;
  projectId?: string | null;
  repositoryId?: string | null;
}

export const secretsApi = {
  list: (projectId?: string, repositoryId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    if (repositoryId) params.append('repositoryId', repositoryId);
    const query = params.toString();
    return request<Secret[]>(`/secrets${query ? `?${query}` : ''}`);
  },
  create: (data: CreateSecretInput) =>
    request<Secret>('/secrets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateSecretInput>) =>
    request<Secret>(`/secrets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/secrets/${id}`, { method: 'DELETE' }),
};

// ── GitHub ───────────────────────────────────────────
export interface GitHubResolveResult {
  parsed: {
    type: 'repo' | 'issue' | 'pull' | 'branch' | 'commit';
    owner: string;
    repo: string;
    cloneUrl: string;
    number?: number;
    ref?: string;
  };
  content?: GitHubContextData;
}

export interface GitHubUser {
  name: string;
  email: string;
  login: string;
  avatarUrl: string;
}

export const githubApi = {
  resolve: (url: string) =>
    request<GitHubResolveResult>(`/github/resolve?url=${encodeURIComponent(url)}`),
  user: async (): Promise<GitHubUser | null> => {
    const res = await fetch(`${BASE}/github/user`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status === 204 || !res.ok) return null;
    return res.json();
  },
};

// ── Threads ──────────────────────────────────────────
export const threadsApi = {
  listByProject: (projectId: string, search?: string) => {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<Thread[]>(`/projects/${projectId}/threads${q}`);
  },
  get: (id: string) => request<Thread>(`/threads/${id}`),
  create: (projectId: string, data: { prompt: string; agentType?: string }) =>
    request<Thread>(`/projects/${projectId}/threads`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  messages: (id: string) => request<Message[]>(`/threads/${id}/messages`),
  updateStatus: (id: string, status: string) =>
    request<Thread>(`/threads/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/threads/${id}`, { method: 'DELETE' }),
  update: (id: string, data: { title?: string }) =>
    request<Thread>(`/threads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  fork: (id: string) =>
    request<Thread>(`/threads/${id}/fork`, { method: 'POST' }),
};

// ── Repositories ─────────────────────────────────────────
export interface RepositoryInfo {
  repositoryId: string;
  secretCount: number;
  envVarCount: number;
  totalCount: number;
  projectCount: number;
  lastModified: string;
}

export const repositoriesApi = {
  list: () => request<RepositoryInfo[]>('/repositories'),
  delete: (repositoryId: string) =>
    request<{ ok: boolean }>(`/repositories/${encodeURIComponent(repositoryId)}`, { method: 'DELETE' }),
};
