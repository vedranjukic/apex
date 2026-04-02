import { createServer, connect, type Server, type Socket } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PortRelayConfig, RelayedPort } from '../shared/rpc-types';

interface ForwardEntry {
  server: Server;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sandboxId: string;
  connections: Set<Socket>;
  createdAt: number;
}

const DEFAULT_CONFIG: PortRelayConfig = {
  enabled: true,
  autoForwardNewPorts: true,
  portRange: {
    start: 8000,
    end: 9000
  },
  excludedPorts: []
};

export class PortRelayManager {
  private forwards = new Map<string, ForwardEntry>();
  private config: PortRelayConfig = DEFAULT_CONFIG;
  private configPath: string;
  private eventListeners: Array<(event: { type: 'config-updated' | 'ports-updated', data: any }) => void> = [];

  constructor(userDataPath: string) {
    this.configPath = path.join(userDataPath, 'port-relay-config.json');
    this.loadConfig();
  }

  // ── Configuration Management ───────────────────────────

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
        console.log('[port-relay] Config loaded:', this.config);
      } else {
        this.saveConfig();
        console.log('[port-relay] Using default config');
      }
    } catch (err) {
      console.warn('[port-relay] Failed to load config, using defaults:', err);
      this.config = DEFAULT_CONFIG;
    }
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('[port-relay] Config saved');
      this.emitEvent('config-updated', this.config);
    } catch (err) {
      console.error('[port-relay] Failed to save config:', err);
    }
  }

  getConfig(): PortRelayConfig {
    return { ...this.config };
  }

  setConfig(newConfig: PortRelayConfig): void {
    const prevEnabled = this.config.enabled;
    this.config = { ...newConfig };
    this.saveConfig();
    
    // If disabled, stop all forwards
    if (!this.config.enabled && prevEnabled) {
      this.stopAllForwards();
    }
  }

  // ── Port Management Utilities ───────────────────────────

  private forwardKey(sandboxId: string, remotePort: number): string {
    return `${sandboxId}:${remotePort}`;
  }

  private async isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => {
        srv.close(() => resolve(true));
      });
    });
  }

  private async findFreePort(preferredPort?: number): Promise<number> {
    // If a specific port is requested, try it first
    if (preferredPort && await this.isPortFree(preferredPort)) {
      return preferredPort;
    }

    // Otherwise, find a port in the configured range
    const { start, end } = this.config.portRange;
    
    for (let port = start; port <= end; port++) {
      if (this.config.excludedPorts.includes(port)) continue;
      if (await this.isPortFree(port)) {
        return port;
      }
    }
    
    throw new Error(`No free port found in range ${start}-${end}`);
  }

  // ── Port Forwarding ─────────────────────────────────────

  async forwardPort(sandboxId: string, remoteHost: string, remotePort: number, localPort?: number): Promise<number> {
    if (!this.config.enabled) {
      throw new Error('Port relay is disabled');
    }

    const key = this.forwardKey(sandboxId, remotePort);

    // Return existing forward if it exists
    const existing = this.forwards.get(key);
    if (existing) {
      return existing.localPort;
    }

    const assignedLocalPort = await this.findFreePort(localPort);
    const connections = new Set<Socket>();

    const server = createServer((clientSocket) => {
      connections.add(clientSocket);

      const upstream = connect(remotePort, remoteHost, () => {
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });

      upstream.on('error', (err) => {
        console.warn(`[port-relay] Upstream error for ${key}:`, err);
        clientSocket.destroy();
      });

      clientSocket.on('error', (err) => {
        console.warn(`[port-relay] Client error for ${key}:`, err);
        upstream.destroy();
      });

      const cleanup = () => {
        connections.delete(clientSocket);
        upstream.destroy();
        clientSocket.destroy();
      };

      clientSocket.on('close', cleanup);
      upstream.on('close', cleanup);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(assignedLocalPort, '127.0.0.1', () => resolve());
    });

    const entry: ForwardEntry = {
      server,
      localPort: assignedLocalPort,
      remoteHost,
      remotePort,
      sandboxId,
      connections,
      createdAt: Date.now()
    };

    this.forwards.set(key, entry);
    console.log(`[port-relay] Forward created: ${sandboxId.slice(0, 12)}:${remotePort} → localhost:${assignedLocalPort}`);
    
    this.emitPortsUpdate();
    return assignedLocalPort;
  }

  unforwardPort(sandboxId: string, remotePort: number): boolean {
    const key = this.forwardKey(sandboxId, remotePort);
    const entry = this.forwards.get(key);
    if (!entry) return false;

    // Close all connections
    for (const conn of entry.connections) {
      conn.destroy();
    }

    // Close server
    entry.server.close();
    this.forwards.delete(key);

    console.log(`[port-relay] Forward stopped: ${sandboxId.slice(0, 12)}:${remotePort} (was localhost:${entry.localPort})`);
    this.emitPortsUpdate();
    return true;
  }

  unforwardAllForSandbox(sandboxId: string): number {
    let count = 0;
    const toDelete: string[] = [];

    for (const [key, entry] of this.forwards) {
      if (entry.sandboxId === sandboxId) {
        for (const conn of entry.connections) {
          conn.destroy();
        }
        entry.server.close();
        toDelete.push(key);
        count++;
      }
    }

    for (const key of toDelete) {
      this.forwards.delete(key);
    }

    if (count > 0) {
      console.log(`[port-relay] Stopped ${count} forwards for sandbox ${sandboxId.slice(0, 12)}`);
      this.emitPortsUpdate();
    }

    return count;
  }

  private stopAllForwards(): void {
    const count = this.forwards.size;
    for (const [, entry] of this.forwards) {
      for (const conn of entry.connections) {
        conn.destroy();
      }
      entry.server.close();
    }
    this.forwards.clear();
    
    if (count > 0) {
      console.log(`[port-relay] Stopped all ${count} forwards`);
      this.emitPortsUpdate();
    }
  }

  // ── Auto-forwarding for new ports ──────────────────────

  async handleNewPorts(sandboxId: string, remoteHost: string, ports: Array<{ port: number, protocol: string }>): Promise<void> {
    if (!this.config.enabled || !this.config.autoForwardNewPorts) {
      return;
    }

    const tcpPorts = ports.filter(p => p.protocol === 'tcp').map(p => p.port);
    const existingForwards = new Set();
    
    for (const [key, entry] of this.forwards) {
      if (entry.sandboxId === sandboxId) {
        existingForwards.add(entry.remotePort);
      }
    }

    const newPorts = tcpPorts.filter(port => 
      !existingForwards.has(port) && 
      !this.config.excludedPorts.includes(port)
    );

    if (newPorts.length === 0) return;

    console.log(`[port-relay] Auto-forwarding ${newPorts.length} new ports for ${sandboxId.slice(0, 12)}:`, newPorts);

    // Forward new ports in parallel
    const results = await Promise.allSettled(
      newPorts.map(port => 
        this.forwardPort(sandboxId, remoteHost, port).catch(err => {
          console.warn(`[port-relay] Failed to auto-forward port ${port}:`, err);
          return null;
        })
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    if (successful > 0) {
      console.log(`[port-relay] Successfully auto-forwarded ${successful}/${newPorts.length} ports`);
    }
  }

  // ── Status and Information ──────────────────────────────

  getRelayedPorts(sandboxId?: string): RelayedPort[] {
    const ports: RelayedPort[] = [];
    
    for (const entry of this.forwards.values()) {
      if (sandboxId && entry.sandboxId !== sandboxId) continue;
      
      ports.push({
        remotePort: entry.remotePort,
        localPort: entry.localPort,
        sandboxId: entry.sandboxId,
        status: 'active',
        createdAt: entry.createdAt
      });
    }

    return ports.sort((a, b) => a.remotePort - b.remotePort);
  }

  // ── Event System ────────────────────────────────────────

  addEventListener(callback: (event: { type: 'config-updated' | 'ports-updated', data: any }) => void): void {
    this.eventListeners.push(callback);
  }

  removeEventListener(callback: (event: { type: 'config-updated' | 'ports-updated', data: any }) => void): void {
    const index = this.eventListeners.indexOf(callback);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emitEvent(type: 'config-updated' | 'ports-updated', data: any): void {
    const event = { type, data };
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[port-relay] Event listener error:', err);
      }
    }
  }

  private emitPortsUpdate(): void {
    // Emit updates for each sandbox
    const sandboxPorts = new Map<string, RelayedPort[]>();
    
    for (const port of this.getRelayedPorts()) {
      const ports = sandboxPorts.get(port.sandboxId) || [];
      ports.push(port);
      sandboxPorts.set(port.sandboxId, ports);
    }
    
    this.emitEvent('ports-updated', { sandboxPorts });
  }

  // ── Cleanup ─────────────────────────────────────────────

  destroy(): void {
    console.log('[port-relay] Shutting down...');
    this.stopAllForwards();
    this.eventListeners.splice(0);
  }
}