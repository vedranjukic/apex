import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'net';
import {
  forwardPort,
  forwardPortWithRange,
  unforwardPort,
  unforwardAll,
  autoForwardPorts,
  getPortStatus,
  listForwards,
  cleanup,
  setConfig,
  getConfig,
  type PortInfo,
} from './port-forwarder.js';

function createEchoServer(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.pipe(socket);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not get port')));
      }
    });
  });
}

describe('port-forwarder', () => {
  let echoServer: Server;
  let echoPort: number;

  beforeEach(async () => {
    cleanup();
    echoPort = await getFreePort();
    echoServer = await createEchoServer(echoPort);
  });

  afterEach(() => {
    cleanup();
    echoServer?.close();
  });

  describe('forwardPort', () => {
    it('should forward a port and return a local port', async () => {
      const localPort = await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      expect(localPort).toBeGreaterThan(0);
      expect(localPort).toBeLessThanOrEqual(65535);
    });

    it('should return the existing local port for a duplicate forward', async () => {
      const port1 = await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      const port2 = await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      expect(port1).toBe(port2);
    });

    it('should forward different remote ports to different local ports', async () => {
      const echoPort2 = await getFreePort();
      const echo2 = await createEchoServer(echoPort2);

      const local1 = await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      const local2 = await forwardPort('sandbox-1', '127.0.0.1', echoPort2);
      expect(local1).not.toBe(local2);

      echo2.close();
    });
  });

  describe('forwardPortWithRange', () => {
    it('should use the preferred local port if free', async () => {
      const preferred = await getFreePort();
      setConfig({ excludedPorts: [] });
      const local = await forwardPortWithRange('sandbox-1', '127.0.0.1', echoPort, preferred);
      expect(local).toBe(preferred);
    });

    it('should fall back to the range if preferred port is taken', async () => {
      const blockServer = await createEchoServer(0);
      const blockedPort = (blockServer.address() as any).port;

      setConfig({ portRange: { start: 10000, end: 10100 }, excludedPorts: [] });
      const local = await forwardPortWithRange('sandbox-1', '127.0.0.1', echoPort, blockedPort);
      expect(local).toBeGreaterThanOrEqual(10000);
      expect(local).toBeLessThanOrEqual(10100);

      blockServer.close();
    });
  });

  describe('unforwardPort', () => {
    it('should stop a forwarded port', async () => {
      await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      const stopped = unforwardPort('sandbox-1', echoPort);
      expect(stopped).toBe(true);

      const statuses = getPortStatus('sandbox-1');
      expect(statuses).toHaveLength(0);
    });

    it('should return false for a non-existent forward', () => {
      const stopped = unforwardPort('sandbox-1', 99999);
      expect(stopped).toBe(false);
    });
  });

  describe('unforwardAll', () => {
    it('should stop all forwards for a sandbox', async () => {
      const echoPort2 = await getFreePort();
      const echo2 = await createEchoServer(echoPort2);

      await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      await forwardPort('sandbox-1', '127.0.0.1', echoPort2);

      const count = unforwardAll('sandbox-1');
      expect(count).toBe(2);
      expect(getPortStatus('sandbox-1')).toHaveLength(0);

      echo2.close();
    });

    it('should not affect other sandboxes', async () => {
      const echoPort2 = await getFreePort();
      const echo2 = await createEchoServer(echoPort2);

      await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      await forwardPort('sandbox-2', '127.0.0.1', echoPort2);

      unforwardAll('sandbox-1');
      expect(getPortStatus('sandbox-1')).toHaveLength(0);
      expect(getPortStatus('sandbox-2')).toHaveLength(1);

      echo2.close();
    });
  });

  describe('autoForwardPorts', () => {
    it('should forward multiple ports in batch', async () => {
      const echoPort2 = await getFreePort();
      const echo2 = await createEchoServer(echoPort2);

      const ports: PortInfo[] = [
        { port: echoPort, protocol: 'tcp' },
        { port: echoPort2, protocol: 'tcp' },
      ];

      const results = await autoForwardPorts('sandbox-1', '127.0.0.1', ports);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.localPort !== undefined)).toBe(true);

      echo2.close();
    });

    it('should skip non-TCP ports', async () => {
      const ports: PortInfo[] = [
        { port: echoPort, protocol: 'tcp' },
        { port: 5555, protocol: 'udp' },
      ];

      const results = await autoForwardPorts('sandbox-1', '127.0.0.1', ports);
      expect(results).toHaveLength(1);
    });

    it('should skip excluded ports', async () => {
      setConfig({ excludedPorts: [echoPort] });

      const ports: PortInfo[] = [{ port: echoPort, protocol: 'tcp' }];
      const results = await autoForwardPorts('sandbox-1', '127.0.0.1', ports);
      expect(results).toHaveLength(0);
    });

    it('should skip already-forwarded ports', async () => {
      await forwardPort('sandbox-1', '127.0.0.1', echoPort);

      const ports: PortInfo[] = [{ port: echoPort, protocol: 'tcp' }];
      const results = await autoForwardPorts('sandbox-1', '127.0.0.1', ports);
      expect(results).toHaveLength(0);
    });
  });

  describe('getPortStatus', () => {
    it('should return status of all forwards', async () => {
      await forwardPort('sandbox-1', '127.0.0.1', echoPort);

      const statuses = getPortStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({
        remotePort: echoPort,
        sandboxId: 'sandbox-1',
        status: 'active',
        connectionCount: 0,
      });
      expect(statuses[0].localPort).toBeGreaterThan(0);
    });

    it('should filter by sandboxId', async () => {
      const echoPort2 = await getFreePort();
      const echo2 = await createEchoServer(echoPort2);

      await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      await forwardPort('sandbox-2', '127.0.0.1', echoPort2);

      expect(getPortStatus('sandbox-1')).toHaveLength(1);
      expect(getPortStatus('sandbox-2')).toHaveLength(1);

      echo2.close();
    });
  });

  describe('listForwards', () => {
    it('should list active forwards', async () => {
      await forwardPort('sandbox-1', '127.0.0.1', echoPort);

      const forwards = listForwards('sandbox-1');
      expect(forwards).toHaveLength(1);
      expect(forwards[0].remotePort).toBe(echoPort);
    });
  });

  describe('configuration', () => {
    it('should update and return config', () => {
      setConfig({ portRange: { start: 9000, end: 9500 } });
      const cfg = getConfig();
      expect(cfg.portRange.start).toBe(9000);
      expect(cfg.portRange.end).toBe(9500);
    });
  });

  describe('cleanup', () => {
    it('should remove all forwards', async () => {
      await forwardPort('sandbox-1', '127.0.0.1', echoPort);
      cleanup();
      expect(getPortStatus()).toHaveLength(0);
    });
  });
});
