import { createServer, connect, type Server, type Socket } from 'net';

export interface ForwardEntry {
  server: Server;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sandboxId: string;
  connections: Set<Socket>;
  createdAt: number;
  status: 'active' | 'failed' | 'stopped';
  error?: string;
  healthCheckInterval?: NodeJS.Timeout;
}

export interface PortForwarderConfig {
  portRange: {
    start: number;
    end: number;
  };
  excludedPorts: number[];
  enableHealthChecks: boolean;
  healthCheckInterval: number; // milliseconds
  maxRetries: number;
  retryDelay: number; // milliseconds
}

export interface PortInfo {
  port: number;
  protocol: string;
  isActive?: boolean;
}

export interface PortStatus {
  remotePort: number;
  localPort: number;
  sandboxId: string;
  status: 'active' | 'failed' | 'stopped';
  error?: string;
  createdAt: number;
  connectionCount: number;
  lastHealthCheck?: number;
}

const DEFAULT_CONFIG: PortForwarderConfig = {
  portRange: {
    start: 8000,
    end: 9000
  },
  excludedPorts: [8080, 8443, 8888], // Common development ports to avoid
  enableHealthChecks: true,
  healthCheckInterval: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000 // 1 second
};

const forwards = new Map<string, ForwardEntry>();
let config = { ...DEFAULT_CONFIG };

function forwardKey(sandboxId: string, remotePort: number): string {
  return `${sandboxId}:${remotePort}`;
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort: number, maxAttempts = 100): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (port > 65535) break;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found starting from ${startPort}`);
}

/**
 * Enhanced port allocation with range and exclusion support
 */
async function findFreePortInRange(preferredPort?: number): Promise<number> {
  // If a specific port is requested, try it first
  if (preferredPort && !config.excludedPorts.includes(preferredPort)) {
    if (await isPortFree(preferredPort)) {
      return preferredPort;
    }
  }

  // Search within the configured range
  const { start, end } = config.portRange;
  
  for (let port = start; port <= end; port++) {
    if (config.excludedPorts.includes(port)) continue;
    if (await isPortFree(port)) {
      return port;
    }
  }
  
  throw new Error(`No free port found in range ${start}-${end}`);
}

/**
 * Health check for active port forwards
 */
async function performHealthCheck(entry: ForwardEntry): Promise<boolean> {
  return new Promise((resolve) => {
    const testSocket = connect(entry.remotePort, entry.remoteHost);
    
    const timeout = setTimeout(() => {
      testSocket.destroy();
      resolve(false);
    }, 5000); // 5 second timeout
    
    testSocket.on('connect', () => {
      clearTimeout(timeout);
      testSocket.end();
      resolve(true);
    });
    
    testSocket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Update port forwarding configuration
 */
export function setConfig(newConfig: Partial<PortForwarderConfig>): void {
  config = { ...config, ...newConfig };
  console.log(`[port-forward] Configuration updated:`, config);
}

/**
 * Forward a local port to a remote host:port with enhanced conflict resolution.
 * Returns the local port that was bound.
 * If the port is already forwarded for this sandbox, returns the existing local port.
 */
export async function forwardPort(
  sandboxId: string,
  remoteHost: string,
  remotePort: number,
): Promise<number> {
  const key = forwardKey(sandboxId, remotePort);

  const existing = forwards.get(key);
  if (existing && existing.status === 'active') {
    return existing.localPort;
  }

  const localPort = await findFreePort(remotePort);
  return await createForward(sandboxId, remoteHost, remotePort, localPort);
}

/**
 * Forward a local port with preferred local port and range fallback.
 * Enhanced version with automatic conflict resolution.
 */
export async function forwardPortWithRange(
  sandboxId: string,
  remoteHost: string,
  remotePort: number,
  preferredLocalPort?: number,
): Promise<number> {
  const key = forwardKey(sandboxId, remotePort);

  const existing = forwards.get(key);
  if (existing && existing.status === 'active') {
    return existing.localPort;
  }

  const localPort = await findFreePortInRange(preferredLocalPort);
  return await createForward(sandboxId, remoteHost, remotePort, localPort);
}

/**
 * Core forward creation logic with enhanced error handling and monitoring
 */
async function createForward(
  sandboxId: string,
  remoteHost: string,
  remotePort: number,
  localPort: number,
): Promise<number> {
  const key = forwardKey(sandboxId, remotePort);
  const connections = new Set<Socket>();

  const server = createServer((clientSocket) => {
    connections.add(clientSocket);

    const upstream = connect(remotePort, remoteHost, () => {
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });

    upstream.on('error', (err) => {
      console.warn(`[port-forward] Upstream error for ${key}:`, err);
      clientSocket.destroy();
    });

    clientSocket.on('error', (err) => {
      console.warn(`[port-forward] Client error for ${key}:`, err);
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
    server.listen(localPort, '127.0.0.1', () => resolve());
  });

  const entry: ForwardEntry = {
    server,
    localPort,
    remoteHost,
    remotePort,
    sandboxId,
    connections,
    createdAt: Date.now(),
    status: 'active'
  };

  // Setup health monitoring if enabled
  if (config.enableHealthChecks) {
    entry.healthCheckInterval = setInterval(async () => {
      const isHealthy = await performHealthCheck(entry);
      if (!isHealthy && entry.status === 'active') {
        console.warn(`[port-forward] Health check failed for ${key}`);
        entry.status = 'failed';
        entry.error = 'Health check failed - remote service may be down';
      }
    }, config.healthCheckInterval);
  }

  forwards.set(key, entry);
  console.log(`[port-forward] ${sandboxId.slice(0, 12)}:${remotePort} → localhost:${localPort}`);

  return localPort;
}

/** Stop forwarding a specific port for a sandbox. */
export function unforwardPort(sandboxId: string, remotePort: number): boolean {
  const key = forwardKey(sandboxId, remotePort);
  const entry = forwards.get(key);
  if (!entry) return false;

  // Clear health check interval
  if (entry.healthCheckInterval) {
    clearInterval(entry.healthCheckInterval);
  }

  // Close all connections
  for (const conn of entry.connections) {
    conn.destroy();
  }

  // Close server
  entry.server.close();
  entry.status = 'stopped';
  forwards.delete(key);

  console.log(`[port-forward] Stopped ${sandboxId.slice(0, 12)}:${remotePort} (was localhost:${entry.localPort})`);
  return true;
}

/** Stop all port forwards for a sandbox. */
export function unforwardAll(sandboxId: string): number {
  let count = 0;
  const toDelete: string[] = [];

  for (const [key, entry] of forwards) {
    if (entry.sandboxId === sandboxId) {
      // Clear health check interval
      if (entry.healthCheckInterval) {
        clearInterval(entry.healthCheckInterval);
      }

      // Close all connections
      for (const conn of entry.connections) {
        conn.destroy();
      }

      // Close server
      entry.server.close();
      entry.status = 'stopped';
      toDelete.push(key);
      count++;
    }
  }

  for (const key of toDelete) {
    forwards.delete(key);
  }

  if (count > 0) {
    console.log(`[port-forward] Stopped ${count} forwards for sandbox ${sandboxId.slice(0, 12)}`);
  }

  return count;
}

/**
 * Auto-forward multiple ports for a sandbox with batch processing
 */
export async function autoForwardPorts(
  sandboxId: string,
  remoteHost: string,
  ports: PortInfo[],
): Promise<Array<{ remotePort: number; localPort?: number; error?: string }>> {
  console.log(`[port-forward] Auto-forwarding ${ports.length} ports for ${sandboxId.slice(0, 12)}`);

  // Filter for TCP ports only
  const tcpPorts = ports.filter(p => p.protocol === 'tcp');
  
  // Get existing forwards to avoid duplicates
  const existingForwards = new Set<number>();
  for (const entry of forwards.values()) {
    if (entry.sandboxId === sandboxId) {
      existingForwards.add(entry.remotePort);
    }
  }

  // Filter out already forwarded and excluded ports
  const newPorts = tcpPorts.filter(p => 
    !existingForwards.has(p.port) && 
    !config.excludedPorts.includes(p.port)
  );

  if (newPorts.length === 0) {
    return [];
  }

  console.log(`[port-forward] Forwarding ${newPorts.length} new ports:`, newPorts.map(p => p.port));

  // Forward ports in parallel with error handling
  const results = await Promise.allSettled(
    newPorts.map(async (portInfo) => {
      try {
        const localPort = await forwardPortWithRange(sandboxId, remoteHost, portInfo.port);
        return { remotePort: portInfo.port, localPort };
      } catch (error) {
        console.warn(`[port-forward] Failed to forward port ${portInfo.port}:`, error);
        return { 
          remotePort: portInfo.port, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    })
  );

  const processedResults = results.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return { remotePort: 0, error: result.reason?.message || 'Promise rejected' };
    }
  });

  const successful = processedResults.filter(r => r.localPort !== undefined).length;
  console.log(`[port-forward] Successfully forwarded ${successful}/${newPorts.length} ports`);

  return processedResults;
}

/**
 * Get detailed status of all port forwards
 */
export function getPortStatus(sandboxId?: string): PortStatus[] {
  const statuses: PortStatus[] = [];
  
  for (const entry of forwards.values()) {
    if (sandboxId && entry.sandboxId !== sandboxId) continue;
    
    statuses.push({
      remotePort: entry.remotePort,
      localPort: entry.localPort,
      sandboxId: entry.sandboxId,
      status: entry.status,
      error: entry.error,
      createdAt: entry.createdAt,
      connectionCount: entry.connections.size,
      lastHealthCheck: entry.healthCheckInterval ? Date.now() : undefined
    });
  }

  return statuses.sort((a, b) => a.remotePort - b.remotePort);
}

/** List all active forwards for a sandbox (backward compatibility). */
export function listForwards(sandboxId: string): Array<{ localPort: number; remotePort: number }> {
  return getPortStatus(sandboxId)
    .filter(status => status.status === 'active')
    .map(status => ({
      localPort: status.localPort,
      remotePort: status.remotePort
    }));
}

/**
 * Cleanup all forwards and clear intervals
 */
export function cleanup(): void {
  console.log('[port-forward] Cleaning up all forwards...');
  
  for (const [, entry] of forwards) {
    if (entry.healthCheckInterval) {
      clearInterval(entry.healthCheckInterval);
    }
    
    for (const conn of entry.connections) {
      conn.destroy();
    }
    
    entry.server.close();
  }
  
  forwards.clear();
  console.log('[port-forward] Cleanup completed');
}

/**
 * Get current configuration
 */
export function getConfig(): PortForwarderConfig {
  return { ...config };
}
