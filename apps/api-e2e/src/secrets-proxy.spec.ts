/**
 * E2E test: secrets CRUD + MITM proxy.
 *
 * Tests the full secrets lifecycle:
 *   1. CRUD operations on /api/secrets
 *   2. MITM proxy intercepts CONNECT to secret domains and injects auth
 *   3. Transparent tunnel for non-secret domains
 *
 * Requires a running API server (proxy starts on port 6001 by default).
 * No sandbox or cloud keys needed — tests the proxy directly.
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=secrets-proxy
 */
import axios from 'axios';
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const proxyPort = process.env.SECRETS_PROXY_PORT ?? '6001';
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
    req.setTimeout(5000, () => {
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
 */
function sendHttpRequest(
  socket: net.Socket | tls.TLSSocket,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ statusCode: number; headers: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lines = [
      `${method} ${path} HTTP/1.1`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      'Connection: close',
      '',
      '',
    ];
    socket.write(lines.join('\r\n'));

    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf-8');
      const headerEnd = data.indexOf('\r\n\r\n');
      const headerStr = headerEnd > 0 ? data.substring(0, headerEnd) : data;
      let body = headerEnd > 0 ? data.substring(headerEnd + 4) : '';
      const statusMatch = headerStr.match(/^HTTP\/\d\.\d (\d+)/);

      // Decode chunked transfer encoding if present
      if (headerStr.toLowerCase().includes('transfer-encoding: chunked')) {
        body = decodeChunked(body);
      }

      resolve({
        statusCode: statusMatch ? parseInt(statusMatch[1], 10) : 0,
        headers: headerStr,
        body,
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

// ── Tests ────────────────────────────────────────────

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
    // Value should be masked in response
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
    // list endpoint strips value entirely
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
    const created = await createSecret({
      name: 'HTTPBIN_KEY',
      value: testSecret,
      domain: testDomain,
      authType: 'bearer',
      description: 'E2E proxy test',
    });
    secretId = created.id;
    // Small delay for the DB write to propagate
    await new Promise((r) => setTimeout(r, 200));
  });

  afterAll(async () => {
    if (secretId) await deleteSecret(secretId);
  });

  it('should MITM a CONNECT to a secret domain', async () => {
    const socket = await proxyConnect(testDomain, 443);
    expect(socket).toBeDefined();
    expect(socket.writable).toBe(true);

    // Perform TLS handshake — the proxy presents a dynamic cert
    // signed by its CA. We don't validate the CA here (rejectUnauthorized=false).
    const tlsSocket = await tlsHandshake(socket, testDomain, false);
    expect(tlsSocket.encrypted).toBe(true);

    // The cert should be issued for the target domain
    const cert = tlsSocket.getPeerCertificate();
    expect(cert.subject?.CN).toBe(testDomain);

    // The issuer should be the Apex proxy CA
    expect(cert.issuer?.O).toBe('Apex');

    tlsSocket.destroy();
  });

  it('should inject auth header into intercepted request', async () => {
    const socket = await proxyConnect(testDomain, 443);
    const tlsSocket = await tlsHandshake(socket, testDomain, false);

    // Send a GET to httpbin.org/headers — it echoes back request headers
    const response = await sendHttpRequest(tlsSocket, 'GET', '/headers', {
      Host: testDomain,
      Accept: 'application/json',
    });

    // httpbin.org/headers returns the received headers as JSON
    // The proxy should have injected Authorization: Bearer <secret>
    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);
    const authHeader = bodyJson.headers?.Authorization || bodyJson.headers?.authorization;
    expect(authHeader).toBe(`Bearer ${testSecret}`);

    tlsSocket.destroy();
  });

  it('should tunnel non-secret domains transparently', async () => {
    // example.com has no secret configured — proxy should tunnel without MITM
    const socket = await proxyConnect('example.com', 443);
    expect(socket).toBeDefined();
    expect(socket.writable).toBe(true);

    // TLS handshake should use example.com's real certificate
    const tlsSocket = await tlsHandshake(socket, 'example.com', false);
    expect(tlsSocket.encrypted).toBe(true);

    const cert = tlsSocket.getPeerCertificate();
    // Should NOT be issued by Apex CA (it's the real cert)
    expect(cert.issuer?.O).not.toBe('Apex');

    tlsSocket.destroy();
  });
});

describe('Secrets Proxy — Auth Types', () => {
  const secrets: string[] = [];

  afterAll(async () => {
    for (const id of secrets) {
      await deleteSecret(id);
    }
  });

  it('should inject x-api-key header', async () => {
    const created = await createSecret({
      name: 'XAPI_KEY',
      value: 'xapi-test-value',
      domain: 'httpbin.org',
      authType: 'x-api-key',
    });
    secrets.push(created.id);
    // Need to wait and re-use the same domain, but domain is unique per secret
    // For this test, we'll clean up the previous bearer secret first
    // Actually httpbin.org already has a bearer secret from the previous describe block
    // which is cleaned up in afterAll. Let's use a workaround: the proxy picks the
    // first match. Since the bearer secret may still be active, let's skip this
    // and test the auth type building logic via a unit-style check.

    // We can verify by checking the proxy handles x-api-key type correctly
    // by creating a secret for a unique sub-test domain
    await deleteSecret(created.id);
    secrets.pop();

    const created2 = await createSecret({
      name: 'XAPI_KEY',
      value: 'xapi-test-value',
      domain: 'httpbin.org',
      authType: 'x-api-key',
    });
    secrets.push(created2.id);
    await new Promise((r) => setTimeout(r, 200));

    const socket = await proxyConnect('httpbin.org', 443);
    const tlsSocket = await tlsHandshake(socket, 'httpbin.org', false);

    const response = await sendHttpRequest(tlsSocket, 'GET', '/headers', {
      Host: 'httpbin.org',
      Accept: 'application/json',
    });

    expect(response.statusCode).toBe(200);
    const bodyJson = JSON.parse(response.body);
    const xApiKey = bodyJson.headers?.['X-Api-Key'] || bodyJson.headers?.['x-api-key'];
    expect(xApiKey).toBe('xapi-test-value');

    tlsSocket.destroy();
  });
});

describe('CA Certificate', () => {
  it('should have generated and persisted a CA cert', async () => {
    const res = await axios.get('/api/settings');
    expect(res.status).toBe(200);

    // CA cert and key should be stored (values are masked)
    const caCert = res.data.PROXY_CA_CERT;
    expect(caCert).toBeDefined();
    expect(caCert.value).toBeTruthy();
    expect(caCert.source).toBe('settings');
  });
});
