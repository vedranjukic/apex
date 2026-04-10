/**
 * E2E test: Daytona proxy project registry.
 *
 * Tests the full lifecycle of the project registry API running on the
 * Daytona proxy sandbox (port 3001). Exercises:
 *   - Automatic sync on project create/update/delete via the local API
 *   - Direct CRUD against the proxy projects API
 *   - Bearer token authentication
 *   - GET /api/projects/remote aggregation endpoint
 *
 * Uses real Daytona sandboxes — skipped without DAYTONA_API_KEY.
 *
 * Environment:
 *   DAYTONA_API_KEY or DAYTONA_API_KEY_E2E - Daytona API key
 *
 * Run: yarn test:proxy-projects-e2e
 */
import axios from 'axios';
import {
  waitForApiSettled,
  createProject,
  waitForSandbox,
  deleteProject,
} from './support/e2e-helpers';

// ── Gate: skip entire suite without Daytona key ──────

const hasDaytonaKey = !!(
  process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_KEY_E2E
);
const describeE2e = hasDaytonaKey ? describe : describe.skip;

// ── Helpers ──────────────────────────────────────────

async function getSettings(): Promise<Record<string, string>> {
  const res = await axios.get('/api/settings');
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(res.data)) {
    map[key] = (entry as any).value ?? '';
  }
  return map;
}

async function getProxyProjectsUrl(): Promise<string> {
  const settings = await getSettings();
  return settings['LLM_PROXY_PROJECTS_URL'] || '';
}

async function getProxyAuthToken(): Promise<string> {
  const settings = await getSettings();
  return settings['LLM_PROXY_AUTH_TOKEN'] || '';
}

interface ProxyProject {
  id: string;
  name: string;
  description: string;
  status: string;
  gitRepo: string | null;
  sandboxId: string | null;
  createdAt: string;
  updatedAt: string;
}

async function fetchProxyProjects(
  baseUrl: string,
  token: string,
): Promise<ProxyProject[]> {
  const resp = await fetch(`${baseUrl}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`GET /projects failed: ${resp.status}`);
  return resp.json() as Promise<ProxyProject[]>;
}

async function fetchProxyProject(
  baseUrl: string,
  token: string,
  id: string,
): Promise<ProxyProject> {
  const resp = await fetch(`${baseUrl}/projects/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`GET /projects/${id} failed: ${resp.status}`);
  return resp.json() as Promise<ProxyProject>;
}

async function postProxyProject(
  baseUrl: string,
  token: string,
  project: Partial<ProxyProject> & { id: string },
): Promise<Response> {
  return fetch(`${baseUrl}/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(project),
  });
}

async function deleteProxyProject(
  baseUrl: string,
  token: string,
  id: string,
): Promise<Response> {
  return fetch(`${baseUrl}/projects/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Poll until a project appears in the proxy registry (sync is async/fire-and-forget).
 */
async function waitForProxyProject(
  baseUrl: string,
  token: string,
  projectId: string,
  timeoutMs = 30_000,
): Promise<ProxyProject> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fetchProxyProject(baseUrl, token, projectId);
    } catch {
      // not yet synced
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Project ${projectId} did not appear in proxy registry within ${timeoutMs}ms`);
}

/**
 * Poll until a project disappears from the proxy registry.
 */
async function waitForProxyProjectRemoved(
  baseUrl: string,
  token: string,
  projectId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetchProxyProject(baseUrl, token, projectId);
    } catch {
      return; // 404 = removed
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Project ${projectId} was not removed from proxy registry within ${timeoutMs}ms`);
}

// ── Tests ────────────────────────────────────────────

describeE2e('Proxy Projects Registry — Daytona', () => {
  let proxyBaseUrl: string;
  let authToken: string;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    await waitForApiSettled();

    proxyBaseUrl = await getProxyProjectsUrl();
    authToken = await getProxyAuthToken();

    if (!proxyBaseUrl) {
      console.warn(
        '[proxy-projects-e2e] No proxy projects URL in settings — ' +
        'proxy sandbox may not have been created. Remaining tests will fail.',
      );
    }
  }, 2 * 60 * 1000);

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await deleteProject(id);
    }
  }, 3 * 60 * 1000);

  // ── Health check ─────────────────────────────

  it('should have proxy projects API URL in settings', () => {
    expect(proxyBaseUrl).toBeTruthy();
    expect(authToken).toBeTruthy();
  });

  it('should respond to /health without auth', async () => {
    const resp = await fetch(`${proxyBaseUrl}/health`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe('ok');
    expect(typeof body.projects).toBe('number');
  });

  // ── Authentication ───────────────────────────

  it('should reject requests without bearer token', async () => {
    const resp = await fetch(`${proxyBaseUrl}/projects`);
    expect(resp.status).toBe(401);
  });

  it('should reject requests with wrong token', async () => {
    const resp = await fetch(`${proxyBaseUrl}/projects`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(resp.status).toBe(401);
  });

  // ── Direct CRUD ──────────────────────────────

  describe('Direct CRUD against proxy API', () => {
    const directId = 'e2e-direct-' + Date.now();

    it('should create a project via POST /projects', async () => {
      const resp = await postProxyProject(proxyBaseUrl, authToken, {
        id: directId,
        name: 'E2E Direct Test',
        description: 'Created directly',
        status: 'running',
      });
      expect(resp.status).toBe(201);
      const body = await resp.json();
      expect(body.id).toBe(directId);
      expect(body.name).toBe('E2E Direct Test');
      expect(body.createdAt).toBeTruthy();
    });

    it('should list projects including the new one', async () => {
      const list = await fetchProxyProjects(proxyBaseUrl, authToken);
      const found = list.find((p) => p.id === directId);
      expect(found).toBeTruthy();
      expect(found!.name).toBe('E2E Direct Test');
    });

    it('should get a single project by id', async () => {
      const project = await fetchProxyProject(proxyBaseUrl, authToken, directId);
      expect(project.id).toBe(directId);
      expect(project.description).toBe('Created directly');
    });

    it('should upsert an existing project via POST', async () => {
      const resp = await postProxyProject(proxyBaseUrl, authToken, {
        id: directId,
        name: 'E2E Direct Updated',
        status: 'stopped',
      });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.name).toBe('E2E Direct Updated');
      expect(body.status).toBe('stopped');
      expect(body.description).toBe('Created directly');
    });

    it('should update a project via PUT /projects/:id', async () => {
      const resp = await fetch(`${proxyBaseUrl}/projects/${directId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ description: 'Updated via PUT' }),
      });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.description).toBe('Updated via PUT');
      expect(body.name).toBe('E2E Direct Updated');
    });

    it('should return 404 for non-existent project', async () => {
      const resp = await fetch(`${proxyBaseUrl}/projects/nonexistent-id`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(resp.status).toBe(404);
    });

    it('should delete a project', async () => {
      const resp = await deleteProxyProject(proxyBaseUrl, authToken, directId);
      expect(resp.status).toBe(200);

      const getResp = await fetch(`${proxyBaseUrl}/projects/${directId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(getResp.status).toBe(404);
    });
  });

  // ── Automatic sync via local API ─────────────

  describe('Automatic sync on project lifecycle', () => {
    let projectId: string;

    it('should sync a new Daytona project to the proxy on create', async () => {
      projectId = await createProject('E2E Proxy Sync Test', 'build', 'daytona');
      createdProjectIds.push(projectId);

      const proxied = await waitForProxyProject(proxyBaseUrl, authToken, projectId);
      expect(proxied.name).toBe('E2E Proxy Sync Test');
      expect(proxied.status).toBe('creating');
    }, 60_000);

    it('should sync running status after sandbox is provisioned', async () => {
      await waitForSandbox(projectId, 5 * 60 * 1000);

      const deadline = Date.now() + 30_000;
      let proxied: ProxyProject | undefined;
      while (Date.now() < deadline) {
        proxied = await fetchProxyProject(proxyBaseUrl, authToken, projectId);
        if (proxied.status === 'running' && proxied.sandboxId) break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      expect(proxied).toBeTruthy();
      expect(proxied!.status).toBe('running');
      expect(proxied!.sandboxId).toBeTruthy();
    }, 6 * 60 * 1000);

    it('should sync status update (stop)', async () => {
      await axios.post(`/api/projects/${projectId}/stop`);

      const deadline = Date.now() + 60_000;
      let proxied: ProxyProject | undefined;
      while (Date.now() < deadline) {
        proxied = await fetchProxyProject(proxyBaseUrl, authToken, projectId);
        if (proxied.status === 'stopped') break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      expect(proxied!.status).toBe('stopped');
    }, 2 * 60 * 1000);

    it('should be listed via GET /api/projects/remote', async () => {
      const res = await axios.get('/api/projects/remote');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);

      const found = res.data.find((p: any) => p.id === projectId);
      expect(found).toBeTruthy();
      expect(found.name).toBe('E2E Proxy Sync Test');
    });

    it('should remove from proxy on project delete', async () => {
      await deleteProject(projectId);
      createdProjectIds.splice(createdProjectIds.indexOf(projectId), 1);

      await waitForProxyProjectRemoved(proxyBaseUrl, authToken, projectId);

      const list = await fetchProxyProjects(proxyBaseUrl, authToken);
      const found = list.find((p) => p.id === projectId);
      expect(found).toBeUndefined();
    }, 3 * 60 * 1000);
  });

  // ── Thread message sync ───────────────────────

  describe('Thread message sync', () => {
    it('should sync thread messages to proxy when a thread is created', async () => {
      // Create a Daytona project
      const pid = await createProject('E2E Message Sync Test', 'build', 'daytona');
      createdProjectIds.push(pid);

      // Wait for the project to appear on the proxy
      await waitForProxyProject(proxyBaseUrl, authToken, pid);

      // Create a thread via the local API (this inserts a user message + syncs)
      const threadRes = await axios.post(`/api/projects/${pid}/threads`, {
        prompt: 'Hello from the message sync test',
      });
      expect(threadRes.status).toBe(200);
      const threadId = threadRes.data.id;

      // Poll proxy until the thread's messages are synced
      const deadline = Date.now() + 30_000;
      let messages: any[] = [];
      while (Date.now() < deadline) {
        try {
          const resp = await fetch(
            `${proxyBaseUrl}/threads/${threadId}/messages`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );
          if (resp.ok) {
            messages = await resp.json();
            if (messages.length > 0) break;
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 2000));
      }

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content[0].text).toBe('Hello from the message sync test');
    }, 60_000);
  });

  // ── Mobile prompt execution ───────────────────

  describe('Mobile prompt execution', () => {
    let projectId: string;

    it('should execute a prompt submitted via proxy POST /prompts', async () => {
      // Create a Daytona project and wait for sandbox to be running
      projectId = await createProject('E2E Mobile Prompt Test', 'build', 'daytona');
      createdProjectIds.push(projectId);
      await waitForSandbox(projectId, 5 * 60 * 1000);

      // Wait for the project to appear on the proxy with bridge info
      await waitForProxyProject(proxyBaseUrl, authToken, projectId);

      // Create a thread via the local API
      const threadRes = await axios.post(`/api/projects/${projectId}/threads`, {
        prompt: 'What is 2+2? Reply with just the number.',
      });
      expect(threadRes.status).toBe(200);
      const threadId = threadRes.data.id;

      // Give the thread metadata time to sync to proxy
      await new Promise((r) => setTimeout(r, 5000));

      // Verify bridge info was synced with the project
      const projOnProxy = await fetchProxyProject(proxyBaseUrl, authToken, projectId);
      console.log('[e2e] Project on proxy:', JSON.stringify({
        id: projOnProxy.id,
        status: projOnProxy.status,
        sandboxId: projOnProxy.sandboxId,
        bridgeUrl: (projOnProxy as any).bridgeUrl,
        bridgeToken: (projOnProxy as any).bridgeToken ? 'set' : 'null',
      }));

      // Submit the prompt directly to the proxy (simulating mobile)
      const promptResp = await fetch(`${proxyBaseUrl}/prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          projectId,
          threadId,
          prompt: 'What is 2+2? Reply with just the number.',
        }),
      });
      const promptBody = await promptResp.json();
      console.log('[e2e] Prompt response:', promptResp.status, JSON.stringify(promptBody));
      expect(promptResp.status).toBe(201);

      // Poll proxy for messages — expect assistant response within 3 minutes
      const deadline = Date.now() + 3 * 60 * 1000;
      let messages: any[] = [];
      let hasAssistant = false;
      let hasResult = false;
      while (Date.now() < deadline) {
        try {
          const resp = await fetch(
            `${proxyBaseUrl}/threads/${threadId}/messages`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );
          if (resp.ok) {
            messages = await resp.json();
            hasAssistant = messages.some((m: any) => m.role === 'assistant');
            hasResult = messages.some((m: any) => m.role === 'system');
            if (hasAssistant && hasResult) break;
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 3000));
      }

      expect(hasAssistant).toBe(true);
      expect(hasResult).toBe(true);
    }, 8 * 60 * 1000);
  });

  // ── Non-Daytona projects should NOT sync ─────

  describe('Non-Daytona project isolation', () => {
    it('should not sync a non-daytona project to the proxy', async () => {
      // Use 'docker' provider — its sandbox manager is not initialized in the
      // test env, so provisioning bails immediately (no noisy mkdir errors).
      const nonDaytonaId = await createProject('E2E Docker No Sync', 'build', 'docker');
      createdProjectIds.push(nonDaytonaId);

      // Give sync a chance to fire (it shouldn't)
      await new Promise((r) => setTimeout(r, 5000));

      const list = await fetchProxyProjects(proxyBaseUrl, authToken);
      const found = list.find((p) => p.id === nonDaytonaId);
      expect(found).toBeUndefined();
    }, 30_000);
  });
});
