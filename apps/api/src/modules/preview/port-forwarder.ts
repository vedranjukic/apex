import { createServer, connect, type Server, type Socket } from 'net';

interface ForwardEntry {
  server: Server;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sandboxId: string;
  connections: Set<Socket>;
}

const forwards = new Map<string, ForwardEntry>();

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
 * Forward a local port to a remote host:port (typically a Docker container).
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
  if (existing) {
    return existing.localPort;
  }

  const localPort = await findFreePort(remotePort);

  const connections = new Set<Socket>();

  const server = createServer((clientSocket) => {
    connections.add(clientSocket);

    const upstream = connect(remotePort, remoteHost, () => {
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });

    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());

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

  forwards.set(key, { server, localPort, remoteHost, remotePort, sandboxId, connections });
  console.log(`[port-forward] ${sandboxId.slice(0, 12)}:${remotePort} → localhost:${localPort}`);

  return localPort;
}

/** Stop forwarding a specific port for a sandbox. */
export function unforwardPort(sandboxId: string, remotePort: number): void {
  const key = forwardKey(sandboxId, remotePort);
  const entry = forwards.get(key);
  if (!entry) return;

  for (const conn of entry.connections) conn.destroy();
  entry.server.close();
  forwards.delete(key);
  console.log(`[port-forward] Stopped ${sandboxId.slice(0, 12)}:${remotePort} (was localhost:${entry.localPort})`);
}

/** Stop all port forwards for a sandbox. */
export function unforwardAll(sandboxId: string): void {
  for (const [key, entry] of forwards) {
    if (entry.sandboxId === sandboxId) {
      for (const conn of entry.connections) conn.destroy();
      entry.server.close();
      forwards.delete(key);
    }
  }
}

/** List all active forwards for a sandbox. */
export function listForwards(sandboxId: string): Array<{ localPort: number; remotePort: number }> {
  const result: Array<{ localPort: number; remotePort: number }> = [];
  for (const entry of forwards.values()) {
    if (entry.sandboxId === sandboxId) {
      result.push({ localPort: entry.localPort, remotePort: entry.remotePort });
    }
  }
  return result;
}
