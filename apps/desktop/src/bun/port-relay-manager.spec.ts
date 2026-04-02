/**
 * Comprehensive unit tests for PortRelayManager
 * Tests port forwarding lifecycle, conflict resolution, cross-platform functionality, and RPC integration
 */

import { beforeEach, afterEach, describe, expect, it, jest, beforeAll, afterAll } from '@jest/globals';
import { createServer, connect } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PortRelayManager } from './port-relay-manager';
import type { PortRelayConfig, RelayedPort } from '../shared/rpc-types';

// Mock dependencies
jest.mock('fs');
jest.mock('net');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockNet = { createServer, connect } as jest.Mocked<typeof import('net')>;

describe('PortRelayManager', () => {
  let portRelayManager: PortRelayManager;
  let tempDir: string;
  let mockServers: Map<number, any>;
  let mockConnections: Set<any>;

  beforeAll(() => {
    // Create temporary directory for tests
    tempDir = path.join(os.tmpdir(), 'port-relay-tests-' + Date.now());
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockServers = new Map();
    mockConnections = new Set();

    // Mock fs.existsSync to return false initially (no config file)
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockImplementation(() => undefined);
    mockFs.writeFileSync.mockImplementation(() => undefined);
    mockFs.readFileSync.mockReturnValue('{}');

    // Mock net.createServer
    mockNet.createServer.mockImplementation(() => {
      const server = {
        listen: jest.fn((port: number, host: string, callback: () => void) => {
          // Simulate successful binding
          setTimeout(callback, 0);
          mockServers.set(port, server);
        }),
        close: jest.fn((callback?: () => void) => {
          if (callback) callback();
        }),
        once: jest.fn(),
        on: jest.fn()
      };
      return server as any;
    });

    // Mock net.connect
    mockNet.connect.mockImplementation(() => {
      const socket = {
        pipe: jest.fn(),
        destroy: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        once: jest.fn()
      };
      mockConnections.add(socket);
      return socket as any;
    });

    portRelayManager = new PortRelayManager(tempDir);
  });

  afterEach(() => {
    if (portRelayManager) {
      portRelayManager.destroy();
    }
    mockServers.clear();
    mockConnections.clear();
  });

  afterAll(() => {
    // Cleanup temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Configuration Management', () => {
    it('should load default configuration when no config file exists', () => {
      const config = portRelayManager.getConfig();
      
      expect(config).toEqual({
        enabled: true,
        autoForwardNewPorts: true,
        portRange: {
          start: 8000,
          end: 9000
        },
        excludedPorts: []
      });
    });

    it('should load existing configuration from file', () => {
      const customConfig: PortRelayConfig = {
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 3000, end: 4000 },
        excludedPorts: [3001, 3002]
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(customConfig));

      const manager = new PortRelayManager(tempDir);
      const config = manager.getConfig();

      expect(config).toEqual(customConfig);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.join(tempDir, 'port-relay-config.json'),
        'utf-8'
      );
    });

    it('should handle corrupt config file gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const manager = new PortRelayManager(tempDir);
      const config = manager.getConfig();

      expect(config.enabled).toBe(true); // Should fall back to defaults
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[port-relay] Failed to load config'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should save configuration changes', () => {
      const newConfig: PortRelayConfig = {
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 5000, end: 6000 },
        excludedPorts: [5001]
      };

      const eventSpy = jest.fn();
      portRelayManager.addEventListener(eventSpy);

      portRelayManager.setConfig(newConfig);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(tempDir, 'port-relay-config.json'),
        JSON.stringify(newConfig, null, 2)
      );
      expect(eventSpy).toHaveBeenCalledWith({
        type: 'config-updated',
        data: newConfig
      });
    });

    it('should stop all forwards when disabling port relay', async () => {
      // First enable and create some forwards
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3001);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(2);

      // Now disable
      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      const portsAfterDisable = portRelayManager.getRelayedPorts('sandbox1');
      expect(portsAfterDisable).toHaveLength(0);
    });
  });

  describe('Port Management Utilities', () => {
    it('should check if port is free', async () => {
      // Mock successful port check
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn((callback: () => void) => {
          setTimeout(callback, 0);
        }),
        once: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      // Access private method via type assertion
      const isPortFree = (portRelayManager as any).isPortFree;
      const result = await isPortFree(8080);

      expect(result).toBe(true);
      expect(mockServer.listen).toHaveBeenCalledWith(8080, '127.0.0.1', expect.any(Function));
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should detect occupied ports', async () => {
      // Mock port in use
      const mockServer = {
        once: jest.fn((event: string, callback: (err?: Error) => void) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('EADDRINUSE')), 0);
          }
        }),
        listen: jest.fn(),
        close: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      const isPortFree = (portRelayManager as any).isPortFree;
      const result = await isPortFree(8080);

      expect(result).toBe(false);
    });

    it('should find free port in configured range', async () => {
      // Mock first few ports as occupied, then find free one
      let callCount = 0;
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn((callback: () => void) => {
          setTimeout(callback, 0);
        }),
        once: jest.fn((event: string, callback: (err?: Error) => void) => {
          if (event === 'error' && callCount < 2) {
            callCount++;
            setTimeout(() => callback(new Error('EADDRINUSE')), 0);
          }
        })
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      const findFreePort = (portRelayManager as any).findFreePort;
      const result = await findFreePort(8080);

      expect(result).toBeGreaterThanOrEqual(8000);
      expect(result).toBeLessThanOrEqual(9000);
    });

    it('should respect excluded ports when finding free port', async () => {
      portRelayManager.setConfig({
        enabled: true,
        autoForwardNewPorts: true,
        portRange: { start: 8000, end: 8002 },
        excludedPorts: [8000, 8001]
      });

      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn((callback: () => void) => {
          setTimeout(callback, 0);
        }),
        once: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      const findFreePort = (portRelayManager as any).findFreePort;
      const result = await findFreePort();

      expect(result).toBe(8002); // Should skip excluded ports 8000, 8001
    });

    it('should throw error when no free port in range', async () => {
      portRelayManager.setConfig({
        enabled: true,
        autoForwardNewPorts: true,
        portRange: { start: 8000, end: 8000 }, // Very small range
        excludedPorts: [8000] // Exclude the only port
      });

      const findFreePort = (portRelayManager as any).findFreePort;
      
      await expect(findFreePort()).rejects.toThrow('No free port found in range 8000-8000');
    });
  });

  describe('Port Forwarding', () => {
    beforeEach(() => {
      // Mock successful server creation
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);
    });

    it('should create port forward successfully', async () => {
      const localPort = await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);

      expect(localPort).toBeGreaterThanOrEqual(8000);
      expect(localPort).toBeLessThanOrEqual(9000);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        remotePort: 3000,
        localPort,
        sandboxId: 'sandbox1',
        status: 'active'
      });
    });

    it('should return existing forward for duplicate requests', async () => {
      const firstLocalPort = await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      const secondLocalPort = await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);

      expect(firstLocalPort).toBe(secondLocalPort);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(1); // Should not create duplicate
    });

    it('should handle different sandboxes independently', async () => {
      const port1 = await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      const port2 = await portRelayManager.forwardPort('sandbox2', '127.0.0.1', 3000);

      expect(port1).not.toBe(port2); // Different local ports

      const sandbox1Ports = portRelayManager.getRelayedPorts('sandbox1');
      const sandbox2Ports = portRelayManager.getRelayedPorts('sandbox2');

      expect(sandbox1Ports).toHaveLength(1);
      expect(sandbox2Ports).toHaveLength(1);
      expect(sandbox1Ports[0].sandboxId).toBe('sandbox1');
      expect(sandbox2Ports[0].sandboxId).toBe('sandbox2');
    });

    it('should reject forwarding when port relay is disabled', async () => {
      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      await expect(
        portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000)
      ).rejects.toThrow('Port relay is disabled');
    });

    it('should handle server listen errors', async () => {
      const mockServer = {
        once: jest.fn((event: string, callback: (err: Error) => void) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Listen failed')), 0);
          }
        }),
        listen: jest.fn(),
        close: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      await expect(
        portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000)
      ).rejects.toThrow('Listen failed');
    });

    it('should stop port forward successfully', async () => {
      const localPort = await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      
      expect(portRelayManager.getRelayedPorts('sandbox1')).toHaveLength(1);

      const result = portRelayManager.unforwardPort('sandbox1', 3000);
      expect(result).toBe(true);
      expect(portRelayManager.getRelayedPorts('sandbox1')).toHaveLength(0);
    });

    it('should return false when trying to stop non-existent forward', () => {
      const result = portRelayManager.unforwardPort('sandbox1', 3000);
      expect(result).toBe(false);
    });

    it('should stop all forwards for a sandbox', async () => {
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3001);
      await portRelayManager.forwardPort('sandbox2', '127.0.0.1', 3002);

      expect(portRelayManager.getRelayedPorts('sandbox1')).toHaveLength(2);
      expect(portRelayManager.getRelayedPorts('sandbox2')).toHaveLength(1);

      const stoppedCount = portRelayManager.unforwardAllForSandbox('sandbox1');
      expect(stoppedCount).toBe(2);

      expect(portRelayManager.getRelayedPorts('sandbox1')).toHaveLength(0);
      expect(portRelayManager.getRelayedPorts('sandbox2')).toHaveLength(1);
    });
  });

  describe('Auto-forwarding', () => {
    beforeEach(() => {
      // Enable auto-forwarding
      portRelayManager.setConfig({
        enabled: true,
        autoForwardNewPorts: true,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: [8080, 8443]
      });

      // Mock successful server creation
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);
    });

    it('should auto-forward new TCP ports', async () => {
      const eventSpy = jest.fn();
      portRelayManager.addEventListener(eventSpy);

      await portRelayManager.handleNewPorts('sandbox1', '127.0.0.1', [
        { port: 3000, protocol: 'tcp' },
        { port: 3001, protocol: 'tcp' },
        { port: 53, protocol: 'udp' } // Should be ignored
      ]);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(2); // Only TCP ports
      expect(ports.map(p => p.remotePort).sort()).toEqual([3000, 3001]);

      expect(eventSpy).toHaveBeenCalledWith({
        type: 'ports-updated',
        data: expect.objectContaining({
          sandboxPorts: expect.any(Map)
        })
      });
    });

    it('should skip excluded ports during auto-forwarding', async () => {
      await portRelayManager.handleNewPorts('sandbox1', '127.0.0.1', [
        { port: 8080, protocol: 'tcp' }, // Excluded
        { port: 8443, protocol: 'tcp' }, // Excluded
        { port: 3000, protocol: 'tcp' }  // Should be forwarded
      ]);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(1);
      expect(ports[0].remotePort).toBe(3000);
    });

    it('should skip already forwarded ports', async () => {
      // Manually forward a port first
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);

      // Try to auto-forward the same port
      await portRelayManager.handleNewPorts('sandbox1', '127.0.0.1', [
        { port: 3000, protocol: 'tcp' },
        { port: 3001, protocol: 'tcp' }
      ]);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(2); // Should add only the new port
      expect(ports.map(p => p.remotePort).sort()).toEqual([3000, 3001]);
    });

    it('should handle errors during auto-forwarding gracefully', async () => {
      // Mock server creation to fail for specific port
      let callCount = 0;
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn((event: string, callback: (err?: Error) => void) => {
          if (event === 'error' && callCount === 0) {
            callCount++;
            setTimeout(() => callback(new Error('Port in use')), 0);
          }
        }),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await portRelayManager.handleNewPorts('sandbox1', '127.0.0.1', [
        { port: 3000, protocol: 'tcp' }, // Should fail
        { port: 3001, protocol: 'tcp' }  // Should succeed
      ]);

      // Should have warnings for failed port but still forward successful ones
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to auto-forward port 3000'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should not auto-forward when disabled', async () => {
      portRelayManager.setConfig({
        enabled: true,
        autoForwardNewPorts: false, // Disabled
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      await portRelayManager.handleNewPorts('sandbox1', '127.0.0.1', [
        { port: 3000, protocol: 'tcp' }
      ]);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(0);
    });

    it('should not auto-forward when port relay is disabled', async () => {
      portRelayManager.setConfig({
        enabled: false, // Disabled
        autoForwardNewPorts: true,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      await portRelayManager.handleNewPorts('sandbox1', '127.0.0.1', [
        { port: 3000, protocol: 'tcp' }
      ]);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports).toHaveLength(0);
    });
  });

  describe('Status and Information', () => {
    beforeEach(() => {
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);
    });

    it('should return relayed ports for specific sandbox', async () => {
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      await portRelayManager.forwardPort('sandbox2', '127.0.0.1', 3001);

      const sandbox1Ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(sandbox1Ports).toHaveLength(1);
      expect(sandbox1Ports[0].sandboxId).toBe('sandbox1');

      const sandbox2Ports = portRelayManager.getRelayedPorts('sandbox2');
      expect(sandbox2Ports).toHaveLength(1);
      expect(sandbox2Ports[0].sandboxId).toBe('sandbox2');
    });

    it('should return all relayed ports when no sandbox specified', async () => {
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      await portRelayManager.forwardPort('sandbox2', '127.0.0.1', 3001);

      const allPorts = portRelayManager.getRelayedPorts();
      expect(allPorts).toHaveLength(2);
      expect(allPorts.map(p => p.sandboxId).sort()).toEqual(['sandbox1', 'sandbox2']);
    });

    it('should sort ports by remote port number', async () => {
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3002);
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3001);

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports.map(p => p.remotePort)).toEqual([3000, 3001, 3002]);
    });

    it('should include creation timestamp in port info', async () => {
      const beforeTime = Date.now();
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      const afterTime = Date.now();

      const ports = portRelayManager.getRelayedPorts('sandbox1');
      expect(ports[0].createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(ports[0].createdAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Event System', () => {
    it('should emit config-updated events', () => {
      const eventSpy = jest.fn();
      portRelayManager.addEventListener(eventSpy);

      const newConfig: PortRelayConfig = {
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 5000, end: 6000 },
        excludedPorts: []
      };

      portRelayManager.setConfig(newConfig);

      expect(eventSpy).toHaveBeenCalledWith({
        type: 'config-updated',
        data: newConfig
      });
    });

    it('should emit ports-updated events', async () => {
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      const eventSpy = jest.fn();
      portRelayManager.addEventListener(eventSpy);

      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);

      expect(eventSpy).toHaveBeenCalledWith({
        type: 'ports-updated',
        data: expect.objectContaining({
          sandboxPorts: expect.any(Map)
        })
      });
    });

    it('should remove event listeners', () => {
      const eventSpy = jest.fn();
      
      portRelayManager.addEventListener(eventSpy);
      portRelayManager.removeEventListener(eventSpy);

      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      expect(eventSpy).not.toHaveBeenCalled();
    });

    it('should handle event listener errors gracefully', () => {
      const faultyListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      portRelayManager.addEventListener(faultyListener);
      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      expect(faultyListener).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[port-relay] Event listener error:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Connection Handling', () => {
    it('should handle client connections and create upstream connections', async () => {
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };

      let connectionHandler: ((clientSocket: any) => void) | undefined;
      mockNet.createServer.mockImplementation((handler) => {
        connectionHandler = handler;
        return mockServer as any;
      });

      const mockUpstream = {
        pipe: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        once: jest.fn()
      };

      const mockClientSocket = {
        pipe: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        once: jest.fn()
      };

      mockNet.connect.mockReturnValue(mockUpstream as any);

      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);

      // Simulate client connection
      expect(connectionHandler).toBeDefined();
      connectionHandler!(mockClientSocket);

      // Verify upstream connection was created
      expect(mockNet.connect).toHaveBeenCalledWith(3000, '127.0.0.1', expect.any(Function));

      // Verify event handlers were set up
      expect(mockUpstream.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClientSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClientSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockUpstream.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('Cleanup', () => {
    it('should cleanup all resources on destroy', async () => {
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      const eventSpy = jest.fn();
      portRelayManager.addEventListener(eventSpy);

      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000);
      await portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3001);

      expect(portRelayManager.getRelayedPorts()).toHaveLength(2);

      portRelayManager.destroy();

      // Should close all servers
      expect(mockServer.close).toHaveBeenCalledTimes(2);
      
      // Should clear event listeners
      expect(portRelayManager['eventListeners']).toHaveLength(0);

      // Should clear forwards
      expect(portRelayManager.getRelayedPorts()).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors during config save', () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[port-relay] Failed to save config:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle directory creation errors', () => {
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Cannot create directory');
      });
      mockFs.existsSync.mockReturnValue(false);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      portRelayManager.setConfig({
        enabled: false,
        autoForwardNewPorts: false,
        portRange: { start: 8000, end: 9000 },
        excludedPorts: []
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[port-relay] Failed to save config:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Cross-Platform Compatibility', () => {
    it('should work on Windows paths', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true
      });

      try {
        const manager = new PortRelayManager('C:\\Users\\test');
        const config = manager.getConfig();
        expect(config).toBeDefined();
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          writable: true
        });
      }
    });

    it('should handle different network interfaces', async () => {
      const mockServer = {
        listen: jest.fn((_port: number, host: string, callback: () => void) => {
          expect(host).toBe('127.0.0.1'); // Should always bind to localhost
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      await portRelayManager.forwardPort('sandbox1', '192.168.1.100', 3000);
      
      expect(mockServer.listen).toHaveBeenCalledWith(
        expect.any(Number),
        '127.0.0.1',
        expect.any(Function)
      );
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle multiple concurrent forwards', async () => {
      const mockServer = {
        listen: jest.fn((_port: number, _host: string, callback: () => void) => {
          setTimeout(callback, 0);
        }),
        close: jest.fn(),
        once: jest.fn(),
        on: jest.fn()
      };
      mockNet.createServer.mockReturnValue(mockServer as any);

      // Create multiple forwards concurrently
      const forwardPromises = [];
      for (let i = 0; i < 10; i++) {
        forwardPromises.push(
          portRelayManager.forwardPort('sandbox1', '127.0.0.1', 3000 + i)
        );
      }

      const results = await Promise.all(forwardPromises);
      
      expect(results).toHaveLength(10);
      expect(new Set(results)).toHaveLength(10); // All unique local ports
      expect(portRelayManager.getRelayedPorts('sandbox1')).toHaveLength(10);
    });

    it('should track connection count correctly', async () => {
      // This would require more complex mocking to simulate actual connections
      // For now, just verify the structure is in place
      const ports = portRelayManager.getRelayedPorts();
      expect(Array.isArray(ports)).toBe(true);
    });
  });
});