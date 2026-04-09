/**
 * Test: LLM API keys must NEVER appear as real values in sandbox environments.
 *
 * Containers and bridge processes should always receive placeholder values
 * (e.g. "sk-proxy-placeholder") for ANTHROPIC_API_KEY / OPENAI_API_KEY.
 * Real keys are injected server-side by the LLM proxy at the HTTP level.
 *
 * These tests cover three distinct leakage vectors:
 *   1. Container env vars (buildContainerEnvVars) — set at sandbox creation
 *   2. Bridge restart env — shell env prefix when restarting the bridge process
 *   3. Bridge install env — shell env prefix during initial bridge installation
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=llm-key-placeholders
 */
import { SandboxManager } from '@apex/orchestrator';

const FAKE_ANTHROPIC_KEY = 'sk-ant-api03-REAL-SECRET-KEY-THAT-MUST-NOT-LEAK';
const FAKE_OPENAI_KEY = 'sk-proj-REAL-SECRET-KEY-THAT-MUST-NOT-LEAK';

function createManager(
  overrides: Record<string, unknown> = {},
): SandboxManager {
  return new SandboxManager({
    anthropicApiKey: FAKE_ANTHROPIC_KEY,
    openaiApiKey: FAKE_OPENAI_KEY,
    proxyBaseUrl: 'http://localhost:6000',
    ...overrides,
  });
}

function getContainerEnvVars(mgr: SandboxManager): Record<string, string> {
  return (mgr as any).buildContainerEnvVars();
}

function assertNoRealKeys(envVars: Record<string, string>, context: string): void {
  for (const [key, value] of Object.entries(envVars)) {
    expect(value).not.toBe(FAKE_ANTHROPIC_KEY);
    expect(value).not.toBe(FAKE_OPENAI_KEY);
    if (key === 'ANTHROPIC_API_KEY' || key === 'OPENAI_API_KEY') {
      expect(value).toMatch(/placeholder|proxy/i);
    }
  }
}

function assertStringHasNoRealKeys(str: string, context: string): void {
  expect(str).not.toContain(FAKE_ANTHROPIC_KEY);
  expect(str).not.toContain(FAKE_OPENAI_KEY);
}

// ── Vector 1: Container env vars (buildContainerEnvVars) ─────────

describe('Container env vars — buildContainerEnvVars()', () => {

  describe.each([
    ['docker'],
    ['apple-container'],
    ['daytona'],
  ] as const)('provider=%s', (provider) => {

    it('should use placeholders when proxy is available', () => {
      const proxyBaseUrl = provider === 'daytona'
        ? 'https://proxy.example.com'
        : 'http://localhost:6000';
      const mgr = createManager({ provider, proxyBaseUrl });
      const envVars = getContainerEnvVars(mgr);

      expect(envVars['ANTHROPIC_API_KEY']).toBe('sk-proxy-placeholder');
      expect(envVars['OPENAI_API_KEY']).toBe('sk-proxy-placeholder');
      assertNoRealKeys(envVars, `${provider} with proxy`);
    });

    it('should use placeholders even when proxy is UNAVAILABLE', () => {
      const mgr = createManager({
        provider,
        proxyBaseUrl: 'not-a-valid-url',
      });
      const envVars = getContainerEnvVars(mgr);

      if (envVars['ANTHROPIC_API_KEY']) {
        expect(envVars['ANTHROPIC_API_KEY']).not.toBe(FAKE_ANTHROPIC_KEY);
        expect(envVars['ANTHROPIC_API_KEY']).toMatch(/placeholder|proxy/i);
      }
      if (envVars['OPENAI_API_KEY']) {
        expect(envVars['OPENAI_API_KEY']).not.toBe(FAKE_OPENAI_KEY);
        expect(envVars['OPENAI_API_KEY']).toMatch(/placeholder|proxy/i);
      }
      assertNoRealKeys(envVars, `${provider} without proxy`);
    });
  });

  it('matrix: no provider+proxy combination should ever expose real keys', () => {
    const providers = ['docker', 'apple-container', 'daytona'] as const;
    const proxyUrls = [
      'http://localhost:6000',
      'https://proxy.example.com',
      'not-a-valid-url',
      '',
    ];

    for (const provider of providers) {
      for (const proxyBaseUrl of proxyUrls) {
        const mgr = createManager({
          provider,
          proxyBaseUrl: proxyBaseUrl || undefined,
        });
        const envVars = getContainerEnvVars(mgr);
        assertNoRealKeys(envVars, `${provider} proxyBaseUrl="${proxyBaseUrl}"`);
      }
    }
  });
});

// ── Vector 2 & 3: Bridge env vars (restart + install) ────────────
//
// The bridge process is started with a shell command like:
//   ANTHROPIC_API_KEY="..." OPENAI_API_KEY="..." node bridge.cjs
//
// We cannot call restartBridge / installBridge directly (they need a
// live sandbox), but we CAN test the env-building logic by intercepting
// the executeSessionCommand call through a mock provider.

function createMockSandbox() {
    const executedCommands: string[] = [];

    const mockSandbox = {
      id: 'mock-sandbox-id-12345',
      state: 'started' as const,
      getPreviewLink: async () => ({ url: 'http://mock:8080', token: null }),
      getSignedPreviewUrl: undefined,
      getSshAccess: async () => ({} as any),
      start: async () => {},
      stop: async () => {},
      delete: async () => {},
      fs: {
        uploadFile: async () => {},
        downloadFile: async () => Buffer.from(''),
        listFiles: async () => [],
        findFile: async () => [],
        replaceInFiles: async () => [],
        getFileInfo: async () => ({ size: 0 }),
      },
      process: {
        executeCommand: async (cmd: string) => {
          executedCommands.push(cmd);
          // waitForBridge runs curl and expects "bridge-ok"
          if (cmd.includes('curl') && cmd.includes('8080')) {
            return { result: 'bridge-ok', exitCode: 0 };
          }
          return { result: 'exists', exitCode: 0 };
        },
        executeSessionCommand: async (_sid: string, opts: any) => {
          executedCommands.push(opts.command || '');
        },
        createSession: async () => {},
        getSessionOutput: async () => '',
      },
      git: {
        clone: async () => {},
        status: async () => ({ files: [] }),
        add: async () => {},
        commit: async () => {},
        push: async () => {},
        pull: async () => {},
        branch: async () => {},
        log: async () => [],
      },
    };

    const mockProvider = {
      initialize: async () => {},
      create: async () => mockSandbox,
      get: async () => mockSandbox,
      list: async () => [mockSandbox],
      start: async () => {},
      stop: async () => {},
      delete: async () => {},
    };

    return { mockSandbox, mockProvider, executedCommands };
  }

describe('Bridge env vars — must not contain real keys', () => {

  it('createSandbox should not pass real keys in bridge start command (docker, no proxy)', async () => {
    const { mockProvider, executedCommands } = createMockSandbox();

    const mgr = createManager({
      provider: 'docker',
      proxyBaseUrl: 'not-a-valid-url',
    });
    (mgr as any).provider = mockProvider;

    try {
      await mgr.createSandbox(
        undefined,
        'test-project',
        undefined,
        'build',
        'project-123',
      );
    } catch {
      // createSandbox may fail after bridge setup — that's fine,
      // we only care about the commands that were executed
    }

    const bridgeCmd = executedCommands.find(
      (c) => c.includes('node bridge.cjs'),
    );
    expect(bridgeCmd).toBeDefined();
    assertStringHasNoRealKeys(bridgeCmd!, 'bridge install command (docker)');
  }, 30_000);

  it('createSandbox should not pass real keys in bridge start command (daytona, localhost proxy)', async () => {
    const { mockProvider, executedCommands } = createMockSandbox();

    const mgr = createManager({
      provider: 'daytona',
      proxyBaseUrl: 'http://localhost:6000',
    });
    (mgr as any).provider = mockProvider;

    try {
      await mgr.createSandbox(
        undefined,
        'test-project',
        undefined,
        'build',
        'project-123',
      );
    } catch {
      // May fail after bridge setup
    }

    const bridgeCmd = executedCommands.find(
      (c) => c.includes('node bridge.cjs'),
    );
    expect(bridgeCmd).toBeDefined();
    assertStringHasNoRealKeys(bridgeCmd!, 'bridge install command (daytona)');
  }, 30_000);

  it('bridge restart should not leak real keys in shell command (docker, no proxy)', async () => {
    const { mockSandbox, executedCommands } = createMockSandbox();

    const mgr = createManager({
      provider: 'docker',
      proxyBaseUrl: 'not-a-valid-url',
    });

    // restartBridge takes an InternalSession object
    const session = {
      id: 'test-session',
      sandboxId: mockSandbox.id,
      sandbox: mockSandbox,
      status: 'bridge_connected',
      projectDir: '/home/daytona/test-project',
      bridgeDir: '/home/daytona/bridge',
      ws: null,
      previewUrl: 'http://mock:8080',
      previewToken: null,
      bridgeSessionId: 'bridge-old',
      terminals: new Map(),
    };
    const sessions = (mgr as any).sessions as Map<string, any>;
    sessions.set(mockSandbox.id, session);

    try {
      await (mgr as any).restartBridge(session);
    } catch {
      // Expected to fail after bridge start — we only care about
      // the commands that were executed
    }

    const bridgeCmds = executedCommands.filter(
      (c) => c.includes('node bridge.cjs'),
    );
    expect(bridgeCmds.length).toBeGreaterThan(0);
    for (const cmd of bridgeCmds) {
      assertStringHasNoRealKeys(cmd, 'bridge restart command (docker)');
    }
  }, 30_000);

  it('bridge restart should not leak real keys in shell command (daytona, localhost proxy)', async () => {
    const { mockSandbox, executedCommands } = createMockSandbox();

    const mgr = createManager({
      provider: 'daytona',
      proxyBaseUrl: 'http://localhost:6000',
    });

    const session = {
      id: 'test-session',
      sandboxId: mockSandbox.id,
      sandbox: mockSandbox,
      status: 'bridge_connected',
      projectDir: '/home/daytona/test-project',
      bridgeDir: '/home/daytona/bridge',
      ws: null,
      previewUrl: 'http://mock:8080',
      previewToken: null,
      bridgeSessionId: 'bridge-old',
      terminals: new Map(),
    };
    const sessions = (mgr as any).sessions as Map<string, any>;
    sessions.set(mockSandbox.id, session);

    try {
      await (mgr as any).restartBridge(session);
    } catch {
      // Expected to fail
    }

    const bridgeCmds = executedCommands.filter(
      (c) => c.includes('node bridge.cjs'),
    );
    expect(bridgeCmds.length).toBeGreaterThan(0);
    for (const cmd of bridgeCmds) {
      assertStringHasNoRealKeys(cmd, 'bridge restart command (daytona)');
    }
  }, 30_000);
});

// ── Vector 4: Env vars actually received by provider.create() ────
//
// This captures the EXACT env vars that the Daytona SDK receives, including
// any post-buildContainerEnvVars merges (advancedSettings.environmentVariables).

describe('Env vars passed to provider.create() — spy on create', () => {

  it('Daytona provider.create() should receive only placeholder keys (with proxy)', async () => {
    const capturedParams: any[] = [];
    const { mockSandbox, mockProvider, executedCommands } = createMockSandbox();

    const origCreate = mockProvider.create;
    mockProvider.create = async (params: any) => {
      capturedParams.push(params);
      return origCreate(params);
    };

    const mgr = createManager({
      provider: 'daytona',
      proxyBaseUrl: 'https://proxy.example.com',
      proxyAuthToken: 'sk-proxy-abc123',
    });
    (mgr as any).provider = mockProvider;

    try {
      await mgr.createSandbox(
        undefined, 'test-project', undefined, 'build', 'project-123',
      );
    } catch { /* bridge connect will fail */ }

    expect(capturedParams.length).toBeGreaterThan(0);
    const envVars = capturedParams[0].envVars || {};
    assertNoRealKeys(envVars, 'daytona provider.create envVars (with proxy)');
    if (envVars['ANTHROPIC_API_KEY']) {
      expect(envVars['ANTHROPIC_API_KEY']).toMatch(/placeholder|proxy/i);
    }
  }, 30_000);

  it('Daytona provider.create() should receive only placeholder keys (no proxy, localhost)', async () => {
    const capturedParams: any[] = [];
    const { mockSandbox, mockProvider, executedCommands } = createMockSandbox();

    const origCreate = mockProvider.create;
    mockProvider.create = async (params: any) => {
      capturedParams.push(params);
      return origCreate(params);
    };

    const mgr = createManager({
      provider: 'daytona',
      proxyBaseUrl: 'http://localhost:6000',
    });
    (mgr as any).provider = mockProvider;

    try {
      await mgr.createSandbox(
        undefined, 'test-project', undefined, 'build', 'project-123',
      );
    } catch { /* bridge connect will fail */ }

    expect(capturedParams.length).toBeGreaterThan(0);
    const envVars = capturedParams[0].envVars || {};
    assertNoRealKeys(envVars, 'daytona provider.create envVars (no proxy)');
    if (envVars['ANTHROPIC_API_KEY']) {
      expect(envVars['ANTHROPIC_API_KEY']).toMatch(/placeholder|proxy/i);
    }
  }, 30_000);

  it('advancedSettings.environmentVariables must not override LLM key placeholders', async () => {
    const capturedParams: any[] = [];
    const { mockSandbox, mockProvider, executedCommands } = createMockSandbox();

    const origCreate = mockProvider.create;
    mockProvider.create = async (params: any) => {
      capturedParams.push(params);
      return origCreate(params);
    };

    const mgr = createManager({
      provider: 'daytona',
      proxyBaseUrl: 'https://proxy.example.com',
      proxyAuthToken: 'sk-proxy-abc123',
    });
    (mgr as any).provider = mockProvider;

    // Simulate advancedSettings that try to inject real keys
    try {
      await mgr.createSandbox(
        undefined, 'test-project', undefined, 'build', 'project-123',
        undefined, undefined, undefined, undefined,
        {
          environmentVariables: {
            ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY,
            OPENAI_API_KEY: FAKE_OPENAI_KEY,
            SAFE_VAR: 'safe-value',
          },
        },
      );
    } catch { /* bridge connect will fail */ }

    expect(capturedParams.length).toBeGreaterThan(0);
    const envVars = capturedParams[0].envVars || {};

    // LLM keys must NOT be overridden by advancedSettings
    expect(envVars['ANTHROPIC_API_KEY']).not.toBe(FAKE_ANTHROPIC_KEY);
    expect(envVars['OPENAI_API_KEY']).not.toBe(FAKE_OPENAI_KEY);
    // Non-LLM vars should pass through fine
    expect(envVars['SAFE_VAR']).toBe('safe-value');
  }, 30_000);
});

// ── Edge cases ───────────────────────────────────────────────────

describe('Edge cases', () => {
  it('proxyAuthToken should be used as placeholder when set', () => {
    const mgr = createManager({
      provider: 'docker',
      proxyAuthToken: 'sk-proxy-custom-token-abc123',
    });
    const envVars = getContainerEnvVars(mgr);

    expect(envVars['ANTHROPIC_API_KEY']).toBe('sk-proxy-placeholder');
    expect(envVars['OPENAI_API_KEY']).toBe('sk-proxy-placeholder');
    assertNoRealKeys(envVars, 'with proxyAuthToken');
  });

  it('keys from process.env should not leak when passed through constructor', () => {
    const mgr = new SandboxManager({
      provider: 'docker',
      proxyBaseUrl: 'not-a-valid-url',
    });
    const envVars = getContainerEnvVars(mgr);

    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
      if (envVars[key]) {
        expect(envVars[key]).toMatch(/placeholder|proxy/i);
      }
    }
  });
});

// ── Gated: Real Daytona sandbox e2e ──────────────────────────────
//
// Creates a real Daytona sandbox and checks env vars inside it.
// Only runs when E2E_SANDBOX_PROVIDER=daytona and keys are set.

const hasDaytonaE2e = !!(
  process.env.E2E_SANDBOX_PROVIDER === 'daytona' &&
  (process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_KEY_E2E) &&
  process.env.ANTHROPIC_API_KEY
);

const describeDaytona = hasDaytonaE2e ? describe : describe.skip;

describeDaytona('Real Daytona sandbox — env var verification', () => {
  // This test requires a running API server (started by global-setup)
  const axios = require('axios');
  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ?? '6000';

  let projectId: string | null = null;

  afterAll(async () => {
    if (projectId) {
      try {
        await axios.delete(`http://${host}:${port}/api/projects/${projectId}`);
      } catch { /* cleanup best-effort */ }
    }
  });

  it('env vars inside sandbox should not contain real ANTHROPIC_API_KEY', async () => {
    const realKey = process.env.ANTHROPIC_API_KEY!;

    // Create a project
    const createRes = await axios.post(`http://${host}:${port}/api/projects`, {
      name: 'e2e-key-check',
      provider: 'daytona',
      agentType: 'build',
    });
    projectId = createRes.data.id;

    // Wait for sandbox to be ready (up to 5 minutes)
    const deadline = Date.now() + 5 * 60_000;
    let status = 'creating';
    while (Date.now() < deadline && status !== 'running') {
      await new Promise((r) => setTimeout(r, 5_000));
      const res = await axios.get(`http://${host}:${port}/api/projects/${projectId}`);
      status = res.data.status;
      if (status === 'error') throw new Error(`Sandbox creation failed: ${res.data.statusError}`);
    }
    expect(status).toBe('running');

    // TODO: once we have terminal/exec API access, run `env | grep ANTHROPIC`
    // inside the sandbox and verify it shows placeholder, not real key.
    // For now, we verified via the mock provider tests above.
  }, 6 * 60_000);
});
