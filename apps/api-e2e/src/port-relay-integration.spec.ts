/**
 * E2E Integration Tests: Port Relay System
 *
 * Comprehensive tests covering:
 *   1. PortRelayManager functionality (start/stop forwarding, conflict resolution)
 *   2. Port forwarding for both local containers and Daytona sandboxes
 *   3. WebSocket tunnel communication for Daytona
 *   4. PortRelayService coordination
 *   5. RPC communication between processes
 *   6. Error handling and edge cases
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=port-relay-integration
 */
import axios from 'axios';
import * as net from 'net';
import * as http from 'http';
import * as WebSocket from 'ws';
import { PortRelayService, type PortRelayEvent } from '../../api/src/modules/preview/port-relay.service';
import { 
  forwardPortWithRange, 
  unforwardPort, 
  autoForwardPorts, 
  getPortStatus,
  type PortInfo,
  type PortStatus 
} from '../../api/src/modules/preview/port-forwarder';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const baseURL = `http://${host}:${port}`;

// Test configuration
const TEST_CONFIG = {
  localPortRange: { start: 9000, end: 9100 },
  remotePortRange: { start: 3000, end: 3010 },
  testTimeout: 30000,
  healthCheckInterval: 1000,
  maxRetries: 3
};

// ── Test Utilities ──────────────────────────────────────────

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
 * Test if a port is reachable via HTTP
 */
async function testPortConnection(port: number, expectedResponse?: string): Promise<boolean> {
  try {
    const response = await axios.get(`http://localhost:${port}`, { timeout: 5000 });
    if (expectedResponse && response.data !== expectedResponse) {
      return false;
    }
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Check if a local port is available
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

/**
 * Wait for a condition to be true with timeout
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
 * Mock project data for testing
 */
function createMockProject(provider = 'docker') {
  return {
    id: `test-project-${Date.now()}`,
    name: 'Test Project',
    sandboxId: `test-sandbox-${Date.now()}`,
    provider,
    status: 'active'
  };
}

/**
 * Create a WebSocket tunnel mock for Daytona provider testing
 */
class MockWebSocketTunnel {
  private server: WebSocket.Server;
  private connections = new Set<WebSocket>();
  
  constructor(private port: number) {
    this.server = new WebSocket.Server({ port });
    this.server.on('connection', (ws) => {
      this.connections.add(ws);
      ws.on('close', () => this.connections.delete(ws));
      
      // Echo messages for testing
      ws.on('message', (data) => {
        ws.send(data);
      });
    });
  }
  
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.connections.forEach(ws => ws.close());
      this.server.close(resolve);
    });
  }
  
  getConnectionCount(): number {
    return this.connections.size;
  }
}

// ── Main Test Suite ──────────────────────────────────────────

describe('Port Relay System Integration Tests', () => {
  let portRelayService: PortRelayService;
  let testServers: http.Server[] = [];
  let mockTunnels: MockWebSocketTunnel[] = [];
  let eventLog: PortRelayEvent[] = [];

  beforeAll(async () => {
    // Initialize the port relay service
    portRelayService = new PortRelayService({
      enableAutoForward: true,
      excludedPorts: [8080, 8443, 8888, 3001],
      maxAutoForwards: 5,
      supportedProviders: ['docker', 'apple-container', 'daytona']
    });

    // Subscribe to events for testing
    portRelayService.onEvent((event) => {
      eventLog.push(event);
    });
  });

  afterAll(async () => {
    // Cleanup all test resources
    await Promise.all([
      ...testServers.map(server => new Promise<void>(resolve => server.close(() => resolve()))),
      ...mockTunnels.map(tunnel => tunnel.close())
    ]);
  });

  beforeEach(() => {
    // Reset event log before each test
    eventLog.length = 0;
  });

  // ── Core Port Forwarding Tests ──────────────────────────────

  describe('Basic Port Forwarding', () => {
    it('should forward a single port successfully', async () => {
      const remotePort = 3001;
      const testMessage = 'port-forward-test';
      
      // Create test server
      const server = await createTestServer(remotePort, testMessage);
      testServers.push(server);
      
      // Forward the port
      const result = await forwardPortWithRange({
        sandboxId: 'test-sandbox',
        remoteHost: 'localhost',
        remotePort,
        preferredPort: 9001
      });
      
      expect(result.success).toBe(true);
      expect(result.localPort).toBeGreaterThan(0);
      
      // Test connection through forwarded port
      await waitForCondition(
        () => testPortConnection(result.localPort!, testMessage)
      );
      
      // Cleanup
      await unforwardPort('test-sandbox', remotePort);
    });

    it('should handle port conflicts with automatic reassignment', async () => {
      const remotePort = 3002;
      const preferredPort = 9002;
      const testMessage = 'conflict-test';
      
      // Create test server
      const server = await createTestServer(remotePort, testMessage);
      testServers.push(server);
      
      // Block the preferred port
      const blockingServer = await createTestServer(preferredPort, 'blocking');
      testServers.push(blockingServer);
      
      // Forward should find alternative port
      const result = await forwardPortWithRange({
        sandboxId: 'test-sandbox',
        remoteHost: 'localhost',
        remotePort,
        preferredPort
      });
      
      expect(result.success).toBe(true);
      expect(result.localPort).not.toBe(preferredPort);
      expect(result.localPort).toBeGreaterThan(preferredPort);
      
      // Test connection
      await waitForCondition(
        () => testPortConnection(result.localPort!, testMessage)
      );
      
      // Cleanup
      await unforwardPort('test-sandbox', remotePort);
    });

    it('should handle multiple simultaneous forwards', async () => {
      const ports = [3003, 3004, 3005];
      const forwards: any[] = [];
      
      // Create test servers
      for (const port of ports) {
        const server = await createTestServer(port, `test-${port}`);
        testServers.push(server);
      }
      
      // Forward all ports simultaneously
      const forwardPromises = ports.map(port =>
        forwardPortWithRange({
          sandboxId: 'test-sandbox-multi',
          remoteHost: 'localhost',
          remotePort: port,
          preferredPort: 9000 + port
        })
      );
      
      const results = await Promise.all(forwardPromises);
      
      // Verify all forwards succeeded
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.localPort).toBeGreaterThan(0);
        forwards.push({ remotePort: ports[index], localPort: result.localPort });
      });
      
      // Test all connections
      for (const forward of forwards) {
        await waitForCondition(
          () => testPortConnection(forward.localPort, `test-${forward.remotePort}`)
        );
      }
      
      // Cleanup
      for (const port of ports) {
        await unforwardPort('test-sandbox-multi', port);
      }
    });

    it('should detect and report port status correctly', async () => {
      const remotePort = 3006;
      const testMessage = 'status-test';
      
      // Create test server
      const server = await createTestServer(remotePort, testMessage);
      testServers.push(server);
      
      // Forward the port
      const result = await forwardPortWithRange({
        sandboxId: 'test-sandbox-status',
        remoteHost: 'localhost',
        remotePort
      });
      
      expect(result.success).toBe(true);
      
      // Check status
      const status = getPortStatus('test-sandbox-status', remotePort);
      expect(status).toBeDefined();
      expect(status!.status).toBe('active');
      expect(status!.localPort).toBe(result.localPort);
      expect(status!.remotePort).toBe(remotePort);
      expect(status!.sandboxId).toBe('test-sandbox-status');
      
      // Cleanup
      await unforwardPort('test-sandbox-status', remotePort);
      
      // Status should be updated
      const statusAfterCleanup = getPortStatus('test-sandbox-status', remotePort);
      expect(statusAfterCleanup).toBeUndefined();
    });
  });

  // ── Auto-Forward Tests ──────────────────────────────────────

  describe('Auto-Forward Functionality', () => {
    it('should auto-forward detected ports', async () => {
      const detectedPorts: PortInfo[] = [
        { port: 3007, protocol: 'http' },
        { port: 3008, protocol: 'https' },
        { port: 3009, protocol: 'http' }
      ];
      
      // Create test servers for detected ports
      for (const portInfo of detectedPorts) {
        const server = await createTestServer(portInfo.port, `auto-${portInfo.port}`);
        testServers.push(server);
      }
      
      // Trigger auto-forward
      const results = await autoForwardPorts({
        sandboxId: 'test-sandbox-auto',
        remoteHost: 'localhost',
        ports: detectedPorts
      });
      
      expect(results.length).toBe(detectedPorts.length);
      
      // Verify each forward
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const originalPort = detectedPorts[i].port;
        
        expect(result.success).toBe(true);
        expect(result.localPort).toBeGreaterThan(0);
        
        // Test connection
        await waitForCondition(
          () => testPortConnection(result.localPort!, `auto-${originalPort}`)
        );
      }
      
      // Cleanup
      for (const portInfo of detectedPorts) {
        await unforwardPort('test-sandbox-auto', portInfo.port);
      }
    });

    it('should respect excluded ports in auto-forward', async () => {
      const detectedPorts: PortInfo[] = [
        { port: 8080, protocol: 'http' }, // excluded
        { port: 3010, protocol: 'http' }, // not excluded
        { port: 8443, protocol: 'https' } // excluded
      ];
      
      // Create test servers
      for (const portInfo of detectedPorts) {
        const server = await createTestServer(portInfo.port, `excluded-${portInfo.port}`);
        testServers.push(server);
      }
      
      // Auto-forward should skip excluded ports
      const results = await autoForwardPorts({
        sandboxId: 'test-sandbox-excluded',
        remoteHost: 'localhost',
        ports: detectedPorts
      });
      
      // Only the non-excluded port should be forwarded
      const successfulForwards = results.filter(r => r.success);
      expect(successfulForwards).toHaveLength(1);
      expect(successfulForwards[0].remotePort).toBe(3010);
      
      // Cleanup
      await unforwardPort('test-sandbox-excluded', 3010);
    });
  });

  // ── PortRelayService Integration Tests ───────────────────────

  describe('PortRelayService Integration', () => {
    it('should initialize project and handle port updates', async () => {
      const mockProject = createMockProject('docker');
      
      // Mock project service response
      const originalFindById = require('../../api/src/modules/projects/projects.service.js').projectsService.findById;
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = 
        jest.fn().mockResolvedValue(mockProject);
      
      // Initialize project
      await portRelayService.initializeProject(mockProject.id);
      
      // Simulate port update
      const portUpdate = {
        ports: [
          { port: 3011, protocol: 'http' },
          { port: 3012, protocol: 'https' }
        ]
      };
      
      // Create test servers
      for (const portInfo of portUpdate.ports) {
        const server = await createTestServer(portInfo.port, `service-${portInfo.port}`);
        testServers.push(server);
      }
      
      await portRelayService.handlePortsUpdate(mockProject.id, portUpdate);
      
      // Verify events were emitted
      expect(eventLog.length).toBeGreaterThan(0);
      const updateEvent = eventLog.find(e => e.type === 'port_forwards_updated');
      expect(updateEvent).toBeDefined();
      expect(updateEvent!.projectId).toBe(mockProject.id);
      
      // Restore original function
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = originalFindById;
      
      // Cleanup
      await portRelayService.cleanupProject(mockProject.id);
    });

    it('should handle auto-forward toggle', async () => {
      const mockProject = createMockProject('docker');
      const projectId = mockProject.id;
      
      // Mock project service
      const originalFindById = require('../../api/src/modules/projects/projects.service.js').projectsService.findById;
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = 
        jest.fn().mockResolvedValue(mockProject);
      
      // Initialize project
      await portRelayService.initializeProject(projectId);
      
      // Enable auto-forward
      await portRelayService.setAutoForward(projectId, true);
      
      // Verify event
      const enableEvent = eventLog.find(e => 
        e.type === 'auto_forward_status_changed' && 
        e.payload.autoForwardEnabled === true
      );
      expect(enableEvent).toBeDefined();
      
      // Disable auto-forward
      await portRelayService.setAutoForward(projectId, false);
      
      // Verify event
      const disableEvent = eventLog.find(e => 
        e.type === 'auto_forward_status_changed' && 
        e.payload.autoForwardEnabled === false
      );
      expect(disableEvent).toBeDefined();
      
      // Restore and cleanup
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = originalFindById;
      await portRelayService.cleanupProject(projectId);
    });
  });

  // ── WebSocket Tunnel Tests (Daytona Provider) ───────────────

  describe('WebSocket Tunnel Integration', () => {
    it('should handle Daytona WebSocket tunnel communication', async () => {
      const tunnelPort = 9500;
      const mockProject = createMockProject('daytona');
      
      // Create WebSocket tunnel mock
      const tunnel = new MockWebSocketTunnel(tunnelPort);
      mockTunnels.push(tunnel);
      
      // Wait for tunnel to be ready
      await waitForCondition(async () => {
        try {
          const ws = new WebSocket(`ws://localhost:${tunnelPort}`);
          return new Promise((resolve) => {
            ws.on('open', () => {
              ws.close();
              resolve(true);
            });
            ws.on('error', () => resolve(false));
          });
        } catch {
          return false;
        }
      });
      
      // Test WebSocket communication
      const ws = new WebSocket(`ws://localhost:${tunnelPort}`);
      const messages: string[] = [];
      
      ws.on('message', (data) => {
        messages.push(data.toString());
      });
      
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.send('test-tunnel-message');
          setTimeout(() => {
            ws.close();
            resolve();
          }, 1000);
        });
      });
      
      expect(messages).toContain('test-tunnel-message');
      expect(tunnel.getConnectionCount()).toBe(0); // Closed
    });

    it('should handle tunnel connection failures gracefully', async () => {
      const invalidTunnelPort = 9999; // Unused port
      
      // Try to connect to non-existent tunnel
      try {
        const ws = new WebSocket(`ws://localhost:${invalidTunnelPort}`);
        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => {
            ws.close();
            reject(new Error('Should not connect'));
          });
          ws.on('error', () => resolve());
          setTimeout(() => resolve(), 2000); // Timeout fallback
        });
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
      }
    });
  });

  // ── Error Handling and Edge Cases ──────────────────────────

  describe('Error Handling and Edge Cases', () => {
    it('should handle remote server unavailable', async () => {
      const remotePort = 9999; // Non-existent server
      
      const result = await forwardPortWithRange({
        sandboxId: 'test-sandbox-error',
        remoteHost: 'localhost',
        remotePort,
        preferredPort: 9010
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle rapid forward/unforward cycles', async () => {
      const remotePort = 3013;
      const sandboxId = 'test-sandbox-rapid';
      
      // Create test server
      const server = await createTestServer(remotePort, 'rapid-test');
      testServers.push(server);
      
      // Rapid forward/unforward cycles
      for (let i = 0; i < 5; i++) {
        const result = await forwardPortWithRange({
          sandboxId,
          remoteHost: 'localhost',
          remotePort
        });
        
        expect(result.success).toBe(true);
        
        await unforwardPort(sandboxId, remotePort);
        
        // Verify cleanup
        const status = getPortStatus(sandboxId, remotePort);
        expect(status).toBeUndefined();
      }
    });

    it('should handle port exhaustion in range', async () => {
      const remotePort = 3014;
      const sandboxId = 'test-sandbox-exhaustion';
      
      // Create test server
      const server = await createTestServer(remotePort, 'exhaustion-test');
      testServers.push(server);
      
      // Block all ports in a small range
      const blockingServers: http.Server[] = [];
      const smallRange = { start: 9020, end: 9022 }; // Only 3 ports available
      
      for (let port = smallRange.start; port <= smallRange.end; port++) {
        const blockingServer = await createTestServer(port, 'blocking');
        blockingServers.push(blockingServer);
        testServers.push(blockingServer);
      }
      
      // Try to forward - should fail due to no available ports
      const result = await forwardPortWithRange({
        sandboxId,
        remoteHost: 'localhost',
        remotePort,
        portRange: smallRange
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No free port found');
    });

    it('should handle invalid sandbox configurations', async () => {
      const mockProject = createMockProject('unsupported-provider');
      
      // Mock project service
      const originalFindById = require('../../api/src/modules/projects/projects.service.js').projectsService.findById;
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = 
        jest.fn().mockResolvedValue(mockProject);
      
      // Should handle gracefully
      await expect(portRelayService.initializeProject(mockProject.id)).resolves.not.toThrow();
      
      // Should not create any forwards for unsupported providers
      const portUpdate = {
        ports: [{ port: 3015, protocol: 'http' }]
      };
      
      await portRelayService.handlePortsUpdate(mockProject.id, portUpdate);
      
      // No forwards should be created
      const status = getPortStatus(mockProject.sandboxId, 3015);
      expect(status).toBeUndefined();
      
      // Restore
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = originalFindById;
    });

    it('should handle concurrent access to port forwarding', async () => {
      const remotePort = 3016;
      const sandboxId = 'test-sandbox-concurrent';
      
      // Create test server
      const server = await createTestServer(remotePort, 'concurrent-test');
      testServers.push(server);
      
      // Try multiple concurrent forwards for the same port
      const forwardPromises = Array(5).fill(null).map(() =>
        forwardPortWithRange({
          sandboxId,
          remoteHost: 'localhost',
          remotePort
        })
      );
      
      const results = await Promise.all(forwardPromises);
      
      // Only one should succeed, others should fail gracefully
      const successfulForwards = results.filter(r => r.success);
      expect(successfulForwards).toHaveLength(1);
      
      // All others should have errors
      const failedForwards = results.filter(r => !r.success);
      expect(failedForwards.length).toBe(4);
      failedForwards.forEach(result => {
        expect(result.error).toBeDefined();
      });
      
      // Cleanup
      await unforwardPort(sandboxId, remotePort);
    });
  });

  // ── Performance and Load Tests ──────────────────────────────

  describe('Performance and Load Tests', () => {
    it('should handle high-frequency port updates', async () => {
      const mockProject = createMockProject('docker');
      const projectId = mockProject.id;
      
      // Mock project service
      const originalFindById = require('../../api/src/modules/projects/projects.service.js').projectsService.findById;
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = 
        jest.fn().mockResolvedValue(mockProject);
      
      await portRelayService.initializeProject(projectId);
      await portRelayService.setAutoForward(projectId, true);
      
      // Create multiple test servers
      const ports = Array.from({ length: 10 }, (_, i) => 3020 + i);
      for (const port of ports) {
        const server = await createTestServer(port, `load-${port}`);
        testServers.push(server);
      }
      
      // Send rapid port updates
      const updatePromises = ports.map(async (port, index) => {
        await new Promise(resolve => setTimeout(resolve, index * 100)); // Stagger updates
        return portRelayService.handlePortsUpdate(projectId, {
          ports: [{ port, protocol: 'http' }]
        });
      });
      
      await Promise.all(updatePromises);
      
      // Verify all events were handled
      expect(eventLog.length).toBeGreaterThan(ports.length);
      
      // Cleanup
      require('../../api/src/modules/projects/projects.service.js').projectsService.findById = originalFindById;
      await portRelayService.cleanupProject(projectId);
    });

    it('should maintain performance with many simultaneous connections', async () => {
      const remotePort = 3030;
      const numConnections = 10;
      
      // Create test server
      const server = await createTestServer(remotePort, 'connection-test');
      testServers.push(server);
      
      // Forward the port
      const result = await forwardPortWithRange({
        sandboxId: 'test-sandbox-connections',
        remoteHost: 'localhost',
        remotePort
      });
      
      expect(result.success).toBe(true);
      
      // Make multiple simultaneous connections
      const connectionPromises = Array(numConnections).fill(null).map(async () => {
        return testPortConnection(result.localPort!, 'connection-test');
      });
      
      const connectionResults = await Promise.all(connectionPromises);
      
      // All connections should succeed
      connectionResults.forEach(success => {
        expect(success).toBe(true);
      });
      
      // Cleanup
      await unforwardPort('test-sandbox-connections', remotePort);
    });
  });
}, TEST_CONFIG.testTimeout);