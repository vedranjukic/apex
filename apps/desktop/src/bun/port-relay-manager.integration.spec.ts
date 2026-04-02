/**
 * Integration tests for PortRelayManager (Electron main process)
 * 
 * Tests the desktop-specific port relay functionality including:
 *   - RPC communication between Electron processes
 *   - Configuration persistence and loading
 *   - Event handling and emission
 *   - Integration with Electron APIs
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as http from 'http';
import { PortRelayManager } from './port-relay-manager';
import type { PortRelayConfig, RelayedPort } from '../shared/rpc-types';

// Test configuration
const TEST_CONFIG = {
  tempDir: '',
  testTimeout: 30000,
  cleanupRetries: 3
};

// ── Test Utilities ──────────────────────────────────────────

/**
 * Create a temporary directory for test configs
 */
function createTempDir(): string {
  const tempDir = path.join(os.tmpdir(), 'port-relay-manager-tests-' + Date.now());
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Clean up test directory
 */
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a test HTTP server on a specific port
 */
function createTestServer(port: number, response = 'test-response'): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(response);
    });
    
    server.listen(port, 'localhost', () => {
      resolve(server);
    });
    
    server.on('error', reject);
  });
}

/**
 * Test connection to a port
 */
async function testConnection(port: number, expectedResponse?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (expectedResponse && data !== expectedResponse) {
          resolve(false);
        } else {
          resolve(res.statusCode === 200);
        }
      });
    });
    
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for condition with timeout
 */
async function waitForCondition(
  condition: () => Promise<boolean> | boolean,
  timeout = 10000,
  interval = 500
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Check if port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, 'localhost');
  });
}

// ── Main Test Suite ──────────────────────────────────────────

describe('PortRelayManager Integration Tests', () => {
  let tempDir: string;
  let portRelayManager: PortRelayManager;
  let testServers: http.Server[] = [];
  let eventLog: Array<{ type: string, data: any }> = [];

  beforeAll(() => {
    tempDir = createTempDir();
    TEST_CONFIG.tempDir = tempDir;
  });

  afterAll(() => {
    cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    // Clean up any existing manager
    if (portRelayManager) {
      portRelayManager.stopAllForwards();
    }
    
    // Reset test state
    testServers = [];
    eventLog = [];
    
    // Create new manager instance
    portRelayManager = new PortRelayManager(tempDir);
    
    // Subscribe to events
    portRelayManager.addEventListener((event) => {
      eventLog.push(event);
    });
  });

  afterEach(async () => {
    // Stop all forwards and cleanup servers
    if (portRelayManager) {
      portRelayManager.stopAllForwards();
    }
    
    // Close test servers with retries
    for (const server of testServers) {
      for (let i = 0; i < TEST_CONFIG.cleanupRetries; i++) {
        try {
          await new Promise<void>((resolve, reject) => {
            server.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          break;
        } catch (error) {
          if (i === TEST_CONFIG.cleanupRetries - 1) {
            console.warn('Failed to close test server:', error);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  });

  // ── Configuration Management Tests ──────────────────────────

  describe('Configuration Management', () => {
    it('should load default configuration on first run', () => {
      const config = portRelayManager.getConfig();
      
      expect(config.enabled).toBe(true);
      expect(config.autoForwardNewPorts).toBe(true);
      expect(config.portRange).toEqual({ start: 8000, end: 9000 });
      expect(Array.isArray(config.excludedPorts)).toBe(true);
    });

    it('should persist configuration changes', () => {
      const newConfig: PortRelayConfig = {
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 9500, end: 9600 },
        excludedPorts: [8080, 8443]
      };

      portRelayManager.setConfig(newConfig);

      // Create new manager to test persistence
      const newManager = new PortRelayManager(tempDir);
      const loadedConfig = newManager.getConfig();

      expect(loadedConfig).toEqual(newConfig);
      newManager.stopAllForwards();
    });

    it('should emit config-updated event when configuration changes', () => {
      const newConfig: PortRelayConfig = {
        enabled: true,
        autoForwardNewPorts: true,
        portRange: { start: 8500, end: 8600 },
        excludedPorts: [3001]
      };

      portRelayManager.setConfig(newConfig);

      const configEvent = eventLog.find(e => e.type === 'config-updated');
      expect(configEvent).toBeDefined();
      expect(configEvent!.data).toEqual(newConfig);
    });

    it('should handle corrupted config files gracefully', () => {
      // Write invalid JSON to config file
      const configPath = path.join(tempDir, 'port-relay-config.json');
      fs.writeFileSync(configPath, '{ invalid json }');

      // Should fall back to defaults without throwing
      const manager = new PortRelayManager(tempDir);
      const config = manager.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.autoForwardNewPorts).toBe(true);
      
      manager.stopAllForwards();
    });

    it('should create config directory if it does not exist', () => {
      const newTempDir = path.join(os.tmpdir(), 'port-relay-new-' + Date.now());
      
      // Directory shouldn't exist initially
      expect(fs.existsSync(newTempDir)).toBe(false);
      
      // Creating manager should create directory
      const manager = new PortRelayManager(newTempDir);
      
      expect(fs.existsSync(newTempDir)).toBe(true);
      expect(fs.existsSync(path.join(newTempDir, 'port-relay-config.json'))).toBe(true);
      
      manager.stopAllForwards();
      cleanupTempDir(newTempDir);
    });
  });

  // ── Port Forwarding Integration Tests ───────────────────────

  describe('Port Forwarding Operations', () => {
    it('should successfully start and stop port forwarding', async () => {
      const remotePort = 3001;
      const localPort = 9001;
      const testMessage = 'integration-test-message';

      // Create test server
      const server = await createTestServer(remotePort, testMessage);
      testServers.push(server);

      // Start forwarding
      const result = await portRelayManager.startForward({
        sandboxId: 'test-sandbox',
        remoteHost: 'localhost',
        remotePort,
        preferredPort: localPort
      });

      expect(result.success).toBe(true);
      expect(result.localPort).toBe(localPort);

      // Test connection
      await waitForCondition(() => testConnection(localPort, testMessage));

      // Verify port is in active forwards
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(1);
      expect(activeForwards[0].remotePort).toBe(remotePort);
      expect(activeForwards[0].localPort).toBe(localPort);
      expect(activeForwards[0].status).toBe('active');

      // Stop forwarding
      const stopResult = await portRelayManager.stopForward('test-sandbox', remotePort);
      expect(stopResult.success).toBe(true);

      // Verify cleanup
      const activeForwardsAfterStop = portRelayManager.getActiveForwards();
      expect(activeForwardsAfterStop).toHaveLength(0);
    });

    it('should handle port conflicts with automatic reassignment', async () => {
      const remotePort = 3002;
      const preferredPort = 9002;
      const testMessage = 'conflict-resolution-test';

      // Create test server
      const server = await createTestServer(remotePort, testMessage);
      testServers.push(server);

      // Block preferred port
      const blockingServer = await createTestServer(preferredPort, 'blocking');
      testServers.push(blockingServer);

      // Start forwarding - should find alternative port
      const result = await portRelayManager.startForward({
        sandboxId: 'test-sandbox-conflict',
        remoteHost: 'localhost',
        remotePort,
        preferredPort
      });

      expect(result.success).toBe(true);
      expect(result.localPort).not.toBe(preferredPort);
      expect(result.localPort).toBeGreaterThanOrEqual(8000); // Within default range

      // Test connection on assigned port
      await waitForCondition(() => testConnection(result.localPort!, testMessage));

      // Cleanup
      await portRelayManager.stopForward('test-sandbox-conflict', remotePort);
    });

    it('should emit events during forwarding operations', async () => {
      const remotePort = 3003;
      const testMessage = 'event-test';

      // Create test server
      const server = await createTestServer(remotePort, testMessage);
      testServers.push(server);

      // Start forwarding
      await portRelayManager.startForward({
        sandboxId: 'test-sandbox-events',
        remoteHost: 'localhost',
        remotePort
      });

      // Should have ports-updated event
      const portsEvent = eventLog.find(e => e.type === 'ports-updated');
      expect(portsEvent).toBeDefined();
      expect(portsEvent!.data).toHaveLength(1);
      expect(portsEvent!.data[0].remotePort).toBe(remotePort);

      // Stop forwarding
      eventLog.length = 0; // Clear events
      await portRelayManager.stopForward('test-sandbox-events', remotePort);

      // Should have another ports-updated event
      const stopEvent = eventLog.find(e => e.type === 'ports-updated');
      expect(stopEvent).toBeDefined();
      expect(stopEvent!.data).toHaveLength(0); // No active forwards
    });

    it('should handle multiple simultaneous forwards', async () => {
      const ports = [3004, 3005, 3006];
      const sandboxId = 'test-sandbox-multi';

      // Create test servers
      for (const port of ports) {
        const server = await createTestServer(port, `multi-${port}`);
        testServers.push(server);
      }

      // Start all forwards simultaneously
      const forwardPromises = ports.map(port =>
        portRelayManager.startForward({
          sandboxId,
          remoteHost: 'localhost',
          remotePort: port
        })
      );

      const results = await Promise.all(forwardPromises);

      // All should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.localPort).toBeGreaterThan(0);
      });

      // Verify all are active
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(ports.length);

      // Test connections
      for (let i = 0; i < results.length; i++) {
        const localPort = results[i].localPort!;
        const originalPort = ports[i];
        await waitForCondition(() => testConnection(localPort, `multi-${originalPort}`));
      }

      // Cleanup all
      for (const port of ports) {
        await portRelayManager.stopForward(sandboxId, port);
      }
    });

    it('should respect configuration settings', async () => {
      const remotePort = 3007;

      // Disable port forwarding in config
      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      // Create test server
      const server = await createTestServer(remotePort, 'disabled-test');
      testServers.push(server);

      // Attempt to start forwarding
      const result = await portRelayManager.startForward({
        sandboxId: 'test-sandbox-disabled',
        remoteHost: 'localhost',
        remotePort
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');

      // No active forwards should exist
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(0);
    });

    it('should stop all forwards when disabled', async () => {
      const ports = [3008, 3009];
      const sandboxId = 'test-sandbox-stop-all';

      // Create test servers and start forwards
      for (const port of ports) {
        const server = await createTestServer(port, `stop-all-${port}`);
        testServers.push(server);

        await portRelayManager.startForward({
          sandboxId,
          remoteHost: 'localhost',
          remotePort: port
        });
      }

      // Verify forwards are active
      expect(portRelayManager.getActiveForwards()).toHaveLength(ports.length);

      // Disable forwarding - should stop all
      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      // All forwards should be stopped
      await waitForCondition(() => portRelayManager.getActiveForwards().length === 0);
    });
  });

  // ── Error Handling and Edge Cases ──────────────────────────

  describe('Error Handling and Edge Cases', () => {
    it('should handle connection failures gracefully', async () => {
      const remotePort = 9999; // Non-existent server

      const result = await portRelayManager.startForward({
        sandboxId: 'test-sandbox-error',
        remoteHost: 'localhost',
        remotePort
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // No forwards should be active
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(0);
    });

    it('should handle rapid start/stop cycles', async () => {
      const remotePort = 3010;
      const sandboxId = 'test-sandbox-rapid';

      // Create test server
      const server = await createTestServer(remotePort, 'rapid-cycle-test');
      testServers.push(server);

      // Perform rapid start/stop cycles
      for (let i = 0; i < 5; i++) {
        const startResult = await portRelayManager.startForward({
          sandboxId,
          remoteHost: 'localhost',
          remotePort
        });

        expect(startResult.success).toBe(true);

        const stopResult = await portRelayManager.stopForward(sandboxId, remotePort);
        expect(stopResult.success).toBe(true);

        // Verify cleanup between cycles
        expect(portRelayManager.getActiveForwards()).toHaveLength(0);
      }
    });

    it('should handle duplicate forward requests', async () => {
      const remotePort = 3011;
      const sandboxId = 'test-sandbox-duplicate';

      // Create test server
      const server = await createTestServer(remotePort, 'duplicate-test');
      testServers.push(server);

      // First forward should succeed
      const result1 = await portRelayManager.startForward({
        sandboxId,
        remoteHost: 'localhost',
        remotePort
      });
      expect(result1.success).toBe(true);

      // Second forward for same port should fail
      const result2 = await portRelayManager.startForward({
        sandboxId,
        remoteHost: 'localhost',
        remotePort
      });
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already forwarded');

      // Should still have only one active forward
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(1);

      // Cleanup
      await portRelayManager.stopForward(sandboxId, remotePort);
    });

    it('should handle invalid configuration values', async () => {
      const invalidConfigs = [
        {
          enabled: true,
          autoForwardNewPorts: true,
          portRange: { start: 9000, end: 8000 }, // Invalid range
          excludedPorts: []
        },
        {
          enabled: true,
          autoForwardNewPorts: true,
          portRange: { start: -1, end: 100 }, // Invalid start
          excludedPorts: []
        },
        {
          enabled: true,
          autoForwardNewPorts: true,
          portRange: { start: 8000, end: 99999 }, // Invalid end
          excludedPorts: []
        }
      ];

      for (const config of invalidConfigs) {
        // Should handle gracefully without throwing
        expect(() => portRelayManager.setConfig(config)).not.toThrow();

        // Should still be able to get a valid config back
        const currentConfig = portRelayManager.getConfig();
        expect(currentConfig).toBeDefined();
        expect(typeof currentConfig.enabled).toBe('boolean');
      }
    });

    it('should handle event listener errors gracefully', async () => {
      // Add error-throwing event listener
      const errorListener = jest.fn(() => {
        throw new Error('Event listener error');
      });
      
      portRelayManager.addEventListener(errorListener);

      const remotePort = 3012;
      const server = await createTestServer(remotePort, 'error-listener-test');
      testServers.push(server);

      // Should not throw despite listener error
      await expect(portRelayManager.startForward({
        sandboxId: 'test-sandbox-listener-error',
        remoteHost: 'localhost',
        remotePort
      })).resolves.toBeDefined();

      // Forward should still succeed
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(1);

      // Cleanup
      await portRelayManager.stopForward('test-sandbox-listener-error', remotePort);
    });

    it('should handle port range exhaustion', async () => {
      const remotePort = 3013;
      
      // Set a very small port range
      portRelayManager.setConfig({
        enabled: true,
        autoForwardNewPorts: true,
        portRange: { start: 9020, end: 9022 }, // Only 3 ports
        excludedPorts: []
      });

      // Block all ports in range
      const blockingServers = [];
      for (let port = 9020; port <= 9022; port++) {
        const server = await createTestServer(port, 'blocking');
        blockingServers.push(server);
        testServers.push(server);
      }

      // Create remote server
      const remoteServer = await createTestServer(remotePort, 'range-exhaustion-test');
      testServers.push(remoteServer);

      // Should fail due to no available ports
      const result = await portRelayManager.startForward({
        sandboxId: 'test-sandbox-exhaustion',
        remoteHost: 'localhost',
        remotePort
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No free port found');
    });
  });

  // ── Integration with Electron Events ──────────────────────

  describe('Integration Features', () => {
    it('should handle sandbox cleanup properly', async () => {
      const sandboxId = 'test-sandbox-cleanup';
      const ports = [3014, 3015, 3016];

      // Create test servers and forwards
      for (const port of ports) {
        const server = await createTestServer(port, `cleanup-${port}`);
        testServers.push(server);

        await portRelayManager.startForward({
          sandboxId,
          remoteHost: 'localhost',
          remotePort: port
        });
      }

      // Verify all forwards are active
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(ports.length);

      // Cleanup all forwards for sandbox
      const cleanupResult = await portRelayManager.cleanupSandbox(sandboxId);
      expect(cleanupResult.stoppedPorts).toHaveLength(ports.length);

      // All forwards should be stopped
      const remainingForwards = portRelayManager.getActiveForwards();
      expect(remainingForwards).toHaveLength(0);
    });

    it('should maintain state across configuration reloads', async () => {
      const remotePort = 3017;
      const sandboxId = 'test-sandbox-reload';

      // Create test server
      const server = await createTestServer(remotePort, 'reload-test');
      testServers.push(server);

      // Start forward
      const result = await portRelayManager.startForward({
        sandboxId,
        remoteHost: 'localhost',
        remotePort
      });
      expect(result.success).toBe(true);

      // Update configuration
      const newConfig: PortRelayConfig = {
        enabled: true,
        autoForwardNewPorts: false,
        portRange: { start: 8500, end: 9500 },
        excludedPorts: [8080]
      };
      portRelayManager.setConfig(newConfig);

      // Forward should still be active
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(1);
      expect(activeForwards[0].remotePort).toBe(remotePort);

      // Connection should still work
      await waitForCondition(() => testConnection(result.localPort!, 'reload-test'));

      // Cleanup
      await portRelayManager.stopForward(sandboxId, remotePort);
    });

    it('should provide accurate status information', async () => {
      const remotePort = 3018;
      const sandboxId = 'test-sandbox-status';

      // Initially no forwards
      expect(portRelayManager.getActiveForwards()).toHaveLength(0);

      // Create test server
      const server = await createTestServer(remotePort, 'status-test');
      testServers.push(server);

      // Start forward
      const result = await portRelayManager.startForward({
        sandboxId,
        remoteHost: 'localhost',
        remotePort
      });

      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(1);

      const forward = activeForwards[0];
      expect(forward.sandboxId).toBe(sandboxId);
      expect(forward.remotePort).toBe(remotePort);
      expect(forward.localPort).toBe(result.localPort);
      expect(forward.status).toBe('active');
      expect(forward.createdAt).toBeGreaterThan(0);

      // Cleanup
      await portRelayManager.stopForward(sandboxId, remotePort);
    });
  });
}, TEST_CONFIG.testTimeout);