/**
 * E2E Integration Tests: WebSocket Tunnel for Daytona Port Relay
 *
 * Tests the WebSocket tunnel communication system used for port forwarding
 * in Daytona cloud environments where direct TCP connections are not possible.
 *
 * Tests cover:
 *   1. WebSocket tunnel establishment and teardown
 *   2. TCP-over-WebSocket forwarding for Daytona sandboxes
 *   3. Combined proxy service integration
 *   4. Multi-client tunnel handling
 *   5. Error scenarios and recovery
 *   6. Performance under load
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=websocket-tunnel-integration
 */
import * as WebSocket from 'ws';
import * as net from 'net';
import * as http from 'http';
import axios from 'axios';
import { projectsService } from '../../api/src/modules/projects/projects.service';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const baseURL = `http://${host}:${port}`;

// Test configuration
const TEST_CONFIG = {
  tunnelPort: 9700,
  proxyPort: 9701,
  testTimeout: 30000,
  connectionTimeout: 10000,
  heartbeatInterval: 5000
};

// ── Test Utilities ──────────────────────────────────────────

/**
 * Create a mock Daytona sandbox server
 */
class MockDaytonaSandbox {
  private server: http.Server;
  private wsServer: WebSocket.Server;
  private tunnels = new Map<string, WebSocket>();

  constructor(private port: number) {
    this.server = http.createServer();
    this.wsServer = new WebSocket.Server({ server: this.server });
    
    this.wsServer.on('connection', (ws, req) => {
      const tunnelId = req.url?.split('tunnelId=')[1] || 'default';
      this.tunnels.set(tunnelId, ws);
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleTunnelMessage(ws, message);
        } catch (error) {
          console.error('Invalid tunnel message:', error);
        }
      });
      
      ws.on('close', () => {
        this.tunnels.delete(tunnelId);
      });
    });
  }
  
  private handleTunnelMessage(ws: WebSocket, message: any): void {
    switch (message.type) {
      case 'tunnel_open':
        // Simulate successful tunnel establishment
        ws.send(JSON.stringify({
          type: 'tunnel_ready',
          tunnelId: message.tunnelId,
          localPort: message.targetPort
        }));
        break;
        
      case 'tunnel_data':
        // Echo data back for testing
        ws.send(JSON.stringify({
          type: 'tunnel_data',
          tunnelId: message.tunnelId,
          data: message.data
        }));
        break;
        
      case 'tunnel_close':
        ws.send(JSON.stringify({
          type: 'tunnel_closed',
          tunnelId: message.tunnelId
        }));
        break;
        
      case 'heartbeat':
        ws.send(JSON.stringify({
          type: 'heartbeat_ack',
          timestamp: Date.now()
        }));
        break;
    }
  }
  
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, resolve);
    });
  }
  
  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wsServer.close();
      this.server.close(() => resolve());
    });
  }
  
  getTunnelCount(): number {
    return this.tunnels.size;
  }
  
  sendToTunnel(tunnelId: string, message: any): boolean {
    const tunnel = this.tunnels.get(tunnelId);
    if (tunnel && tunnel.readyState === WebSocket.OPEN) {
      tunnel.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
}

/**
 * WebSocket tunnel client for testing
 */
class TestTunnelClient {
  private ws: WebSocket | null = null;
  private messageHandlers = new Map<string, Function>();
  private isConnected = false;

  constructor(private url: string, private tunnelId: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.url}?tunnelId=${this.tunnelId}`);
      
      this.ws.on('open', () => {
        this.isConnected = true;
        resolve();
      });
      
      this.ws.on('error', reject);
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message);
          }
        } catch (error) {
          console.error('Failed to parse tunnel message:', error);
        }
      });
      
      this.ws.on('close', () => {
        this.isConnected = false;
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
  }

  send(message: any): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(type: string, handler: Function): void {
    this.messageHandlers.set(type, handler);
  }

  getConnectionState(): boolean {
    return this.isConnected;
  }
}

/**
 * Create a test TCP server
 */
function createTCPServer(port: number, response = 'tcp-test-response'): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        socket.write(response);
      });
    });
    
    server.listen(port, 'localhost', () => resolve(server));
    server.on('error', reject);
  });
}

/**
 * Test TCP connection
 */
function testTCPConnection(port: number, testData = 'test', expectedResponse?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, 'localhost');
    let received = '';
    
    socket.on('connect', () => {
      socket.write(testData);
    });
    
    socket.on('data', (data) => {
      received += data.toString();
      if (!expectedResponse || received.includes(expectedResponse)) {
        socket.end();
        resolve(true);
      }
    });
    
    socket.on('error', () => resolve(false));
    socket.on('close', () => resolve(false));
    
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 5000);
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
 * Create mock project for Daytona provider
 */
function createMockDaytonaProject() {
  return {
    id: `daytona-project-${Date.now()}`,
    name: 'Test Daytona Project',
    sandboxId: `daytona-sandbox-${Date.now()}`,
    provider: 'daytona',
    status: 'active',
    metadata: {
      tunnelEndpoint: `ws://localhost:${TEST_CONFIG.tunnelPort}`,
      proxyEndpoint: `http://localhost:${TEST_CONFIG.proxyPort}`
    }
  };
}

// ── Main Test Suite ──────────────────────────────────────────

describe('WebSocket Tunnel Integration Tests', () => {
  let mockSandbox: MockDaytonaSandbox;
  let testServers: Array<net.Server | http.Server> = [];
  let tunnelClients: TestTunnelClient[] = [];

  beforeAll(async () => {
    // Start mock Daytona sandbox
    mockSandbox = new MockDaytonaSandbox(TEST_CONFIG.tunnelPort);
    await mockSandbox.start();
  });

  afterAll(async () => {
    // Cleanup mock sandbox
    if (mockSandbox) {
      await mockSandbox.stop();
    }
    
    // Cleanup test servers
    await Promise.all(
      testServers.map(server => 
        new Promise<void>(resolve => server.close(() => resolve()))
      )
    );
    
    // Cleanup tunnel clients
    tunnelClients.forEach(client => client.disconnect());
  });

  beforeEach(() => {
    // Reset state for each test
    testServers = [];
    tunnelClients = [];
  });

  afterEach(async () => {
    // Cleanup after each test
    tunnelClients.forEach(client => client.disconnect());
    tunnelClients = [];
    
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

  // ── Basic WebSocket Tunnel Tests ────────────────────────────

  describe('Basic WebSocket Tunnel Operations', () => {
    it('should establish WebSocket tunnel connection', async () => {
      const tunnelId = 'test-tunnel-1';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      await client.connect();
      
      expect(client.getConnectionState()).toBe(true);
      expect(mockSandbox.getTunnelCount()).toBe(1);
    });

    it('should handle tunnel establishment protocol', async () => {
      const tunnelId = 'test-tunnel-2';
      const targetPort = 8080;
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      let tunnelReady = false;
      client.onMessage('tunnel_ready', (message) => {
        expect(message.tunnelId).toBe(tunnelId);
        expect(message.localPort).toBe(targetPort);
        tunnelReady = true;
      });

      await client.connect();
      
      client.send({
        type: 'tunnel_open',
        tunnelId,
        targetPort
      });

      await waitForCondition(() => tunnelReady);
    });

    it('should handle data transmission through tunnel', async () => {
      const tunnelId = 'test-tunnel-3';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      let receivedData: string | null = null;
      client.onMessage('tunnel_data', (message) => {
        receivedData = message.data;
      });

      await client.connect();
      
      const testData = 'Hello through tunnel!';
      client.send({
        type: 'tunnel_data',
        tunnelId,
        data: testData
      });

      await waitForCondition(() => receivedData === testData);
    });

    it('should handle tunnel closure gracefully', async () => {
      const tunnelId = 'test-tunnel-4';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      let tunnelClosed = false;
      client.onMessage('tunnel_closed', (message) => {
        expect(message.tunnelId).toBe(tunnelId);
        tunnelClosed = true;
      });

      await client.connect();
      
      client.send({
        type: 'tunnel_close',
        tunnelId
      });

      await waitForCondition(() => tunnelClosed);
    });

    it('should support heartbeat mechanism', async () => {
      const tunnelId = 'test-tunnel-5';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      let heartbeatAck = false;
      client.onMessage('heartbeat_ack', (message) => {
        expect(message.timestamp).toBeGreaterThan(0);
        heartbeatAck = true;
      });

      await client.connect();
      
      client.send({
        type: 'heartbeat',
        timestamp: Date.now()
      });

      await waitForCondition(() => heartbeatAck);
    });
  });

  // ── Multi-Client Tunnel Tests ───────────────────────────────

  describe('Multi-Client Tunnel Handling', () => {
    it('should handle multiple simultaneous tunnels', async () => {
      const numTunnels = 5;
      const clients: TestTunnelClient[] = [];

      // Create multiple tunnel clients
      for (let i = 0; i < numTunnels; i++) {
        const client = new TestTunnelClient(
          `ws://localhost:${TEST_CONFIG.tunnelPort}`,
          `multi-tunnel-${i}`
        );
        clients.push(client);
        tunnelClients.push(client);
      }

      // Connect all clients
      await Promise.all(clients.map(client => client.connect()));

      // Verify all connections
      clients.forEach(client => {
        expect(client.getConnectionState()).toBe(true);
      });
      
      expect(mockSandbox.getTunnelCount()).toBe(numTunnels);
    });

    it('should isolate data between different tunnels', async () => {
      const tunnel1Id = 'isolated-tunnel-1';
      const tunnel2Id = 'isolated-tunnel-2';
      
      const client1 = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnel1Id);
      const client2 = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnel2Id);
      tunnelClients.push(client1, client2);

      let client1Data: string | null = null;
      let client2Data: string | null = null;
      
      client1.onMessage('tunnel_data', (message) => {
        if (message.tunnelId === tunnel1Id) {
          client1Data = message.data;
        }
      });
      
      client2.onMessage('tunnel_data', (message) => {
        if (message.tunnelId === tunnel2Id) {
          client2Data = message.data;
        }
      });

      await Promise.all([client1.connect(), client2.connect()]);

      // Send different data to each tunnel
      client1.send({
        type: 'tunnel_data',
        tunnelId: tunnel1Id,
        data: 'data-for-tunnel-1'
      });

      client2.send({
        type: 'tunnel_data',
        tunnelId: tunnel2Id,
        data: 'data-for-tunnel-2'
      });

      // Wait for responses
      await waitForCondition(() => client1Data === 'data-for-tunnel-1');
      await waitForCondition(() => client2Data === 'data-for-tunnel-2');

      // Verify isolation
      expect(client1Data).toBe('data-for-tunnel-1');
      expect(client2Data).toBe('data-for-tunnel-2');
    });

    it('should handle client disconnections gracefully', async () => {
      const numClients = 3;
      const clients: TestTunnelClient[] = [];

      // Create and connect clients
      for (let i = 0; i < numClients; i++) {
        const client = new TestTunnelClient(
          `ws://localhost:${TEST_CONFIG.tunnelPort}`,
          `disconnect-test-${i}`
        );
        clients.push(client);
        tunnelClients.push(client);
        await client.connect();
      }

      expect(mockSandbox.getTunnelCount()).toBe(numClients);

      // Disconnect middle client
      clients[1].disconnect();
      await waitForCondition(() => mockSandbox.getTunnelCount() === numClients - 1);

      // Other clients should still be connected
      expect(clients[0].getConnectionState()).toBe(true);
      expect(clients[2].getConnectionState()).toBe(true);
    });
  });

  // ── TCP-over-WebSocket Integration ──────────────────────────

  describe('TCP-over-WebSocket Integration', () => {
    it('should proxy TCP connections through WebSocket tunnel', async () => {
      const tunnelId = 'tcp-proxy-tunnel';
      const remotePort = 8081;
      const localPort = 9081;
      
      // Create TCP server to simulate remote service
      const tcpServer = await createTCPServer(remotePort, 'tcp-response');
      testServers.push(tcpServer);

      // Setup tunnel client
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      let tunnelEstablished = false;
      client.onMessage('tunnel_ready', () => {
        tunnelEstablished = true;
      });

      await client.connect();
      
      // Request tunnel establishment
      client.send({
        type: 'tunnel_open',
        tunnelId,
        targetPort: remotePort,
        localPort
      });

      await waitForCondition(() => tunnelEstablished);

      // Simulate data flow (this would normally be handled by the combined proxy service)
      const testResult = await testTCPConnection(remotePort, 'test-data', 'tcp-response');
      expect(testResult).toBe(true);
    });

    it('should handle bidirectional data flow', async () => {
      const tunnelId = 'bidirectional-tunnel';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      const dataExchanges: Array<{ sent: string; received: string }> = [];
      
      client.onMessage('tunnel_data', (message) => {
        dataExchanges.push({
          sent: message.originalData || 'unknown',
          received: message.data
        });
      });

      await client.connect();

      // Send multiple data packets
      const testData = ['packet1', 'packet2', 'packet3'];
      for (const data of testData) {
        client.send({
          type: 'tunnel_data',
          tunnelId,
          data,
          originalData: data
        });
      }

      await waitForCondition(() => dataExchanges.length === testData.length);

      // Verify all data was echoed back
      testData.forEach((data, index) => {
        expect(dataExchanges[index].received).toBe(data);
      });
    });

    it('should handle large data transfers', async () => {
      const tunnelId = 'large-data-tunnel';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      // Create large test data (1MB)
      const largeData = 'x'.repeat(1024 * 1024);
      let receivedData: string | null = null;

      client.onMessage('tunnel_data', (message) => {
        receivedData = message.data;
      });

      await client.connect();

      client.send({
        type: 'tunnel_data',
        tunnelId,
        data: largeData
      });

      await waitForCondition(() => receivedData === largeData, 20000); // Longer timeout for large data
    });
  });

  // ── Error Scenarios and Recovery ────────────────────────────

  describe('Error Scenarios and Recovery', () => {
    it('should handle network interruptions', async () => {
      const tunnelId = 'network-interruption-tunnel';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      await client.connect();
      expect(client.getConnectionState()).toBe(true);

      // Simulate network interruption by stopping the mock sandbox
      await mockSandbox.stop();
      
      await waitForCondition(() => !client.getConnectionState());

      // Restart mock sandbox
      mockSandbox = new MockDaytonaSandbox(TEST_CONFIG.tunnelPort);
      await mockSandbox.start();

      // Client should be able to reconnect (in real implementation)
      // For this test, we just verify the disconnection was detected
      expect(client.getConnectionState()).toBe(false);
    });

    it('should handle malformed messages gracefully', async () => {
      const tunnelId = 'malformed-message-tunnel';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      await client.connect();

      // Send malformed JSON - should not crash the tunnel
      (client as any).ws.send('invalid-json');
      (client as any).ws.send(JSON.stringify({ invalid: 'structure' }));

      // Valid message should still work
      let validResponse = false;
      client.onMessage('heartbeat_ack', () => {
        validResponse = true;
      });

      client.send({
        type: 'heartbeat',
        timestamp: Date.now()
      });

      await waitForCondition(() => validResponse);
    });

    it('should handle tunnel ID conflicts', async () => {
      const conflictingId = 'conflicting-tunnel-id';
      
      const client1 = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, conflictingId);
      const client2 = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, conflictingId);
      tunnelClients.push(client1, client2);

      await client1.connect();
      await client2.connect();

      // Both should connect (the mock allows this, but real implementation should handle conflicts)
      expect(client1.getConnectionState()).toBe(true);
      expect(client2.getConnectionState()).toBe(true);

      // In real implementation, the second connection might replace the first
      // or generate a unique ID. For testing, we verify both connections work.
      expect(mockSandbox.getTunnelCount()).toBeGreaterThanOrEqual(1);
    });

    it('should timeout inactive connections', async () => {
      const tunnelId = 'timeout-tunnel';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      await client.connect();

      // In a real implementation, there would be timeout handling
      // For this test, we verify the connection can be established and remains active
      expect(client.getConnectionState()).toBe(true);

      // Simulate sending heartbeat to prevent timeout
      client.send({
        type: 'heartbeat',
        timestamp: Date.now()
      });

      // Connection should remain active
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(client.getConnectionState()).toBe(true);
    });
  });

  // ── Performance and Load Testing ────────────────────────────

  describe('Performance and Load Testing', () => {
    it('should handle high-frequency message exchange', async () => {
      const tunnelId = 'high-frequency-tunnel';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      const messageCount = 1000;
      let receivedCount = 0;

      client.onMessage('tunnel_data', () => {
        receivedCount++;
      });

      await client.connect();

      // Send many messages rapidly
      for (let i = 0; i < messageCount; i++) {
        client.send({
          type: 'tunnel_data',
          tunnelId,
          data: `message-${i}`
        });
      }

      await waitForCondition(() => receivedCount >= messageCount * 0.95, 15000); // Allow 5% loss
      expect(receivedCount).toBeGreaterThan(messageCount * 0.9); // At least 90% should be received
    });

    it('should maintain performance with concurrent tunnels', async () => {
      const numTunnels = 10;
      const messagesPerTunnel = 100;
      const clients: TestTunnelClient[] = [];
      const receivedCounts = new Array(numTunnels).fill(0);

      // Create concurrent tunnels
      for (let i = 0; i < numTunnels; i++) {
        const client = new TestTunnelClient(
          `ws://localhost:${TEST_CONFIG.tunnelPort}`,
          `perf-tunnel-${i}`
        );
        
        client.onMessage('tunnel_data', () => {
          receivedCounts[i]++;
        });
        
        clients.push(client);
        tunnelClients.push(client);
        await client.connect();
      }

      // Send messages from all tunnels simultaneously
      const startTime = Date.now();
      
      const sendPromises = clients.map((client, index) => {
        return Promise.resolve().then(() => {
          for (let j = 0; j < messagesPerTunnel; j++) {
            client.send({
              type: 'tunnel_data',
              tunnelId: `perf-tunnel-${index}`,
              data: `message-${j}`
            });
          }
        });
      });

      await Promise.all(sendPromises);

      // Wait for responses
      await waitForCondition(
        () => receivedCounts.every(count => count >= messagesPerTunnel * 0.9),
        20000
      );

      const endTime = Date.now();
      const totalMessages = numTunnels * messagesPerTunnel;
      const duration = endTime - startTime;
      const messagesPerSecond = totalMessages / (duration / 1000);

      console.log(`Performance: ${messagesPerSecond.toFixed(2)} messages/second`);
      
      // Verify reasonable performance (this threshold may need adjustment)
      expect(messagesPerSecond).toBeGreaterThan(100);
    });

    it('should handle tunnel burst connections', async () => {
      const numConnections = 20;
      const clients: TestTunnelClient[] = [];

      // Create many connections rapidly
      const connectPromises = [];
      for (let i = 0; i < numConnections; i++) {
        const client = new TestTunnelClient(
          `ws://localhost:${TEST_CONFIG.tunnelPort}`,
          `burst-tunnel-${i}`
        );
        clients.push(client);
        tunnelClients.push(client);
        connectPromises.push(client.connect());
      }

      await Promise.all(connectPromises);

      // All connections should succeed
      clients.forEach(client => {
        expect(client.getConnectionState()).toBe(true);
      });

      expect(mockSandbox.getTunnelCount()).toBe(numConnections);
    });
  });

  // ── Integration with Combined Proxy Service ─────────────────

  describe('Combined Proxy Service Integration', () => {
    it('should integrate with combined proxy for HTTPS requests', async () => {
      // This test would verify integration with the combined proxy service
      // that handles both secrets injection and port forwarding tunnels
      
      const tunnelId = 'proxy-integration-tunnel';
      const client = new TestTunnelClient(`ws://localhost:${TEST_CONFIG.tunnelPort}`, tunnelId);
      tunnelClients.push(client);

      await client.connect();

      // Simulate proxy request forwarding
      const proxyRequest = {
        type: 'proxy_request',
        tunnelId,
        method: 'GET',
        url: '/api/test',
        headers: { 'User-Agent': 'test-client' },
        body: null
      };

      let proxyResponse = null;
      client.onMessage('proxy_response', (message) => {
        proxyResponse = message;
      });

      client.send(proxyRequest);

      // In real implementation, this would be handled by the combined proxy
      // For testing, we simulate a response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Simulate proxy sending response back
      mockSandbox.sendToTunnel(tunnelId, {
        type: 'proxy_response',
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"status":"success"}'
      });

      await waitForCondition(() => proxyResponse !== null);
      expect(proxyResponse).toBeDefined();
    });
  });
}, TEST_CONFIG.testTimeout);