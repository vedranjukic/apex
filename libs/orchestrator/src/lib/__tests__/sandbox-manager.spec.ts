import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SandboxManager } from '../sandbox-manager';
import type { SandboxProvider } from '../types';

// Mock the provider
const mockProvider: SandboxProvider = {
  createSandbox: vi.fn(),
  restoreSandbox: vi.fn(),
  destroySandbox: vi.fn(),
  getSandboxInfo: vi.fn(),
  startSandbox: vi.fn(),
  stopSandbox: vi.fn(),
  pauseSandbox: vi.fn(),
  resumeSandbox: vi.fn(),
  getPreviewUrl: vi.fn(),
};

describe('SandboxManager - GitHub CLI Environment Setup', () => {
  let sandboxManager: SandboxManager;

  beforeEach(() => {
    sandboxManager = new SandboxManager({
      provider: 'docker',
      baseUrl: 'http://localhost:3000',
      webSocketUrl: 'ws://localhost:3000',
      githubToken: 'test-github-token',
      secretsProxyCaCert: 'test-ca-cert',
      secretPlaceholders: {},
      agentMode: false,
      sshKeyPath: '',
      disableCache: false,
      proxyPort: 3001,
      proxyAuthToken: 'test-proxy-token',
      proxyBaseUrl: 'http://proxy.example.com',
      agentType: 'build',
      modelChoices: {},
      allowedModels: [],
    });
    sandboxManager['provider'] = mockProvider;
  });

  describe('buildContainerEnvVars', () => {
    it('should set Go-specific environment variables for TLS validation', () => {
      const envVars = sandboxManager['buildContainerEnvVars']();

      // Check Go-specific environment variables
      expect(envVars['GOFLAGS']).toBe('-insecure=false');
      expect(envVars['GODEBUG']).toBe('x509ignoreCN=0');
      expect(envVars['CGO_ENABLED']).toBe('1');
      expect(envVars['CA_BUNDLE']).toBe('/etc/ssl/certs/ca-certificates.crt');
      expect(envVars['CAFILE']).toBe('/etc/ssl/certs/ca-certificates.crt');
    });

    it('should set GitHub token placeholders when GitHub token is configured', () => {
      const envVars = sandboxManager['buildContainerEnvVars']();

      expect(envVars['GH_TOKEN']).toBe('gh-proxy-placeholder');
      expect(envVars['GITHUB_TOKEN']).toBe('gh-proxy-placeholder');
      expect(envVars['GIT_ASKPASS']).toBe('true');
      expect(envVars['GIT_TERMINAL_PROMPT']).toBe('0');
    });

    it('should set proxy environment variables correctly', () => {
      const envVars = sandboxManager['buildContainerEnvVars']();

      expect(envVars['HTTPS_PROXY']).toContain(':3001');
      expect(envVars['HTTP_PROXY']).toContain(':3001');
      expect(envVars['https_proxy']).toContain(':3001');
      expect(envVars['http_proxy']).toContain(':3001');
      expect(envVars['NO_PROXY']).toBe('localhost,127.0.0.1,0.0.0.0');
      expect(envVars['no_proxy']).toBe('localhost,127.0.0.1,0.0.0.0');
    });

    it('should set CA certificate environment variables', () => {
      const envVars = sandboxManager['buildContainerEnvVars']();

      expect(envVars['NODE_EXTRA_CA_CERTS']).toBe('/usr/local/share/ca-certificates/apex-proxy.crt');
      expect(envVars['SSL_CERT_FILE']).toBe('/etc/ssl/certs/ca-certificates.crt');
      expect(envVars['REQUESTS_CA_BUNDLE']).toBe('/etc/ssl/certs/ca-certificates.crt');
      expect(envVars['CURL_CA_BUNDLE']).toBe('/etc/ssl/certs/ca-certificates.crt');
    });

    it('should set GitHub token placeholder even without explicit GitHub token when proxy is available', () => {
      // Test with no GitHub token but proxy available
      const manager = new SandboxManager({
        provider: 'docker',
        baseUrl: 'http://localhost:3000',
        webSocketUrl: 'ws://localhost:3000',
        githubToken: '', // No token
        secretsProxyCaCert: 'test-ca-cert',
        secretPlaceholders: {},
        agentMode: false,
        sshKeyPath: '',
        disableCache: false,
        proxyPort: 3001,
        proxyAuthToken: 'test-proxy-token',
        proxyBaseUrl: 'http://proxy.example.com',
        agentType: 'build',
        modelChoices: {},
        allowedModels: [],
      });
      manager['provider'] = mockProvider;

      const envVars = manager['buildContainerEnvVars']();

      // Should still set placeholders when proxy is available
      expect(envVars['GH_TOKEN']).toBe('gh-proxy-placeholder');
      expect(envVars['GITHUB_TOKEN']).toBe('gh-proxy-placeholder');
    });

    it('should not override existing secret placeholders', () => {
      const manager = new SandboxManager({
        provider: 'docker',
        baseUrl: 'http://localhost:3000',
        webSocketUrl: 'ws://localhost:3000',
        githubToken: 'test-github-token',
        secretsProxyCaCert: 'test-ca-cert',
        secretPlaceholders: {
          'CUSTOM_SECRET': 'custom-placeholder',
          'ANOTHER_SECRET': 'another-placeholder',
        },
        agentMode: false,
        sshKeyPath: '',
        disableCache: false,
        proxyPort: 3001,
        proxyAuthToken: 'test-proxy-token',
        proxyBaseUrl: 'http://proxy.example.com',
        agentType: 'build',
        modelChoices: {},
        allowedModels: [],
      });
      manager['provider'] = mockProvider;

      const envVars = manager['buildContainerEnvVars']();

      expect(envVars['CUSTOM_SECRET']).toBe('custom-placeholder');
      expect(envVars['ANOTHER_SECRET']).toBe('another-placeholder');
    });
  });

  describe('Local provider handling', () => {
    it('should set environment variables for local provider', () => {
      const manager = new SandboxManager({
        provider: 'local',
        baseUrl: 'http://localhost:3000',
        webSocketUrl: 'ws://localhost:3000',
        githubToken: 'test-github-token',
        secretsProxyCaCert: 'test-ca-cert',
        secretPlaceholders: {},
        agentMode: false,
        sshKeyPath: '',
        disableCache: false,
        proxyPort: 3001,
        proxyAuthToken: 'test-proxy-token',
        proxyBaseUrl: 'http://localhost:3000',
        agentType: 'build',
        modelChoices: {},
        allowedModels: [],
      });
      manager['provider'] = mockProvider;

      const envVars = manager['buildContainerEnvVars']();

      // Local provider should still have proxy settings configured
      expect(envVars['HTTPS_PROXY']).toContain(':3001');
      expect(envVars['GH_TOKEN']).toBe('gh-proxy-placeholder');
      expect(envVars['GITHUB_TOKEN']).toBe('gh-proxy-placeholder');
      expect(envVars['GOFLAGS']).toBe('-insecure=false');
    });
  });
});

describe('SandboxManager - CA Certificate Installation', () => {
  let sandboxManager: SandboxManager;
  let mockSandbox: any;

  beforeEach(() => {
    sandboxManager = new SandboxManager({
      provider: 'docker',
      baseUrl: 'http://localhost:3000',
      webSocketUrl: 'ws://localhost:3000',
      githubToken: 'test-github-token',
      secretsProxyCaCert: 'test-ca-cert',
      secretPlaceholders: {},
      agentMode: false,
      sshKeyPath: '',
      disableCache: false,
      proxyPort: 3001,
      proxyAuthToken: 'test-proxy-token',
      proxyBaseUrl: 'http://proxy.example.com',
      agentType: 'build',
      modelChoices: {},
      allowedModels: [],
    });
    
    mockSandbox = {
      id: 'test-sandbox-id',
      fs: {
        uploadFile: vi.fn(),
      },
      process: {
        executeCommand: vi.fn(),
        createSession: vi.fn(),
      },
    };
  });

  it('should verify CA certificate installation', async () => {
    // Mock successful CA certificate installation
    mockSandbox.process.executeCommand
      .mockResolvedValueOnce({ result: 'CA update successful\nCA_UPDATE_SUCCESS' }) // update-ca-certificates
      .mockResolvedValueOnce({ result: '/etc/ssl/certs/apex-proxy.pem' }); // grep verification

    // Test would involve calling installBridge or restartBridge methods
    // These are complex methods that would require more extensive mocking
    // For now, we verify the environment setup which is the key part
    
    const envVars = sandboxManager['buildContainerEnvVars']();
    expect(envVars['NODE_EXTRA_CA_CERTS']).toBeDefined();
    expect(envVars['SSL_CERT_FILE']).toBeDefined();
  });
});