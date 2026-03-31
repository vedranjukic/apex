import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SandboxManager } from '../../libs/orchestrator/src/lib/sandbox-manager';
import { startSecretsProxy, stopSecretsProxy, isProxyHealthy } from '../../apps/api/src/modules/secrets-proxy/secrets-proxy';
import { settingsService } from '../../apps/api/src/modules/settings/settings.service';
import { initCA } from '../../apps/api/src/modules/secrets-proxy/ca-manager';

describe('GitHub CLI Authentication E2E', () => {
  let sandboxManager: SandboxManager;
  let sandboxId: string;
  let proxyServer: any;

  beforeAll(async () => {
    // Initialize CA certificate
    await initCA();

    // Mock GitHub token in settings
    vi.mock('../../apps/api/src/modules/settings/settings.service');
    vi.mocked(settingsService.get).mockResolvedValue('test-github-token');

    // Start secrets proxy
    proxyServer = await startSecretsProxy();
    
    // Verify proxy is healthy
    const healthy = await isProxyHealthy();
    expect(healthy).toBe(true);

    // Initialize sandbox manager
    sandboxManager = new SandboxManager({
      provider: process.env.E2E_PROVIDER || 'docker',
      baseUrl: 'http://localhost:3000',
      webSocketUrl: 'ws://localhost:3000',
      githubToken: 'test-github-token',
      secretsProxyCaCert: process.env.APEX_CA_CERT || '',
      secretPlaceholders: {},
      agentMode: false,
      sshKeyPath: '',
      disableCache: false,
      proxyPort: 3001,
      proxyAuthToken: 'test-proxy-token',
      proxyBaseUrl: 'http://localhost:3001',
      agentType: 'build',
      modelChoices: {},
      allowedModels: [],
    });

    // Skip actual sandbox creation in unit tests
    if (process.env.E2E_SKIP_SANDBOX !== 'true') {
      // Create a test sandbox
      sandboxId = await sandboxManager.createSandbox(
        undefined,
        'test-github-cli-auth',
        undefined,
        'test'
      );
    }
  }, 120000); // 2 minute timeout for sandbox creation

  afterAll(async () => {
    // Clean up sandbox
    if (sandboxId && process.env.E2E_SKIP_SANDBOX !== 'true') {
      await sandboxManager.destroySandbox(sandboxId);
    }

    // Stop proxy
    await stopSecretsProxy();
  });

  describe('Environment Setup', () => {
    it('should set all required environment variables', () => {
      const envVars = sandboxManager['buildContainerEnvVars']();

      // GitHub tokens
      expect(envVars['GH_TOKEN']).toBe('gh-proxy-placeholder');
      expect(envVars['GITHUB_TOKEN']).toBe('gh-proxy-placeholder');

      // Proxy settings
      expect(envVars['HTTPS_PROXY']).toMatch(/http:\/\/.*:3001/);
      expect(envVars['HTTP_PROXY']).toMatch(/http:\/\/.*:3001/);

      // Go-specific settings
      expect(envVars['GOFLAGS']).toBe('-insecure=false');
      expect(envVars['GODEBUG']).toBe('x509ignoreCN=0');
      expect(envVars['CGO_ENABLED']).toBe('1');

      // CA certificates
      expect(envVars['SSL_CERT_FILE']).toBe('/etc/ssl/certs/ca-certificates.crt');
      expect(envVars['NODE_EXTRA_CA_CERTS']).toBe('/usr/local/share/ca-certificates/apex-proxy.crt');
    });
  });

  describe('GitHub CLI Commands', () => {
    // Skip these tests if no sandbox is created
    const testInSandbox = process.env.E2E_SKIP_SANDBOX === 'true' ? it.skip : it;

    testInSandbox('should authenticate with gh api user', async () => {
      const sandbox = sandboxManager['sandboxes'].get(sandboxId);
      expect(sandbox).toBeDefined();

      // Run gh api user command
      const result = await sandbox!.process.executeCommand('gh api user');
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.result || '{}');
      expect(output).toHaveProperty('login');
      expect(output).toHaveProperty('id');
    }, 30000);

    testInSandbox('should list repositories with gh repo list', async () => {
      const sandbox = sandboxManager['sandboxes'].get(sandboxId);
      expect(sandbox).toBeDefined();

      const result = await sandbox!.process.executeCommand('gh repo list --limit 5 --json name');
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.result || '[]');
      expect(Array.isArray(output)).toBe(true);
    }, 30000);

    testInSandbox('should work with gh api to different GitHub domains', async () => {
      const sandbox = sandboxManager['sandboxes'].get(sandboxId);
      expect(sandbox).toBeDefined();

      // Test various API endpoints
      const endpoints = [
        '/user',
        '/user/repos?per_page=1',
        '/rate_limit',
      ];

      for (const endpoint of endpoints) {
        const result = await sandbox!.process.executeCommand(`gh api ${endpoint}`);
        expect(result.exitCode).toBe(0);
        expect(result.result).toBeTruthy();
      }
    }, 60000);

    testInSandbox('should handle authentication errors gracefully', async () => {
      const sandbox = sandboxManager['sandboxes'].get(sandboxId);
      expect(sandbox).toBeDefined();

      // Temporarily unset the token to test error handling
      await sandbox!.process.executeCommand('unset GH_TOKEN');

      const result = await sandbox!.process.executeCommand('gh api user 2>&1');
      expect(result.exitCode).not.toBe(0);
      expect(result.result).toMatch(/authentication|credential|unauthorized/i);
    }, 30000);
  });

  describe('Certificate Validation', () => {
    testInSandbox('should have CA certificate installed', async () => {
      const sandbox = sandboxManager['sandboxes'].get(sandboxId);
      expect(sandbox).toBeDefined();

      // Check if CA cert exists
      const certCheck = await sandbox!.process.executeCommand(
        'ls -la /usr/local/share/ca-certificates/apex-proxy.crt'
      );
      expect(certCheck.exitCode).toBe(0);

      // Check if it's in the system bundle
      const bundleCheck = await sandbox!.process.executeCommand(
        'grep -c "Apex Proxy CA" /etc/ssl/certs/ca-certificates.crt || true'
      );
      const count = parseInt(bundleCheck.result?.trim() || '0');
      expect(count).toBeGreaterThan(0);
    }, 30000);

    testInSandbox('should connect through proxy with proper TLS', async () => {
      const sandbox = sandboxManager['sandboxes'].get(sandboxId);
      expect(sandbox).toBeDefined();

      // Test HTTPS through proxy with curl
      const result = await sandbox!.process.executeCommand(
        'curl -s -o /dev/null -w "%{http_code}" --proxy $HTTPS_PROXY https://api.github.com/zen'
      );
      expect(result.result?.trim()).toBe('200');
    }, 30000);
  });

  describe('Proxy Health', () => {
    it('should have a healthy proxy', async () => {
      const healthy = await isProxyHealthy();
      expect(healthy).toBe(true);
    });

    it('should expose health endpoint', async () => {
      const http = await import('http');
      const response = await new Promise<any>((resolve) => {
        http.get('http://localhost:3001/health', (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              body: JSON.parse(data),
            });
          });
        });
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('github_domains');
      expect(response.body.github_domains).toContain('api.github.com');
    });
  });
});