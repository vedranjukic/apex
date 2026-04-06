/**
 * E2E test: GitHub token propagation through the MITM proxy.
 *
 * Verifies that changing GITHUB_TOKEN in settings hot-reloads the Rust
 * MITM proxy so that subsequent requests to api.github.com use the new token.
 *
 * Flow:
 *   1. Set a bad token → CONNECT api.github.com → expect 401
 *   2. Set the valid token from GITHUB_TOKEN_E2E → expect 200
 *
 * Environment:
 *   GITHUB_TOKEN_E2E  — a valid GitHub PAT for testing
 *
 * Run: yarn test:github-token-e2e
 */
import axios from 'axios';
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const proxyPort = process.env.SECRETS_PROXY_PORT ?? '9350';

const VALID_TOKEN = process.env.GITHUB_TOKEN_E2E ?? '';
const hasToken = !!VALID_TOKEN;
const describeE2e = hasToken ? describe : describe.skip;

// ── Helpers (same pattern as secrets-proxy.spec.ts) ──

function proxyConnect(targetHost: string, targetPort = 443): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port: Number(proxyPort),
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
    });

    req.on('connect', (_res, socket) => {
      resolve(socket);
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('CONNECT timeout'));
    });

    req.end();
  });
}

function tlsHandshake(
  socket: net.Socket,
  servername: string,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect(
      { socket, servername, rejectUnauthorized: false },
      () => resolve(tlsSocket),
    );
    tlsSocket.on('error', reject);
  });
}

function sendHttpRequest(
  socket: net.Socket | tls.TLSSocket,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headerLines = [
      `${method} ${path} HTTP/1.1`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      'Connection: close',
      '',
      '',
    ];
    socket.write(headerLines.join('\r\n'));

    const chunks: Buffer[] = [];
    socket.on('data', (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    socket.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf-8');
      const headerEnd = data.indexOf('\r\n\r\n');
      const headerStr = headerEnd > 0 ? data.substring(0, headerEnd) : data;
      const responseBody = headerEnd > 0 ? data.substring(headerEnd + 4) : '';
      const statusMatch = headerStr.match(/^HTTP\/\d\.\d (\d+)/);
      resolve({
        statusCode: statusMatch ? parseInt(statusMatch[1], 10) : 0,
        body: responseBody,
      });
    });
    socket.on('error', reject);
    socket.setTimeout(15000, () => {
      socket.destroy(new Error('Response timeout'));
    });
  });
}

async function githubUserRequest(): Promise<{ statusCode: number; body: string }> {
  const socket = await proxyConnect('api.github.com', 443);
  const tlsSocket = await tlsHandshake(socket, 'api.github.com');
  try {
    return await sendHttpRequest(tlsSocket, 'GET', '/user', {
      Host: 'api.github.com',
      'User-Agent': 'apex-e2e-test',
      Accept: 'application/vnd.github+json',
    });
  } finally {
    tlsSocket.destroy();
  }
}

async function setGitHubToken(token: string): Promise<void> {
  await axios.put('/api/settings', { GITHUB_TOKEN: token });
  // Wait for debounced proxy reload (200ms debounce + round-trip)
  await new Promise((r) => setTimeout(r, 600));
}

async function getOriginalToken(): Promise<string | null> {
  const res = await axios.get('/api/settings');
  const entry = res.data?.GITHUB_TOKEN;
  if (!entry || !entry.value || entry.source === 'none') return null;
  return entry.value;
}

// ── Tests ────────────────────────────────────────────

describeE2e('GitHub token propagation via MITM proxy', () => {
  let originalTokenMasked: string | null = null;

  beforeAll(async () => {
    originalTokenMasked = await getOriginalToken();

    // Verify the MITM proxy is reachable
    await new Promise<void>((resolve, reject) => {
      const sock = net.connect(Number(proxyPort), host, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', (err: Error) =>
        reject(
          new Error(
            `MITM proxy not reachable on ${host}:${proxyPort}: ${err.message}`,
          ),
        ),
      );
      sock.setTimeout(5000, () => {
        sock.destroy();
        reject(new Error('Proxy connect timeout'));
      });
    });
  }, 15_000);

  afterAll(async () => {
    // Restore: set the valid token back so we don't leave the system broken
    await setGitHubToken(VALID_TOKEN);
  }, 10_000);

  it('should fail GitHub auth with an invalid token', async () => {
    await setGitHubToken('ghp_invalid_e2e_token_000000000000000000');

    const res = await githubUserRequest();
    expect(res.statusCode).toBe(401);
  }, 20_000);

  it('should succeed after setting a valid token', async () => {
    await setGitHubToken(VALID_TOKEN);

    const res = await githubUserRequest();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"login"');
  }, 20_000);
});
