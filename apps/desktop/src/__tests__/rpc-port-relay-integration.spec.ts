/**
 * Integration Tests: RPC Communication for Port Relay
 *
 * Tests the RPC communication between Electron main and renderer processes
 * for port relay functionality. Tests cover:
 *   1. RPC schema validation and type safety
 *   2. Port relay configuration management via RPC
 *   3. Port forwarding requests and responses
 *   4. Event broadcasting from main to renderer
 *   5. Error handling and timeout scenarios
 *   6. Concurrent RPC request handling
 *
 * This file tests the RPC layer specifically, ensuring proper communication
 * between the PortRelayManager in the main process and the UI components
 * in the renderer process.
 */
import { jest } from '@jest/globals';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { PortRelayManager } from '../bun/port-relay-manager';
import type { 
  ApexRPCType, 
  PortRelayConfig, 
  RelayedPort,
  PortRelayRPCRequests,
  PortRelayRPCEvents 
} from '../shared/rpc-types';

// Mock Electrobun RPC for testing
interface MockRPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface MockRPCHandler {
  (params: any): Promise<MockRPCResponse>;
}

class MockElectrobunRPC {
  private handlers = new Map<string, MockRPCHandler>();
  private eventListeners = new Map<string, Function[]>();
  private requestId = 0;

  registerHandler(method: string, handler: MockRPCHandler): void {
    this.handlers.set(method, handler);
  }

  async callRenderer(method: string, params: any): Promise<MockRPCResponse> {
    const handler = this.handlers.get(method);
    if (!handler) {
      return { success: false, error: `Handler not found for method: ${method}` };
    }
    
    try {
      return await handler(params);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  emitEvent(event: string, data: any): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.error('RPC event listener error:', error);
      }
    });
  }

  onEvent(event: string, listener: Function): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
    
    return () => {
      const listeners = this.eventListeners.get(event) || [];
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }
}

// Test utilities
function createTempDir(): string {
  const tempDir = path.join(os.tmpdir(), 'rpc-port-relay-tests-' + Date.now());
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createMockHTTPServer(port: number): Promise<any> {
  return new Promise((resolve) => {
    const http = require('http');
    const server = http.createServer((req: any, res: any) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Test server on port ${port}`);
    });
    
    server.listen(port, 'localhost', () => {
      resolve(server);
    });
  });
}

async function waitForCondition(condition: () => boolean, timeout = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}

// Main test suite
describe('RPC Port Relay Integration Tests', () => {
  let tempDir: string;
  let portRelayManager: PortRelayManager;
  let mockRPC: MockElectrobunRPC;
  let testServers: any[] = [];

  beforeAll(() => {
    tempDir = createTempDir();
  });

  afterAll(() => {
    cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    // Initialize mock RPC
    mockRPC = new MockElectrobunRPC();
    
    // Create port relay manager
    portRelayManager = new PortRelayManager(tempDir);
    
    // Reset test state
    testServers = [];
  });

  afterEach(async () => {
    // Cleanup
    if (portRelayManager) {
      portRelayManager.stopAllForwards();
    }
    
    // Close test servers
    await Promise.all(
      testServers.map(server => 
        new Promise<void>(resolve => {
          try {
            server.close(() => resolve());
          } catch {
            resolve();
          }
        })
      )
    );
    testServers = [];
  });

  // ── RPC Schema and Type Safety Tests ────────────────────────

  describe('RPC Schema and Type Safety', () => {
    test('should validate port relay configuration RPC requests', async () => {
      const validConfig: PortRelayConfig = {
        enabled: true,
        autoForwardNewPorts: true,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: [8080, 8443]
      };

      // Register handler for config update
      mockRPC.registerHandler('updatePortRelayConfig', async (params) => {
        // Validate request structure
        expect(params).toHaveProperty('config');
        expect(params.config).toMatchObject(validConfig);
        
        // Update manager config
        portRelayManager.setConfig(params.config);
        
        return { success: true, data: portRelayManager.getConfig() };
      });

      // Test RPC call
      const response = await mockRPC.callRenderer('updatePortRelayConfig', { config: validConfig });
      
      expect(response.success).toBe(true);
      expect(response.data).toEqual(validConfig);
    });

    test('should handle invalid RPC parameters gracefully', async () => {
      // Register handler that validates parameters
      mockRPC.registerHandler('startPortForwarding', async (params) => {
        if (!params.sandboxId || !params.remotePort) {
          throw new Error('Missing required parameters: sandboxId, remotePort');
        }
        
        return { success: true };
      });

      // Test with missing parameters
      const response = await mockRPC.callRenderer('startPortForwarding', {
        sandboxId: 'test',
        // missing remotePort
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Missing required parameters');
    });

    test('should validate port forwarding request parameters', async () => {
      const validRequest = {
        sandboxId: 'test-sandbox',
        remoteHost: 'localhost',
        remotePort: 3000,
        preferredPort: 9000
      };

      mockRPC.registerHandler('startPortForwarding', async (params) => {
        // Validate all required fields
        expect(params.sandboxId).toBe(validRequest.sandboxId);
        expect(params.remoteHost).toBe(validRequest.remoteHost);
        expect(params.remotePort).toBe(validRequest.remotePort);
        expect(params.preferredPort).toBe(validRequest.preferredPort);
        
        // Validate types
        expect(typeof params.sandboxId).toBe('string');
        expect(typeof params.remoteHost).toBe('string');
        expect(typeof params.remotePort).toBe('number');
        expect(typeof params.preferredPort).toBe('number');
        
        return { success: true, data: { localPort: 9000 } };
      });

      const response = await mockRPC.callRenderer('startPortForwarding', validRequest);
      expect(response.success).toBe(true);
    });
  });

  // ── Port Relay Configuration via RPC ───────────────────────

  describe('Port Relay Configuration Management', () => {
    test('should get port relay configuration via RPC', async () => {
      const expectedConfig = portRelayManager.getConfig();

      mockRPC.registerHandler('getPortRelayConfig', async () => {
        return { success: true, data: portRelayManager.getConfig() };
      });

      const response = await mockRPC.callRenderer('getPortRelayConfig', {});
      
      expect(response.success).toBe(true);
      expect(response.data).toEqual(expectedConfig);
    });

    test('should update port relay configuration via RPC', async () => {
      const newConfig: PortRelayConfig = {
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 9000, end: 9500 },
        excludedPorts: [9000, 9001, 9002]
      };

      mockRPC.registerHandler('updatePortRelayConfig', async (params) => {
        portRelayManager.setConfig(params.config);
        return { success: true, data: portRelayManager.getConfig() };
      });

      const response = await mockRPC.callRenderer('updatePortRelayConfig', { config: newConfig });
      
      expect(response.success).toBe(true);
      expect(response.data).toEqual(newConfig);
      expect(portRelayManager.getConfig()).toEqual(newConfig);
    });

    test('should emit config-updated event via RPC', async () => {
      let eventReceived = false;
      let eventData: any = null;

      // Listen for config update events
      mockRPC.onEvent('port-relay-config-updated', (data) => {
        eventReceived = true;
        eventData = data;
      });

      // Set up port relay manager to emit events via RPC
      portRelayManager.addEventListener((event) => {
        if (event.type === 'config-updated') {
          mockRPC.emitEvent('port-relay-config-updated', event.data);
        }
      });

      // Update configuration
      const newConfig: PortRelayConfig = {
        enabled: true,
        autoForwardNewPorts: true,
        portRange: { start: 8500, end: 9500 },
        excludedPorts: []
      };

      portRelayManager.setConfig(newConfig);

      await waitForCondition(() => eventReceived);
      
      expect(eventData).toEqual(newConfig);
    });
  });

  // ── Port Forwarding Operations via RPC ─────────────────────

  describe('Port Forwarding Operations', () => {
    test('should start port forwarding via RPC', async () => {
      const remotePort = 3001;
      const preferredPort = 9001;

      // Create test server
      const server = await createMockHTTPServer(remotePort);
      testServers.push(server);

      mockRPC.registerHandler('startPortForwarding', async (params) => {
        const result = await portRelayManager.startForward({
          sandboxId: params.sandboxId,
          remoteHost: params.remoteHost,
          remotePort: params.remotePort,
          preferredPort: params.preferredPort
        });
        
        return { success: result.success, data: result, error: result.error };
      });

      const response = await mockRPC.callRenderer('startPortForwarding', {
        sandboxId: 'test-sandbox',
        remoteHost: 'localhost',
        remotePort,
        preferredPort
      });

      expect(response.success).toBe(true);
      expect(response.data?.success).toBe(true);
      expect(response.data?.localPort).toBe(preferredPort);
    });

    test('should stop port forwarding via RPC', async () => {
      const remotePort = 3002;
      const sandboxId = 'test-sandbox-stop';

      // Create and start forwarding
      const server = await createMockHTTPServer(remotePort);
      testServers.push(server);

      const startResult = await portRelayManager.startForward({
        sandboxId,
        remoteHost: 'localhost',
        remotePort
      });
      expect(startResult.success).toBe(true);

      mockRPC.registerHandler('stopPortForwarding', async (params) => {
        const result = await portRelayManager.stopForward(params.sandboxId, params.remotePort);
        return { success: result.success, data: result, error: result.error };
      });

      const response = await mockRPC.callRenderer('stopPortForwarding', {
        sandboxId,
        remotePort
      });

      expect(response.success).toBe(true);
      expect(response.data?.success).toBe(true);
    });

    test('should get active forwards via RPC', async () => {
      const remotePort = 3003;
      const sandboxId = 'test-sandbox-list';

      // Start forwarding
      const server = await createMockHTTPServer(remotePort);
      testServers.push(server);

      await portRelayManager.startForward({
        sandboxId,
        remoteHost: 'localhost',
        remotePort
      });

      mockRPC.registerHandler('getActivePortForwards', async () => {
        const forwards = portRelayManager.getActiveForwards();
        return { success: true, data: forwards };
      });

      const response = await mockRPC.callRenderer('getActivePortForwards', {});

      expect(response.success).toBe(true);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].remotePort).toBe(remotePort);
      expect(response.data[0].sandboxId).toBe(sandboxId);
    });

    test('should clean up sandbox forwards via RPC', async () => {
      const sandboxId = 'test-sandbox-cleanup';
      const ports = [3004, 3005, 3006];

      // Start multiple forwards
      for (const port of ports) {
        const server = await createMockHTTPServer(port);
        testServers.push(server);
        
        await portRelayManager.startForward({
          sandboxId,
          remoteHost: 'localhost',
          remotePort: port
        });
      }

      // Verify forwards are active
      expect(portRelayManager.getActiveForwards()).toHaveLength(ports.length);

      mockRPC.registerHandler('cleanupSandboxForwards', async (params) => {
        const result = await portRelayManager.cleanupSandbox(params.sandboxId);
        return { success: true, data: result };
      });

      const response = await mockRPC.callRenderer('cleanupSandboxForwards', { sandboxId });

      expect(response.success).toBe(true);
      expect(response.data?.stoppedPorts).toHaveLength(ports.length);
      expect(portRelayManager.getActiveForwards()).toHaveLength(0);
    });
  });

  // ── Event Broadcasting from Main to Renderer ──────────────

  describe('Event Broadcasting', () => {
    test('should broadcast ports-updated events via RPC', async () => {
      let eventReceived = false;
      let eventData: RelayedPort[] = [];

      // Listen for ports updated events
      mockRPC.onEvent('port-relay-ports-updated', (data) => {
        eventReceived = true;
        eventData = data;
      });

      // Set up event forwarding
      portRelayManager.addEventListener((event) => {
        if (event.type === 'ports-updated') {
          mockRPC.emitEvent('port-relay-ports-updated', event.data);
        }
      });

      // Start forwarding to trigger event
      const server = await createMockHTTPServer(3007);
      testServers.push(server);

      await portRelayManager.startForward({
        sandboxId: 'test-event-sandbox',
        remoteHost: 'localhost',
        remotePort: 3007
      });

      await waitForCondition(() => eventReceived);
      
      expect(Array.isArray(eventData)).toBe(true);
      expect(eventData).toHaveLength(1);
      expect(eventData[0].remotePort).toBe(3007);
    });

    test('should handle event listener errors gracefully', async () => {
      // Add error-throwing event listener
      const errorListener = jest.fn(() => {
        throw new Error('Event listener error');
      });
      
      mockRPC.onEvent('port-relay-test-event', errorListener);

      // Emit event - should not throw
      expect(() => {
        mockRPC.emitEvent('port-relay-test-event', { test: 'data' });
      }).not.toThrow();

      expect(errorListener).toHaveBeenCalled();
    });

    test('should support event unsubscription', async () => {
      let eventCount = 0;
      
      const listener = () => {
        eventCount++;
      };

      const unsubscribe = mockRPC.onEvent('port-relay-unsubscribe-test', listener);
      
      // Emit event
      mockRPC.emitEvent('port-relay-unsubscribe-test', {});
      expect(eventCount).toBe(1);
      
      // Unsubscribe and emit again
      unsubscribe();
      mockRPC.emitEvent('port-relay-unsubscribe-test', {});
      expect(eventCount).toBe(1); // Should not increment
    });
  });

  // ── Error Handling and Timeout Scenarios ──────────────────

  describe('Error Handling and Timeout Scenarios', () => {
    test('should handle RPC timeout scenarios', async () => {
      const TIMEOUT_MS = 1000;

      mockRPC.registerHandler('slowOperation', async () => {
        // Simulate slow operation
        await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS + 500));
        return { success: true };
      });

      // Implement timeout wrapper
      const timeoutPromise = new Promise<MockRPCResponse>((_, reject) => {
        setTimeout(() => reject(new Error('RPC timeout')), TIMEOUT_MS);
      });

      const operationPromise = mockRPC.callRenderer('slowOperation', {});

      await expect(Promise.race([operationPromise, timeoutPromise])).rejects.toThrow('RPC timeout');
    });

    test('should handle RPC handler exceptions', async () => {
      mockRPC.registerHandler('failingOperation', async () => {
        throw new Error('Simulated handler failure');
      });

      const response = await mockRPC.callRenderer('failingOperation', {});

      expect(response.success).toBe(false);
      expect(response.error).toContain('Simulated handler failure');
    });

    test('should handle missing RPC handlers', async () => {
      const response = await mockRPC.callRenderer('nonExistentMethod', {});

      expect(response.success).toBe(false);
      expect(response.error).toContain('Handler not found');
    });

    test('should handle malformed RPC parameters', async () => {
      mockRPC.registerHandler('strictValidation', async (params) => {
        if (typeof params.requiredNumber !== 'number') {
          throw new Error('requiredNumber must be a number');
        }
        return { success: true };
      });

      const response = await mockRPC.callRenderer('strictValidation', {
        requiredNumber: 'not-a-number'
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('must be a number');
    });
  });

  // ── Concurrent RPC Request Handling ────────────────────────

  describe('Concurrent RPC Request Handling', () => {
    test('should handle multiple concurrent RPC requests', async () => {
      const requestCount = 10;
      const responses: MockRPCResponse[] = [];

      mockRPC.registerHandler('concurrentTest', async (params) => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
        return { success: true, data: { requestId: params.requestId } };
      });

      // Make concurrent requests
      const requests = Array.from({ length: requestCount }, (_, i) =>
        mockRPC.callRenderer('concurrentTest', { requestId: i })
      );

      const results = await Promise.all(requests);

      // All requests should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.data?.requestId).toBe(index);
      });
    });

    test('should handle concurrent port forwarding requests', async () => {
      const ports = [3010, 3011, 3012, 3013, 3014];

      // Create test servers
      for (const port of ports) {
        const server = await createMockHTTPServer(port);
        testServers.push(server);
      }

      mockRPC.registerHandler('concurrentForwarding', async (params) => {
        const result = await portRelayManager.startForward({
          sandboxId: params.sandboxId,
          remoteHost: 'localhost',
          remotePort: params.remotePort
        });
        return { success: result.success, data: result };
      });

      // Start concurrent forwarding
      const requests = ports.map(port =>
        mockRPC.callRenderer('concurrentForwarding', {
          sandboxId: 'concurrent-sandbox',
          remotePort: port
        })
      );

      const results = await Promise.all(requests);

      // All should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.data?.success).toBe(true);
        expect(result.data?.localPort).toBeGreaterThan(0);
      });

      // All ports should be active
      const activeForwards = portRelayManager.getActiveForwards();
      expect(activeForwards).toHaveLength(ports.length);
    });

    test('should maintain RPC request isolation', async () => {
      let request1Complete = false;
      let request2Complete = false;
      let request1Data: any = null;
      let request2Data: any = null;

      mockRPC.registerHandler('isolationTest', async (params) => {
        // Different processing times to test isolation
        const delay = params.requestId === 1 ? 200 : 50;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return { 
          success: true, 
          data: { 
            requestId: params.requestId,
            timestamp: Date.now(),
            customData: params.customData
          }
        };
      });

      // Start requests with different timings
      const request1 = mockRPC.callRenderer('isolationTest', {
        requestId: 1,
        customData: 'first-request-data'
      }).then(result => {
        request1Complete = true;
        request1Data = result.data;
      });

      const request2 = mockRPC.callRenderer('isolationTest', {
        requestId: 2,
        customData: 'second-request-data'
      }).then(result => {
        request2Complete = true;
        request2Data = result.data;
      });

      await Promise.all([request1, request2]);

      expect(request1Complete).toBe(true);
      expect(request2Complete).toBe(true);
      expect(request1Data?.customData).toBe('first-request-data');
      expect(request2Data?.customData).toBe('second-request-data');
      expect(request1Data?.requestId).toBe(1);
      expect(request2Data?.requestId).toBe(2);
    });
  });

  // ── Performance and Memory Management ──────────────────────

  describe('Performance and Memory Management', () => {
    test('should handle high-frequency RPC calls efficiently', async () => {
      const callCount = 1000;
      let processedCount = 0;

      mockRPC.registerHandler('highFrequency', async (params) => {
        processedCount++;
        return { success: true, data: { callNumber: params.callNumber } };
      });

      const startTime = Date.now();
      
      const promises = Array.from({ length: callCount }, (_, i) =>
        mockRPC.callRenderer('highFrequency', { callNumber: i })
      );

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      const callsPerSecond = callCount / (duration / 1000);

      expect(processedCount).toBe(callCount);
      expect(callsPerSecond).toBeGreaterThan(100); // Should handle at least 100 calls/second
    });

    test('should clean up event listeners properly', async () => {
      const eventCounts = new Map<string, number>();
      const unsubscribers: Array<() => void> = [];

      // Create multiple event listeners
      for (let i = 0; i < 10; i++) {
        const eventName = `test-event-${i}`;
        eventCounts.set(eventName, 0);
        
        const unsubscribe = mockRPC.onEvent(eventName, () => {
          eventCounts.set(eventName, eventCounts.get(eventName)! + 1);
        });
        unsubscribers.push(unsubscribe);
      }

      // Emit events
      eventCounts.forEach((_, eventName) => {
        mockRPC.emitEvent(eventName, {});
      });

      // Verify events were received
      eventCounts.forEach(count => {
        expect(count).toBe(1);
      });

      // Unsubscribe all
      unsubscribers.forEach(unsubscribe => unsubscribe());

      // Reset counts and emit again
      eventCounts.forEach((_, eventName) => {
        eventCounts.set(eventName, 0);
        mockRPC.emitEvent(eventName, {});
      });

      // No events should be received after unsubscribing
      eventCounts.forEach(count => {
        expect(count).toBe(0);
      });
    });
  });
});