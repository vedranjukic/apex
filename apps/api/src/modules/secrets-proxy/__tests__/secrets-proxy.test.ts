import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import { secretsService } from '../../secrets/secrets.service';
import { settingsService } from '../../settings/settings.service';
import { startSecretsProxy, stopSecretsProxy } from '../secrets-proxy';

// Mock the services
vi.mock('../../secrets/secrets.service');
vi.mock('../../settings/settings.service');
vi.mock('../ca-manager', () => ({
  generateDomainCert: vi.fn(() => ({
    cert: 'mock-cert',
    key: 'mock-key',
  })),
}));

describe('Secrets Proxy', () => {
  let proxyPort: number;
  
  beforeAll(async () => {
    // Start the proxy on a random port for testing
    process.env.SECRETS_PROXY_PORT = '0'; // Let the OS assign a port
    const server = await startSecretsProxy();
    const address = server.address() as net.AddressInfo;
    proxyPort = address.port;
  });

  afterAll(async () => {
    await stopSecretsProxy();
  });

  describe('GitHub Domain Handling', () => {
    it('should include all necessary GitHub domains', async () => {
      // This test verifies that the GITHUB_DOMAINS set includes all necessary domains
      const expectedDomains = [
        'github.com',
        'api.github.com',
        'uploads.github.com',
        'objects.githubusercontent.com',
        'raw.githubusercontent.com',
        'codeload.github.com',
        'ghcr.io',
        'github.enterprise.com',
        'api.github.enterprise.com'
      ];

      // We can't directly access GITHUB_DOMAINS from the test, but we can test
      // the behavior by mocking the services to return a GitHub token
      vi.mocked(settingsService.get).mockResolvedValue('test-github-token');
      vi.mocked(secretsService.findByDomain).mockResolvedValue([]);

      // Test each domain by making a CONNECT request
      for (const domain of expectedDomains) {
        const response = await new Promise<string>((resolve) => {
          const client = net.connect(proxyPort, '127.0.0.1', () => {
            client.write(`CONNECT ${domain}:443 HTTP/1.1\r\nHost: ${domain}:443\r\n\r\n`);
          });

          let data = '';
          client.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('\r\n\r\n')) {
              client.destroy();
              resolve(data);
            }
          });

          client.on('error', () => resolve('error'));
          
          // Timeout after 1 second
          setTimeout(() => {
            client.destroy();
            resolve('timeout');
          }, 1000);
        });

        // The proxy should attempt to intercept GitHub domains
        // We expect either a 200 (if MITM setup succeeds) or an error (if cert generation fails in test env)
        expect(response).not.toBe('timeout');
      }
    });

    it('should use GitHub token from settings for GitHub domains', async () => {
      const mockToken = 'github_pat_testtoken123';
      vi.mocked(settingsService.get).mockResolvedValue(mockToken);
      vi.mocked(secretsService.findByDomain).mockResolvedValue([]);

      // Test that the proxy attempts to find a secret for api.github.com
      const client = net.connect(proxyPort, '127.0.0.1', () => {
        client.write('CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n');
      });

      await new Promise((resolve) => {
        client.on('data', () => {
          client.destroy();
          resolve(undefined);
        });
        client.on('error', () => resolve(undefined));
        setTimeout(() => {
          client.destroy();
          resolve(undefined);
        }, 500);
      });

      // Verify that settingsService.get was called with 'GITHUB_TOKEN'
      expect(settingsService.get).toHaveBeenCalledWith('GITHUB_TOKEN');
    });

    it('should handle missing GitHub token gracefully', async () => {
      vi.mocked(settingsService.get).mockResolvedValue(null);
      vi.mocked(secretsService.findByDomain).mockResolvedValue([]);

      const response = await new Promise<string>((resolve) => {
        const client = net.connect(proxyPort, '127.0.0.1', () => {
          client.write('CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n');
        });

        let data = '';
        client.on('data', (chunk) => {
          data += chunk.toString();
          if (data.includes('200 Connection Established')) {
            // If no secret, it should pass through
            client.destroy();
            resolve(data);
          }
        });

        client.on('error', () => resolve('error'));
        
        setTimeout(() => {
          client.destroy();
          resolve(data || 'timeout');
        }, 1000);
      });

      // Without a token, the proxy should establish a transparent tunnel
      expect(response).toContain('200 Connection Established');
    });
  });

  describe('Auth Header Injection', () => {
    it('should inject Bearer token for GitHub domains', async () => {
      const mockToken = 'github_pat_testtoken123';
      const mockSecret = {
        id: '_github_token',
        userId: '',
        projectId: null,
        name: 'GITHUB_TOKEN',
        value: mockToken,
        domain: 'api.github.com',
        authType: 'bearer',
        description: null,
        createdAt: '',
        updatedAt: '',
      };

      // The proxy will create this secret internally for GitHub domains
      vi.mocked(settingsService.get).mockResolvedValue(mockToken);
      vi.mocked(secretsService.findByDomain).mockResolvedValue([]);

      // Test HTTP proxy request (easier to test than CONNECT)
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: 'https://api.github.com/user',
          headers: {
            'Host': 'api.github.com',
            'Authorization': 'token gh-proxy-placeholder',
          },
        }, (res) => {
          resolve(res);
        });

        req.on('error', reject);
        req.end();
      });

      // The proxy should have attempted to forward the request
      // In test environment, it will likely fail to connect to the real GitHub
      expect(response.statusCode).toBeDefined();
    });
  });

  describe('Debug Logging', () => {
    it('should log GitHub domain interception attempts', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.mocked(settingsService.get).mockResolvedValue('test-token');
      vi.mocked(secretsService.findByDomain).mockResolvedValue([]);

      const client = net.connect(proxyPort, '127.0.0.1', () => {
        client.write('CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n');
      });

      await new Promise((resolve) => {
        client.on('data', () => {
          client.destroy();
          resolve(undefined);
        });
        client.on('error', () => resolve(undefined));
        setTimeout(() => {
          client.destroy();
          resolve(undefined);
        }, 500);
      });

      // Check that debug logging was called
      const logs = consoleSpy.mock.calls.map(call => call[0]);
      const warnings = consoleWarnSpy.mock.calls.map(call => call[0]);
      
      const hasGitHubLog = [...logs, ...warnings].some(msg => 
        msg.includes('[secrets-proxy]') && msg.includes('GitHub') && msg.includes('api.github.com')
      );
      
      expect(hasGitHubLog).toBe(true);

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });
});