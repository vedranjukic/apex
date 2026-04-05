/**
 * E2E test: MITM secrets proxy through the full Daytona proxy chain.
 *
 * Tests the complete tunnel path:
 *   sandbox curl → tunnel client (:9339) → WebSocket → proxy sandbox MITM (:9340) → upstream
 *
 * Uses real Daytona sandboxes with SSH for command execution — no ANTHROPIC_API_KEY needed.
 *
 * Environment:
 *   DAYTONA_API_KEY_E2E  - Daytona API key for e2e tests
 *
 * Run: yarn test:secrets-proxy-daytona-e2e
 */
import axios from 'axios';
import {
  waitForApiSettled,
  createProject,
  waitForSandbox,
  deleteProject,
  getSshAccess,
  execInSandbox,
  execInSandboxParallel,
  waitForSandboxReady,
  type SshAccess,
} from './support/e2e-helpers';

// ── Gate: skip entire suite without Daytona key ──────

const hasDaytonaKey = !!(
  process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_KEY_E2E
);
const describeE2e = hasDaytonaKey ? describe : describe.skip;

// ── Secret helpers ───────────────────────────────────

async function createSecret(data: {
  name: string;
  value: string;
  domain: string;
  authType?: string;
}): Promise<{ id: string }> {
  const res = await axios.post('/api/secrets', data);
  expect([200, 201]).toContain(res.status);
  return res.data;
}

async function deleteSecret(id: string): Promise<void> {
  try {
    await axios.delete(`/api/secrets/${id}`);
  } catch {
    // ignore
  }
}

async function deleteSecretsForDomain(domain: string): Promise<void> {
  const res = await axios.get('/api/secrets');
  for (const s of res.data) {
    if (s.domain === domain) {
      await deleteSecret(s.id);
    }
  }
}

/**
 * Force the proxy sandbox to be recreated on next ensureDaytonaProxy() call.
 * Clears the stored proxy sandbox ID so the API provisions a fresh one
 * that includes all current secrets in SECRETS_JSON.
 */
async function resetProxySandbox(): Promise<void> {
  await axios.put('/api/settings', {
    LLM_PROXY_SANDBOX_ID: '',
    LLM_PROXY_KEYS_HASH: '',
  });
}

// ── Tests ────────────────────────────────────────────

describeE2e('Secrets Proxy — Daytona Full Chain', () => {
  let projectId: string;
  let ssh: SshAccess;
  const secretIds: string[] = [];

  // ── Setup: create secrets, provision sandbox, get SSH ──

  beforeAll(async () => {
    await waitForApiSettled();

    // Clean up any stale secrets for our test domain
    await deleteSecretsForDomain('httpbin.org');

    // Create test secrets BEFORE sandbox (so proxy sandbox includes them)
    const bearerSecret = await createSecret({
      name: 'E2E_BEARER_KEY',
      value: 'e2e-daytona-bearer-token',
      domain: 'httpbin.org',
      authType: 'bearer',
    });
    secretIds.push(bearerSecret.id);

    // Force proxy sandbox recreation to pick up the new secrets
    await resetProxySandbox();

    // Provision a real Daytona sandbox
    projectId = await createProject('e2e-proxy-daytona', 'build', 'daytona');
    console.log(`[proxy-daytona] Project created: ${projectId}`);

    await waitForSandbox(projectId, 6 * 60 * 1000);
    console.log('[proxy-daytona] Sandbox is running');

    // Get SSH access for command execution
    ssh = await getSshAccess(projectId);
    console.log(
      `[proxy-daytona] SSH access: ${ssh.sshUser}@${ssh.sshHost}:${ssh.sshPort}`,
    );

    // Wait until the bridge tunnel and CA cert are fully operational.
    // The sandbox status may be 'running' before the bridge finishes
    // installing CA certs and starting the tunnel client on :9339.
    console.log('[proxy-daytona] Waiting for tunnel/proxy to be ready...');
    await waitForSandboxReady(ssh, 90_000);
    console.log('[proxy-daytona] Tunnel is ready');
  }, 10 * 60 * 1000);

  // ── Cleanup ──

  afterAll(async () => {
    for (const id of secretIds) {
      await deleteSecret(id);
    }
    if (projectId) {
      await deleteProject(projectId);
    }
  }, 2 * 60 * 1000);

  // ── Environment verification ──

  it('should have HTTPS_PROXY configured to tunnel client', () => {
    const proxy = execInSandbox(ssh, 'echo $HTTPS_PROXY', 15_000);
    expect(proxy).toBe('http://localhost:9339');
  }, 30_000);

  it('should have the CA certificate installed', () => {
    const cert = execInSandbox(
      ssh,
      'test -f /usr/local/share/ca-certificates/apex-proxy.crt && cat /usr/local/share/ca-certificates/apex-proxy.crt || echo NOT_FOUND',
      15_000,
    );
    expect(cert).toContain('BEGIN CERTIFICATE');
    expect(cert).toContain('END CERTIFICATE');
  }, 30_000);

  // ── Auth injection through tunnel ──

  it('should inject bearer auth through the full tunnel chain', () => {
    const raw = execInSandbox(
      ssh,
      'curl -sf --max-time 15 https://httpbin.org/headers',
      30_000,
    );
    const json = JSON.parse(raw);
    const authHeader =
      json.headers?.Authorization || json.headers?.authorization;
    expect(authHeader).toBe('Bearer e2e-daytona-bearer-token');
  }, 60_000);

  it('should inject auth through the tunnel (verify MITM active)', () => {
    const raw = execInSandbox(
      ssh,
      'curl -sf --max-time 15 https://httpbin.org/headers',
      30_000,
    );
    const json = JSON.parse(raw);
    const hasAuth =
      json.headers?.Authorization ||
      json.headers?.authorization ||
      json.headers?.['X-Api-Key'] ||
      json.headers?.['x-api-key'];
    expect(hasAuth).toBeTruthy();
  }, 60_000);

  // ── Transparent tunneling ──

  it('should transparently tunnel non-secret domains', () => {
    const raw = execInSandbox(
      ssh,
      'curl -sf -o /dev/null -w "%{http_code}" --max-time 15 https://example.com',
      30_000,
    );
    expect(raw).toBe('200');
  }, 60_000);

  // ── POST body forwarding ──

  it('should forward POST body through the tunnel', () => {
    const raw = execInSandbox(
      ssh,
      `curl -sf --max-time 15 -X POST -H "Content-Type: application/json" -d '{"msg":"hello"}' https://httpbin.org/post`,
      30_000,
    );
    const json = JSON.parse(raw);

    expect(json.data).toBe('{"msg":"hello"}');

    const hasAuth =
      json.headers?.Authorization ||
      json.headers?.authorization ||
      json.headers?.['X-Api-Key'] ||
      json.headers?.['x-api-key'];
    expect(hasAuth).toBeTruthy();
  }, 60_000);

  // ── Concurrent requests ──

  it('should handle 5 concurrent requests through the tunnel', async () => {
    const commands = Array.from(
      { length: 5 },
      () => 'curl -sf --max-time 15 https://httpbin.org/headers',
    );

    const results = await execInSandboxParallel(ssh, commands, 30_000);

    for (const raw of results) {
      const json = JSON.parse(raw);
      const hasAuth =
        json.headers?.Authorization ||
        json.headers?.authorization ||
        json.headers?.['X-Api-Key'] ||
        json.headers?.['x-api-key'];
      expect(hasAuth).toBeTruthy();
    }
  }, 120_000);
});
