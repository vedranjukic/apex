/**
 * E2E test: secrets CRUD + MITM proxy (host-side).
 *
 * Tests the full secrets lifecycle:
 *   1. CRUD operations on /api/secrets
 *   2. MITM proxy intercepts CONNECT to secret domains and injects auth
 *   3. Transparent tunnel for non-secret domains
 *   4. All auth types (bearer, x-api-key, basic, custom header)
 *   5. POST body forwarding, large responses, concurrency
 *
 * Requires a running API server (proxy starts on port 9350 by default).
 * No sandbox or cloud keys needed — tests the proxy directly.
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=secrets-proxy.spec
 */
import axios from 'axios';
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const proxyPort = process.env.SECRETS_PROXY_PORT ?? '9350';
const proxyHost = `${host}:${proxyPort}`;

// ── Helpers ──────────────────────────────────────────

async function createSecret(data: {
  name: string;
  value: string;
  domain: string;
  authType?: string;
  description?: string;
}): Promise<any> {
  const res = await axios.post('/api/secrets', data);
  expect([200, 201]).toContain(res.status);
  return res.data;
}

async function deleteSecret(id: string): Promise<void> {
  try {
    await axios.delete(`/api/secrets/${id}`);
  } catch {
    // ignore if already deleted
  }
}

/**
 * Delete ALL secrets for a given domain. The proxy uses `findByDomain`
 * which returns the first match, so stale rows from previous runs
 * interfere with tests. Call this before creating a fresh secret.
 */
async function deleteSecretsForDomain(domain: string): Promise<void> {
  const res = await axios.get('/api/secrets');
  for (const s of res.data) {
    if (s.domain === domain) {
      await deleteSecret(s.id);
    }
  }
}

/**
 * Send a CONNECT request through the proxy and return the raw socket.
 * This simulates what an HTTP client does when HTTPS_PROXY is set.
 */
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

/**
 * Perform a TLS handshake over an existing socket (as a client).
 * Used to test the MITM flow — the proxy presents a dynamic cert.
 */
function tlsHandshake(
  socket: net.Socket,
  servername: string,
  rejectUnauthorized = false,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect(
      { socket, servername, rejectUnauthorized },
      () => resolve(tlsSocket),
    );
    tlsSocket.on('error', reject);
  });
}

/**
 * Send a raw HTTP request over a socket and collect the full response.
 * Handles both Content-Length and chunked transfer encoding.
 * Supports an optional request body for POST/PUT requests.
 */
function sendHttpRequest(
  socket: net.Socket | tls.TLSSocket,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ statusCode: number; headers: string; body: string; rawBytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const headerLines = [
      `${method} ${path} HTTP/1.1`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    ];

    if (body) {
      headerLines.push(`Content-Length: ${Buffer.byteLength(body)}`);
    }
    headerLines.push('Connection: close', '', '');
    socket.write(headerLines.join('\r\n'));
    if (body) {
      socket.write(body);
    }

    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('end', () => {
      const rawBytes = Buffer.concat(chunks);
      const data = rawBytes.toString('utf-8');
      const headerEnd = data.indexOf('\r\n\r\n');
      const headerStr = headerEnd > 0 ? data.substring(0, headerEnd) : data;
      let responseBody = headerEnd > 0 ? data.substring(headerEnd + 4) : '';
      const statusMatch = headerStr.match(/^HTTP\/\d\.\d (\d+)/);

      if (headerStr.toLowerCase().includes('transfer-encoding: chunked')) {
        responseBody = decodeChunked(responseBody);
      }

      resolve({
        statusCode: statusMatch ? parseInt(statusMatch[1], 10) : 0,
        headers: headerStr,
        body: responseBody,
        rawBytes: headerEnd > 0 ? rawBytes.subarray(headerEnd + 4) : Buffer.alloc(0),
      });
    });
    socket.on('error', reject);
    socket.setTimeout(15000, () => {
      socket.destroy(new Error('Response timeout'));
    });
  });
}

/** Decode HTTP chunked transfer encoding. */
function decodeChunked(raw: string): string {
  let result = '';
  let pos = 0;
  while (pos < raw.length) {
    const lineEnd = raw.indexOf('\r\n', pos);
    if (lineEnd === -1) break;
    const sizeStr = raw.substring(pos, lineEnd).trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size) || size === 0) break;
    const chunkStart = lineEnd + 2;
    result += raw.substring(chunkStart, chunkStart + size);
    pos = chunkStart + size + 2;
  }
  return result;
}

/**
 * CONNECT + TLS + send HTTP request in one call.
 * Returns the parsed response. Cleans up the socket automatically.
 */
async function connectAndRequest(
  domain: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ statusCode: number; headers: string; body: string; rawBytes: Buffer }> {
  const socket = await proxyConnect(domain, 443);
  const tlsSocket = await tlsHandshake(socket, domain, false);
  try {
    return await sendHttpRequest(tlsSocket, method, path, { Host: domain, ...headers }, body);
  } finally {
    tlsSocket.destroy();
  }
}

// ── Tests ────────────────────────────────────────────

// Clean up stale test secrets and verify the proxy is alive.
beforeAll(async () => {
  await deleteSecretsForDomain('httpbin.org');
  await deleteSecretsForDomain('nonexistent.invalid');
  await new Promise((r) => setTimeout(r, 1000));

  // Verify the MITM proxy is accepting TCP connections
  const net = require('net') as typeof import('net');
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(Number(proxyPort), host, () => {
      sock.destroy();
      resolve();
    });
    sock.on('error', (err: Error) => reject(new Error(
      `MITM proxy not reachable on ${proxyHost}: ${err.message}. ` +
        'Ensure the API server started the Rust proxy successfully.',
    )));
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error('Proxy connect timeout')); });
  });
}, 15_000);

describe('Secrets CRUD API', () => {
  let createdId: string;

  afterAll(async () => {
    if (createdId) await deleteSecret(createdId);
  });

  it('should create a secret', async () => {
    const res = await axios.post('/api/secrets', {
      name: 'TEST_KEY',
      value: 'test-secret-value-123',
      domain: 'httpbin.org',
      authType: 'bearer',
      description: 'E2E test secret',
    });
    expect(res.status).toBe(200);
    expect(res.data.id).toBeDefined();
    expect(res.data.name).toBe('TEST_KEY');
    expect(res.data.domain).toBe('httpbin.org');
    expect(res.data.value).not.toBe('test-secret-value-123');
    expect(res.data.value).toContain('••••');
    createdId = res.data.id;
  });

  it('should list secrets without values', async () => {
    const res = await axios.get('/api/secrets');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);

    const found = res.data.find((s: any) => s.id === createdId);
    expect(found).toBeDefined();
    expect(found.name).toBe('TEST_KEY');
    expect(found.domain).toBe('httpbin.org');
    expect(found.value).toBeUndefined();
  });

  it('should update a secret', async () => {
    const res = await axios.put(`/api/secrets/${createdId}`, {
      description: 'Updated description',
    });
    expect(res.status).toBe(200);
    expect(res.data.description).toBe('Updated description');
  });

  it('should delete a secret', async () => {
    const res = await axios.delete(`/api/secrets/${createdId}`);
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    createdId = '';
  });

  it('should return 404 for missing secret', async () => {
    try {
      await axios.delete('/api/secrets/nonexistent-id');
      fail('Expected 404');
    } catch (err: any) {
      expect(err.response.status).toBe(404);
    }
  });
});

describe('Secrets MITM Proxy', () => {
  let secretId: string;
  const testDomain = 'httpbin.org';
  const testSecret = 'e2e-bearer-token-xyz';

  beforeAll(async () => {
    await deleteSecretsForDomain(testDomain);
    const created = await createSecret({
      name: 'HTTPBIN_KEY',
      value: testSecret,
      domain: testDomain,
      authType: 'bearer',
      description: 'E2E proxy test',
    });
    secretId = created.id;
    await new Promise((r) => setTimeout(r, 1000));
  });

  afterAll(async () => {
    if (secretId) await deleteSecret(secretId);
  });

  it('should MITM a CONNECT to a secret domain', async () => {
    const socket = await proxyConnect(testDomain, 443);
    expect(socket).toBeDefined();
    expect(socket.writable).toBe(true);

    const tlsSocket = await tlsHandshake(socket, testDomain, false);
    expect(tlsSocket.encrypted).toBe(true);

    const cert = tlsSocket.getPeerCertificate();
    expect(cert.subject?.CN).toBe(testDomain);
    expect(cert.issuer?.O).toBe('Apex');

    tlsSocket.destroy();
  });

  it('should inject auth header into intercepted request', async () => {
    const response = await connectAndRequest(testDomain, 'GET', '/headers', {
      Accept: 'application/json',
    });

    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);
    const authHeader = bodyJson.headers?.Authorization || bodyJson.headers?.authorization;
    expect(authHeader).toBe(`Bearer ${testSecret}`);
  });

  it('should tunnel non-secret domains transparently', async () => {
    const socket = await proxyConnect('example.com', 443);
    expect(socket).toBeDefined();
    expect(socket.writable).toBe(true);

    const tlsSocket = await tlsHandshake(socket, 'example.com', false);
    expect(tlsSocket.encrypted).toBe(true);

    const cert = tlsSocket.getPeerCertificate();
    expect(cert.issuer?.O).not.toBe('Apex');

    tlsSocket.destroy();
  });
});

describe('Secrets Proxy — Auth Types', () => {
  const secretIds: string[] = [];

  afterAll(async () => {
    for (const id of secretIds) {
      await deleteSecret(id);
    }
  });

  it('should inject x-api-key header', async () => {
    await deleteSecretsForDomain('httpbin.org');
    const created = await createSecret({
      name: 'XAPI_KEY',
      value: 'xapi-test-value',
      domain: 'httpbin.org',
      authType: 'x-api-key',
    });
    secretIds.push(created.id);
    await new Promise((r) => setTimeout(r, 1000));

    const response = await connectAndRequest('httpbin.org', 'GET', '/headers', {
      Accept: 'application/json',
    });

    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);
    const xApiKey = bodyJson.headers?.['X-Api-Key'] || bodyJson.headers?.['x-api-key'];
    expect(xApiKey).toBe('xapi-test-value');
  }, 30_000);

  it('should inject basic auth header', async () => {
    await deleteSecretsForDomain('httpbin.org');
    secretIds.length = 0;

    const created = await createSecret({
      name: 'BASIC_KEY',
      value: 'user:password123',
      domain: 'httpbin.org',
      authType: 'basic',
    });
    secretIds.push(created.id);
    await new Promise((r) => setTimeout(r, 1000));

    const response = await connectAndRequest('httpbin.org', 'GET', '/headers', {
      Accept: 'application/json',
    });

    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);
    const authHeader = bodyJson.headers?.Authorization || bodyJson.headers?.authorization;
    const expected = `Basic ${Buffer.from('user:password123').toString('base64')}`;
    expect(authHeader).toBe(expected);
  }, 30_000);

  it('should inject custom header', async () => {
    await deleteSecretsForDomain('httpbin.org');
    secretIds.length = 0;

    const created = await createSecret({
      name: 'CUSTOM_KEY',
      value: 'custom-secret-value',
      domain: 'httpbin.org',
      authType: 'header:X-Custom-Auth',
    });
    secretIds.push(created.id);
    await new Promise((r) => setTimeout(r, 1000));

    const response = await connectAndRequest('httpbin.org', 'GET', '/headers', {
      Accept: 'application/json',
    });

    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);
    const customHeader =
      bodyJson.headers?.['X-Custom-Auth'] || bodyJson.headers?.['x-custom-auth'];
    expect(customHeader).toBe('custom-secret-value');
  }, 30_000);
});

describe('Secrets Proxy — Request Body', () => {
  let secretId: string;

  beforeAll(async () => {
    await deleteSecretsForDomain('httpbin.org');
    const created = await createSecret({
      name: 'POST_KEY',
      value: 'post-bearer-token',
      domain: 'httpbin.org',
      authType: 'bearer',
    });
    secretId = created.id;
    await new Promise((r) => setTimeout(r, 1000));
  });

  afterAll(async () => {
    if (secretId) await deleteSecret(secretId);
  });

  it('should forward POST body through MITM', async () => {
    const requestBody = JSON.stringify({ message: 'hello', number: 42 });
    const response = await connectAndRequest(
      'httpbin.org',
      'POST',
      '/post',
      {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      requestBody,
    );

    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);

    // httpbin /post echoes the request body
    expect(bodyJson.data).toBe(requestBody);
    const parsed = JSON.parse(bodyJson.data);
    expect(parsed.message).toBe('hello');
    expect(parsed.number).toBe(42);

    // Auth should still be injected
    const authHeader = bodyJson.headers?.Authorization || bodyJson.headers?.authorization;
    expect(authHeader).toBe('Bearer post-bearer-token');
  }, 30_000);

  it('should handle large responses (64KB)', async () => {
    const response = await connectAndRequest('httpbin.org', 'GET', '/bytes/65536', {
      Accept: 'application/octet-stream',
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawBytes.length).toBeGreaterThanOrEqual(65536);
  }, 30_000);
});

describe('Secrets Proxy — Concurrency', () => {
  let secretId: string;
  const testSecret = 'concurrent-bearer-token';

  beforeAll(async () => {
    await deleteSecretsForDomain('httpbin.org');
    const created = await createSecret({
      name: 'CONCURRENT_KEY',
      value: testSecret,
      domain: 'httpbin.org',
      authType: 'bearer',
    });
    secretId = created.id;
    await new Promise((r) => setTimeout(r, 1000));
  });

  afterAll(async () => {
    if (secretId) await deleteSecret(secretId);
  });

  it('should handle 10 parallel CONNECT requests', async () => {
    const requests = Array.from({ length: 10 }, () =>
      connectAndRequest('httpbin.org', 'GET', '/headers', {
        Accept: 'application/json',
      }),
    );

    const results = await Promise.all(requests);

    for (const response of results) {
      expect(response.statusCode).toBe(200);
      const bodyJson = JSON.parse(response.body);
      const authHeader = bodyJson.headers?.Authorization || bodyJson.headers?.authorization;
      expect(authHeader).toBe(`Bearer ${testSecret}`);
    }
  }, 60_000);
});

describe('Secrets Proxy — Edge Cases', () => {
  const secretIds: string[] = [];

  afterAll(async () => {
    for (const id of secretIds) {
      await deleteSecret(id);
    }
  });

  it('should cache domain certificates across requests', async () => {
    await deleteSecretsForDomain('httpbin.org');
    secretIds.length = 0;
    const created = await createSecret({
      name: 'CERT_CACHE_KEY',
      value: 'cert-cache-token',
      domain: 'httpbin.org',
      authType: 'bearer',
    });
    secretIds.push(created.id);
    await new Promise((r) => setTimeout(r, 1000));

    const certs: tls.PeerCertificate[] = [];

    for (let i = 0; i < 3; i++) {
      const socket = await proxyConnect('httpbin.org', 443);
      const tlsSocket = await tlsHandshake(socket, 'httpbin.org', false);
      certs.push(tlsSocket.getPeerCertificate());
      tlsSocket.destroy();
    }

    // All certs should be from the Apex CA and for the same domain
    for (const cert of certs) {
      expect(cert.subject?.CN).toBe('httpbin.org');
      expect(cert.issuer?.O).toBe('Apex');
    }

    // Serial numbers should be identical (cached cert reused)
    expect(certs[0].serialNumber).toBe(certs[1].serialNumber);
    expect(certs[1].serialNumber).toBe(certs[2].serialNumber);
  }, 30_000);

  it('should propagate secret value updates', async () => {
    await deleteSecretsForDomain('httpbin.org');
    secretIds.length = 0;

    // Create with value A
    const created = await createSecret({
      name: 'UPDATE_KEY',
      value: 'value-A',
      domain: 'httpbin.org',
      authType: 'bearer',
    });
    secretIds.push(created.id);
    await new Promise((r) => setTimeout(r, 1000));

    const responseA = await connectAndRequest('httpbin.org', 'GET', '/headers', {
      Accept: 'application/json',
    });
    expect(responseA.statusCode).toBe(200);
    const jsonA = JSON.parse(responseA.body);
    expect(jsonA.headers?.Authorization || jsonA.headers?.authorization).toBe('Bearer value-A');

    // Update to value B
    await axios.put(`/api/secrets/${created.id}`, { value: 'value-B' });
    await new Promise((r) => setTimeout(r, 1000));

    const responseB = await connectAndRequest('httpbin.org', 'GET', '/headers', {
      Accept: 'application/json',
    });
    expect(responseB.statusCode).toBe(200);
    const jsonB = JSON.parse(responseB.body);
    expect(jsonB.headers?.Authorization || jsonB.headers?.authorization).toBe('Bearer value-B');
  }, 30_000);

  it('should handle unresolvable host gracefully', async () => {
    for (const id of secretIds) await deleteSecret(id);
    secretIds.length = 0;

    const created = await createSecret({
      name: 'BAD_HOST_KEY',
      value: 'bad-host-token',
      domain: 'nonexistent.invalid',
      authType: 'bearer',
    });
    secretIds.push(created.id);
    await new Promise((r) => setTimeout(r, 1000));

    const socket = await proxyConnect('nonexistent.invalid', 443);
    const tlsSocket = await tlsHandshake(socket, 'nonexistent.invalid', false);

    const response = await sendHttpRequest(tlsSocket, 'GET', '/', {
      Host: 'nonexistent.invalid',
    });

    // The proxy should return 502 because it can't connect upstream
    expect(response.statusCode).toBe(502);

    tlsSocket.destroy();
  }, 15_000);

  it('should proxy plain HTTP requests with auth injection', async () => {
    await deleteSecretsForDomain('httpbin.org');
    secretIds.length = 0;

    const created = await createSecret({
      name: 'PLAIN_HTTP_KEY',
      value: 'plain-http-token',
      domain: 'httpbin.org',
      authType: 'bearer',
    });
    secretIds.push(created.id);
    await new Promise((r) => setTimeout(r, 1000));

    // Send a plain HTTP proxy request (not CONNECT)
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host,
          port: Number(proxyPort),
          method: 'GET',
          path: 'http://httpbin.org/headers',
          headers: { Accept: 'application/json' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf-8'),
            });
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('timeout')));
      req.end();
    });

    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);
    const authHeader = bodyJson.headers?.Authorization || bodyJson.headers?.authorization;
    expect(authHeader).toBe('Bearer plain-http-token');
  }, 15_000);
});

describe('CA Certificate', () => {
  it('should have generated and persisted a CA cert', async () => {
    const res = await axios.get('/api/settings');
    expect(res.status).toBe(200);

    const caCert = res.data.PROXY_CA_CERT;
    expect(caCert).toBeDefined();
    expect(caCert.value).toBeTruthy();
    expect(caCert.source).toBe('settings');
  });
});
