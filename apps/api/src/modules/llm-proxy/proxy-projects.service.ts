/**
 * HTTP client for the project registry API running on the Daytona proxy sandbox.
 * All calls are fire-and-forget with error logging — they never block or fail
 * the main project operation.
 */

import { proxySandboxService } from './proxy-sandbox.service';

export interface ProjectSyncPayload {
  id: string;
  name: string;
  description: string;
  status: string;
  gitRepo: string | null;
  sandboxId: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RemoteProjectInfo {
  id: string;
  name: string;
  description: string;
  status: string;
  gitRepo: string | null;
  sandboxId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSyncPayload {
  id: string;
  projectId: string;
  title: string;
  status: string;
  agentType: string | null;
  model: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MessageSyncPayload {
  id: string;
  taskId: string;
  role: string;
  content: unknown[];
  metadata: unknown;
  createdAt: string;
}

class ProxyProjectsService {
  private getConnectionInfo(): { projectsApiUrl: string; authToken: string } | null {
    const info = proxySandboxService.getCachedInfo();
    if (!info?.projectsApiUrl || !info?.authToken) return null;
    return { projectsApiUrl: info.projectsApiUrl, authToken: info.authToken };
  }

  async syncProject(project: ProjectSyncPayload): Promise<void> {
    const conn = this.getConnectionInfo();
    if (!conn) return;

    try {
      const resp = await fetch(`${conn.projectsApiUrl}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${conn.authToken}`,
        },
        body: JSON.stringify(project),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.warn(`[proxy-projects] sync failed (${resp.status}): ${body}`);
      }
    } catch (err) {
      console.warn('[proxy-projects] sync error:', (err as Error).message);
    }
  }

  async removeProject(projectId: string): Promise<void> {
    const conn = this.getConnectionInfo();
    if (!conn) return;

    try {
      const resp = await fetch(`${conn.projectsApiUrl}/projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${conn.authToken}`,
        },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.warn(`[proxy-projects] remove failed (${resp.status}): ${body}`);
      }
    } catch (err) {
      console.warn('[proxy-projects] remove error:', (err as Error).message);
    }
  }

  async syncThread(thread: ThreadSyncPayload): Promise<void> {
    const conn = this.getConnectionInfo();
    if (!conn) return;

    try {
      const resp = await fetch(`${conn.projectsApiUrl}/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${conn.authToken}`,
        },
        body: JSON.stringify(thread),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.warn(`[proxy-projects] syncThread failed (${resp.status}): ${body}`);
      }
    } catch (err) {
      console.warn('[proxy-projects] syncThread error:', (err as Error).message);
    }
  }

  async removeThread(threadId: string): Promise<void> {
    const conn = this.getConnectionInfo();
    if (!conn) return;

    try {
      const resp = await fetch(`${conn.projectsApiUrl}/threads/${threadId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${conn.authToken}` },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.warn(`[proxy-projects] removeThread failed (${resp.status}): ${body}`);
      }
    } catch (err) {
      console.warn('[proxy-projects] removeThread error:', (err as Error).message);
    }
  }

  async syncMessages(threadId: string, messages: MessageSyncPayload[]): Promise<void> {
    const conn = this.getConnectionInfo();
    if (!conn) return;

    try {
      const resp = await fetch(`${conn.projectsApiUrl}/threads/${threadId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${conn.authToken}`,
        },
        body: JSON.stringify(messages),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.warn(`[proxy-projects] syncMessages failed (${resp.status}): ${body}`);
      }
    } catch (err) {
      console.warn('[proxy-projects] syncMessages error:', (err as Error).message);
    }
  }

  async fetchPendingPrompts(): Promise<Array<{
    id: string;
    threadId: string;
    projectId: string;
    prompt: string;
  }>> {
    const conn = this.getConnectionInfo();
    if (!conn) return [];

    try {
      const resp = await fetch(`${conn.projectsApiUrl}/prompts/pending`, {
        headers: { 'Authorization': `Bearer ${conn.authToken}` },
      });
      if (!resp.ok) return [];
      return await resp.json();
    } catch {
      return [];
    }
  }

  async acknowledgePrompt(promptId: string): Promise<void> {
    const conn = this.getConnectionInfo();
    if (!conn) return;

    try {
      await fetch(`${conn.projectsApiUrl}/prompts/${promptId}/ack`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${conn.authToken}` },
      });
    } catch {
      // non-fatal
    }
  }

  async listProjects(): Promise<RemoteProjectInfo[]> {
    const conn = this.getConnectionInfo();
    if (!conn) return [];

    try {
      const resp = await fetch(`${conn.projectsApiUrl}/projects`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${conn.authToken}`,
        },
      });
      if (!resp.ok) {
        console.warn(`[proxy-projects] list failed (${resp.status})`);
        return [];
      }
      return await resp.json() as RemoteProjectInfo[];
    } catch (err) {
      console.warn('[proxy-projects] list error:', (err as Error).message);
      return [];
    }
  }
}

export const proxyProjectsService = new ProxyProjectsService();
