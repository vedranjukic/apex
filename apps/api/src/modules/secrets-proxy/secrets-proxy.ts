/**
 * MITM Secrets Proxy
 *
 * A forward HTTP/HTTPS proxy that selectively man-in-the-middles connections
 * to domains associated with user-defined secrets.
 *
 * - For CONNECT to a secret domain: spins up a one-shot local TLS server,
 *   terminates TLS, injects auth headers, and forwards to the real upstream.
 * - For all other CONNECT targets: transparent TCP tunnel (no interception).
 * - Also handles plain HTTP proxy requests with the same auth injection.
 *
 * The MITM uses a local tls.Server per intercepted connection instead of
 * tls.TLSSocket wrapping, for broad Bun/Node compatibility.
 */

import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import { secretsService, type SecretRecord } from '../secrets/secrets.service';
import { settingsService } from '../settings/settings.service';
import { generateDomainCert } from './ca-manager';

const DEFAULT_PORT = 3001;

let server: http.Server | null = null;

function getProxyPort(): number {
  return Number(process.env['SECRETS_PROXY_PORT'] || DEFAULT_PORT);
}

const GITHUB_DOMAINS = new Set([
  'github.com',
  'api.github.com',
  // Additional GitHub domains that gh CLI might connect to
  'uploads.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'codeload.github.com',
  'ghcr.io',
  // GitHub Enterprise Cloud domains
  'github.enterprise.com',
  'api.github.enterprise.com'
]);

/**
 * Find a secret for the given domain. Checks user-defined secrets first,
 * then falls back to the GitHub token from settings for GitHub domains.
 */
async function findSecretForDomain(host: string): Promise<SecretRecord | null> {
  const secrets = await secretsService.findByDomain(host);
  if (secrets.length > 0) return secrets[0];

  if (GITHUB_DOMAINS.has(host)) {
    const token = await settingsService.get('GITHUB_TOKEN');
    if (token) {
      return {
        id: '_github_token',
        userId: '',
        projectId: null,
        name: 'GITHUB_TOKEN',
        value: token,
        domain: host,
        authType: 'bearer',
        description: null,
        createdAt: '',
        updatedAt: '',
      };
    }
  }

  return null;
}

/** Build the auth header for a secret based on its authType. */
function buildAuthHeader(secret: SecretRecord): { name: string; value: string } {
  const authType = secret.authType || 'bearer';

  if (authType === 'bearer') {
    return { name: 'authorization', value: `Bearer ${secret.value}` };
  }
  if (authType === 'x-api-key') {
    return { name: 'x-api-key', value: secret.value };
  }
  if (authType === 'basic') {
    const encoded = Buffer.from(secret.value).toString('base64');
    return { name: 'authorization', value: `Basic ${encoded}` };
  }
  if (authType.startsWith('header:')) {
    const headerName = authType.slice('header:'.length).trim();
    return { name: headerName.toLowerCase(), value: secret.value };
  }

  return { name: 'authorization', value: `Bearer ${secret.value}` };
}

/**
 * Forward a decrypted HTTP request to the real upstream via HTTPS,
 * injecting the auth header. Pipes the upstream response back to the caller.
 */
function forwardRequest(
  domain: string,
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer | null,
  secret: SecretRecord,
  clientSocket: net.Socket | tls.TLSSocket,
): void {
  const auth = buildAuthHeader(secret);

  const outHeaders: Record<string, string> = { ...headers };
  delete outHeaders['connection'];
  delete outHeaders['proxy-connection'];
  delete outHeaders['proxy-authorization'];
  outHeaders['host'] = domain;
  delete outHeaders['authorization'];
  delete outHeaders['x-api-key'];
  outHeaders[auth.name] = auth.value;

  const upstreamReq = https.request(
    { hostname: domain, port, method, path, headers: outHeaders, rejectUnauthorized: true },
    (upstreamRes) => {
      let head = `HTTP/${upstreamRes.httpVersion} ${upstreamRes.statusCode} ${upstreamRes.statusMessage || ''}\r\n`;
      const raw = upstreamRes.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) head += `${raw[i]}: ${raw[i + 1]}\r\n`;
      head += '\r\n';
      try {
        clientSocket.write(head);
        upstreamRes.pipe(clientSocket);
      } catch { upstreamRes.destroy(); }
    },
  );

  upstreamReq.on('error', (err) => {
    console.error(`[secrets-proxy] upstream error ${domain}: ${err.message}`);
    try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); clientSocket.end(); } catch { /* closed */ }
  });

  if (body && body.length > 0) upstreamReq.write(body);
  upstreamReq.end();
}

/**
 * Buffer data from a clear-text socket until full HTTP headers + body arrive,
 * then forward the request upstream with secret auth injected.
 */
function readAndForward(
  clearSocket: net.Socket,
  domain: string,
  port: number,
  secret: SecretRecord,
): void {
  let buf = Buffer.alloc(0);
  let headersDone = false;
  let method = '';
  let path = '';
  let headers: Record<string, string> = {};
  let contentLength = 0;
  let headerEndIdx = 0;

  const onData = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    if (!headersDone) {
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      headersDone = true;
      headerEndIdx = idx + 4;

      const hStr = buf.subarray(0, idx).toString('utf-8');
      const lines = hStr.split('\r\n');
      const [m, p] = (lines[0] || '').split(' ');
      method = m || 'GET';
      path = p || '/';

      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].indexOf(':');
        if (c > 0) headers[lines[i].substring(0, c).trim().toLowerCase()] = lines[i].substring(c + 1).trim();
      }
      contentLength = parseInt(headers['content-length'] || '0', 10);
    }

    if (headersDone && buf.length - headerEndIdx >= contentLength) {
      clearSocket.removeListener('data', onData);
      const body = contentLength > 0 ? buf.subarray(headerEndIdx, headerEndIdx + contentLength) : null;
      forwardRequest(domain, port, method, path, headers, body, secret, clearSocket);
    }
  };

  clearSocket.on('data', onData);
}

/**
 * MITM a CONNECT by spinning up a one-shot local TLS server, piping the
 * client socket into it, then reading the decrypted HTTP request.
 */
function mitmConnect(
  clientSocket: net.Socket,
  head: Buffer,
  domain: string,
  port: number,
  secret: SecretRecord,
  domainCert: { cert: string; key: string },
): void {
  const localTls = tls.createServer(
    { cert: domainCert.cert, key: domainCert.key },
    (clearSocket) => {
      readAndForward(clearSocket, domain, port, secret);
    },
  );

  localTls.on('error', (err) => {
    console.error(`[secrets-proxy] local TLS error for ${domain}: ${err.message}`);
    try { clientSocket.destroy(); } catch { /* ignore */ }
  });

  // Listen on a random free port, then connect the client socket to it.
  localTls.listen(0, '127.0.0.1', () => {
    const addr = localTls.address() as net.AddressInfo;
    const bridge = net.connect(addr.port, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) bridge.write(head);
      clientSocket.pipe(bridge);
      bridge.pipe(clientSocket);
    });

    bridge.on('error', () => { try { clientSocket.destroy(); } catch { /* */ } });
    clientSocket.on('error', () => { try { bridge.destroy(); } catch { /* */ } });

    const cleanup = () => { localTls.close(); };
    clientSocket.on('close', cleanup);
    bridge.on('close', cleanup);
  });
}

/**
 * Handle CONNECT method — the core of HTTPS proxying.
 */
async function handleConnect(
  req: http.IncomingMessage,
  clientSocket: net.Socket,
  head: Buffer,
): Promise<void> {
  const [host, portStr] = (req.url || '').split(':');
  const port = parseInt(portStr || '443', 10);

  if (!host) {
    clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    clientSocket.end();
    return;
  }

  let secret: SecretRecord | null;
  try {
    secret = await findSecretForDomain(host);
  } catch (err) {
    console.error(`[secrets-proxy] DB lookup error for ${host}: ${err}`);
    secret = null;
  }

  // Debug logging for GitHub domain handling
  if (GITHUB_DOMAINS.has(host)) {
    if (secret) {
      console.log(`[secrets-proxy] GitHub domain ${host}: intercepting with auth injection`);
    } else {
      console.warn(`[secrets-proxy] GitHub domain ${host}: no token found, passing through`);
    }
  }

  if (!secret) {
    const upstream = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on('error', (err) => {
      console.error(`[secrets-proxy] tunnel error ${host}:${port}: ${err.message}`);
      try { clientSocket.end(); } catch { /* */ }
    });
    clientSocket.on('error', () => { try { upstream.end(); } catch { /* */ } });
    return;
  }
  let domainCert: { cert: string; key: string };
  try {
    domainCert = generateDomainCert(host);
  } catch (err) {
    console.error(`[secrets-proxy] cert gen error ${host}: ${err}`);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.end();
    return;
  }

  mitmConnect(clientSocket, head, host, port, secret, domainCert);
}

/**
 * Handle plain HTTP proxy requests (non-CONNECT).
 */
async function handleHttpProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const targetUrl = req.url || '';

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  let secret: SecretRecord | null;
  try {
    secret = await findSecretForDomain(parsed.hostname);
  } catch {
    secret = null;
  }

  // Debug logging for GitHub domain handling in HTTP proxy
  if (GITHUB_DOMAINS.has(parsed.hostname)) {
    if (secret) {
      console.log(`[secrets-proxy] GitHub HTTP ${parsed.hostname}: intercepting with auth injection`);
    } else {
      console.warn(`[secrets-proxy] GitHub HTTP ${parsed.hostname}: no token found, passing through`);
    }
  }

  const outHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === 'proxy-connection' || key === 'proxy-authorization') continue;
    outHeaders[key] = value;
  }
  outHeaders['host'] = parsed.host || parsed.hostname;

  if (secret) {
    const auth = buildAuthHeader(secret);
    delete outHeaders['authorization'];
    delete outHeaders['x-api-key'];
    outHeaders[auth.name] = auth.value;
  }

  const protocol = parsed.protocol === 'https:' ? https : http;
  const proxyReq = protocol.request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: parsed.pathname + parsed.search,
      headers: outHeaders,
      rejectUnauthorized: true,
    },
    (proxyRes: http.IncomingMessage) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err: Error) => {
    console.error(`[secrets-proxy] HTTP proxy error: ${err.message}`);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

/** Start the MITM secrets proxy server. */
export async function startSecretsProxy(): Promise<http.Server> {
  const port = getProxyPort();

  server = http.createServer((req, res) => {
    // Handle health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        port: port,
        timestamp: new Date().toISOString(),
        github_domains: Array.from(GITHUB_DOMAINS)
      }));
      return;
    }

    handleHttpProxy(req, res).catch((err) => {
      console.error(`[secrets-proxy] unhandled HTTP error: ${err}`);
      try { res.writeHead(500); res.end(); } catch { /* ignore */ }
    });
  });

  server.on('connect', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    handleConnect(req, socket, head).catch((err) => {
      console.error(`[secrets-proxy] unhandled CONNECT error: ${err}`);
      try { socket.end(); } catch { /* ignore */ }
    });
  });

  server.on('error', (err) => {
    console.error(`[secrets-proxy] server error: ${err.message}`);
  });

  return new Promise<http.Server>((resolve, reject) => {
    server!.listen(port, '0.0.0.0', () => {
      console.log(`[secrets-proxy] MITM proxy listening on 0.0.0.0:${port}`);
      console.log(`[secrets-proxy] Health check available at http://0.0.0.0:${port}/health`);
      resolve(server!);
    });
    
    server!.on('error', (err) => {
      reject(err);
    });
  });
}

/** Stop the proxy server (for graceful shutdown). */
export function stopSecretsProxy(): void {
  if (server) {
    server.close();
    server = null;
  }
}

/** Get the port the proxy is running on. */
export { getProxyPort as getSecretsProxyPort };

/** Check if the proxy server is healthy. */
export async function isProxyHealthy(): Promise<boolean> {
  if (!server || !server.listening) return false;
  
  const port = getProxyPort();
  return new Promise<boolean>((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Get proxy server status. */
export function getProxyStatus(): { running: boolean; port: number; address: string | null } {
  if (!server || !server.listening) {
    return { running: false, port: getProxyPort(), address: null };
  }
  
  const address = server.address();
  if (typeof address === 'string') {
    return { running: true, port: getProxyPort(), address };
  }
  
  return { 
    running: true, 
    port: address?.port || getProxyPort(), 
    address: `${address?.address}:${address?.port}` 
  };
}
