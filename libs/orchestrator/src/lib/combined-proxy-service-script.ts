/**
 * Returns the JavaScript source for the combined proxy service that runs
 * INSIDE a Daytona proxy sandbox. It includes:
 * 
 * 1. LLM proxy (existing functionality on port 3000)
 * 2. MITM secrets proxy (port 9340, internal only) 
 * 3. TCP-over-WebSocket tunnel bridge (/tunnel endpoint)
 * 4. Port relay bridge service (port 9341, /port-relay/:port endpoints)
 *
 * The service is uploaded via sandbox.fs.uploadFile() and handles:
 * - LLM API proxying with real key injection
 * - MITM HTTPS proxying with secrets injection  
 * - WebSocket-to-TCP tunneling for CONNECT requests from regular sandboxes
 * - Port relay tunneling for arbitrary TCP port forwarding
 *
 * Environment variables consumed at runtime:
 * - PROXY_AUTH_TOKEN      — auth token for LLM proxy
 * - REAL_ANTHROPIC_API_KEY — real Anthropic key
 * - REAL_OPENAI_API_KEY   — real OpenAI key 
 * - PROXY_PORT            — LLM proxy listen port (default 3000)
 * - MITM_PROXY_PORT       — MITM proxy listen port (default 9340)
 * - PORT_RELAY_PORT       — port relay bridge listen port (default 9341)
 * - SECRETS_JSON          — JSON array of secrets for MITM proxy
 * - GITHUB_TOKEN          — GitHub API token fallback
 * - CA_CERT_PEM           — CA certificate for MITM
 * - CA_KEY_PEM            — CA private key for MITM
 */
export function getCombinedProxyServiceScript(
  llmPort = 3000,
  mitmPort = 9340,
  portRelayPort = 9341
): string {
  return `"use strict";
const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");
const { URL } = require("url");
const WebSocket = require("ws");
const forge = require("node-forge");

// Configuration
const LLM_PORT = Number(process.env.PROXY_PORT || ${llmPort});
const MITM_PORT = Number(process.env.MITM_PROXY_PORT || ${mitmPort});
const PORT_RELAY_PORT = Number(process.env.PORT_RELAY_PORT || ${portRelayPort});
const AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || "";
const ANTHROPIC_KEY = process.env.REAL_ANTHROPIC_API_KEY || "";
const OPENAI_KEY = process.env.REAL_OPENAI_API_KEY || "";
const SECRETS_JSON = process.env.SECRETS_JSON || "[]";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const CA_CERT_PEM = process.env.CA_CERT_PEM || "";
const CA_KEY_PEM = process.env.CA_KEY_PEM || "";

console.log("[combined-proxy] Starting combined proxy service...");
console.log("[combined-proxy] LLM port:", LLM_PORT);
console.log("[combined-proxy] MITM port:", MITM_PORT);
console.log("[combined-proxy] Port relay port:", PORT_RELAY_PORT);

// Parse secrets
let secrets = [];
try {
  secrets = JSON.parse(SECRETS_JSON);
  console.log("[combined-proxy] Loaded", secrets.length, "secrets");
} catch (e) {
  console.log("[combined-proxy] Failed to parse secrets:", e.message);
}

// GitHub domains for fallback token
const GITHUB_DOMAINS = new Set(['github.com', 'api.github.com']);

// LLM Provider configurations
const LLM_PROVIDERS = {
  anthropic: {
    upstream: "https://api.anthropic.com",
    realKey: () => ANTHROPIC_KEY,
    extractToken: (headers) => headers["x-api-key"] || "",
    setAuth: (headers, key) => { headers["x-api-key"] = key; delete headers["authorization"]; },
  },
  openai: {
    upstream: "https://api.openai.com",
    realKey: () => OPENAI_KEY,
    extractToken: (headers) => {
      const auth = headers["authorization"] || "";
      return auth.startsWith("Bearer ") ? auth.slice(7) : "";
    },
    setAuth: (headers, key) => { headers["authorization"] = "Bearer " + key; delete headers["x-api-key"]; },
  },
};

const LLM_ROUTE_RE = /^\\/llm-proxy\\/(anthropic|openai)(\\/.*)$/;

// Domain certificate cache for MITM
const domainCertCache = new Map();

// =============================================================================
// Utility functions
// =============================================================================

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 
    "content-type": "application/json", 
    "content-length": Buffer.byteLength(body) 
  });
  res.end(body);
}

function findSecretForDomain(host) {
  // Check user-defined secrets first
  for (const secret of secrets) {
    if (secret.domain === host) {
      return secret;
    }
  }
  
  // Fallback to GitHub token for GitHub domains
  if (GITHUB_DOMAINS.has(host) && GITHUB_TOKEN) {
    return {
      id: '_github_token',
      name: 'GITHUB_TOKEN',
      value: GITHUB_TOKEN,
      domain: host,
      authType: 'bearer'
    };
  }
  
  return null;
}

function buildAuthHeader(secret) {
  const authType = secret.authType || 'bearer';
  
  if (authType === 'bearer') {
    return { name: 'authorization', value: \`Bearer \${secret.value}\` };
  }
  if (authType === 'x-api-key') {
    return { name: 'x-api-key', value: secret.value };
  }
  if (authType === 'basic') {
    const encoded = Buffer.from(secret.value).toString('base64');
    return { name: 'authorization', value: \`Basic \${encoded}\` };
  }
  if (authType.startsWith('header:')) {
    const headerName = authType.slice('header:'.length).trim();
    return { name: headerName.toLowerCase(), value: secret.value };
  }
  
  return { name: 'authorization', value: \`Bearer \${secret.value}\` };
}

// Parse CA cert/key once at startup
let caCert = null;
let caKey = null;
if (CA_CERT_PEM && CA_KEY_PEM) {
  try {
    caCert = forge.pki.certificateFromPem(CA_CERT_PEM);
    caKey = forge.pki.privateKeyFromPem(CA_KEY_PEM);
    console.log("[combined-proxy] CA certificate loaded for MITM cert generation");
  } catch (e) {
    console.error("[combined-proxy] Failed to parse CA cert/key:", e.message);
  }
}

function generateDomainCert(domain) {
  const cached = domainCertCache.get(domain);
  if (cached) return cached;
  
  if (!caCert || !caKey) {
    throw new Error("CA certificate/key not available");
  }
  
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);
  
  cert.setSubject([{ name: "commonName", value: domain }]);
  cert.setIssuer(caCert.subject.attributes);
  
  cert.setExtensions([
    { name: "subjectAltName", altNames: [{ type: 2, value: domain }] },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
  ]);
  
  cert.sign(caKey, forge.md.sha256.create());
  
  const result = {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey),
  };
  
  domainCertCache.set(domain, result);
  console.log("[combined-proxy] Generated domain cert for", domain);
  return result;
}

// =============================================================================
// MITM Proxy Logic
// =============================================================================

function forwardRequest(domain, port, method, path, headers, body, secret, clientSocket) {
  const auth = buildAuthHeader(secret);
  
  // Inject auth header, preserve existing headers
  const fwdHeaders = Object.assign({}, headers);
  fwdHeaders[auth.name] = auth.value;
  delete fwdHeaders['proxy-connection'];
  delete fwdHeaders['connection'];
  
  const opts = {
    hostname: domain,
    port: port,
    path: path,
    method: method,
    headers: fwdHeaders
  };
  
  console.log(\`[mitm-proxy] Forwarding \${method} \${domain}:\${port}\${path} with auth\`);
  
  const req = https.request(opts, (res) => {
    clientSocket.write(\`HTTP/1.1 \${res.statusCode} \${res.statusMessage}\\r\\n\`);
    
    // Forward response headers
    for (const [key, value] of Object.entries(res.headers)) {
      if (key.toLowerCase() !== 'connection') {
        clientSocket.write(\`\${key}: \${value}\\r\\n\`);
      }
    }
    clientSocket.write('\\r\\n');
    
    res.pipe(clientSocket);
  });
  
  req.on('error', (err) => {
    console.error('[mitm-proxy] Upstream error:', err);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n');
    clientSocket.end();
  });
  
  if (body) {
    req.write(body);
  }
  req.end();
}

function mitmConnect(clientSocket, head, domain, port, secret) {
  console.log(\`[mitm-proxy] MITM CONNECT to \${domain}:\${port}\`);
  
  try {
    const domainCert = generateDomainCert(domain);
    
    // Create local TLS server for this connection
    const localTls = tls.createServer({
      cert: domainCert.cert,
      key: domainCert.key
    }, (clearSocket) => {
      console.log('[mitm-proxy] TLS handshake complete, reading request...');
      
      let buffer = Buffer.alloc(0);
      
      clearSocket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        
        // Look for complete HTTP request
        const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
        if (headerEnd === -1) return; // Need more data
        
        const headerText = buffer.slice(0, headerEnd).toString();
        const bodyBuffer = buffer.slice(headerEnd + 4);
        
        // Parse request line and headers
        const lines = headerText.split('\\r\\n');
        const [method, path] = lines[0].split(' ');
        
        const headers = {};
        for (let i = 1; i < lines.length; i++) {
          const colonIndex = lines[i].indexOf(':');
          if (colonIndex > 0) {
            const name = lines[i].slice(0, colonIndex).toLowerCase();
            const value = lines[i].slice(colonIndex + 1).trim();
            headers[name] = value;
          }
        }
        
        // Check if we have complete body
        const contentLength = parseInt(headers['content-length'] || '0');
        if (bodyBuffer.length < contentLength) return; // Need more data
        
        const body = contentLength > 0 ? bodyBuffer.slice(0, contentLength) : null;
        
        forwardRequest(domain, port, method, path, headers, body, secret, clearSocket);
      });
      
      clearSocket.on('error', (err) => {
        console.error('[mitm-proxy] Clear socket error:', err);
      });
    });
    
    localTls.on('error', (err) => {
      console.error('[mitm-proxy] TLS server error:', err);
      clientSocket.end();
    });
    
    // Get a random port for the local TLS server
    localTls.listen(0, '127.0.0.1', () => {
      const localPort = localTls.address().port;
      console.log(\`[mitm-proxy] Local TLS server listening on \${localPort}\`);
      
      // Send CONNECT success response
      clientSocket.write('HTTP/1.1 200 Connection established\\r\\n\\r\\n');
      
      // Connect to the local TLS server
      const localConn = net.connect(localPort, '127.0.0.1');
      
      localConn.on('connect', () => {
        // Pipe data between client and local TLS server
        clientSocket.pipe(localConn);
        localConn.pipe(clientSocket);
        
        // Write any head data
        if (head.length > 0) {
          localConn.write(head);
        }
      });
      
      localConn.on('error', (err) => {
        console.error('[mitm-proxy] Local connection error:', err);
        clientSocket.end();
      });
      
      clientSocket.on('close', () => {
        localConn.destroy();
        localTls.close();
      });
    });
    
  } catch (err) {
    console.error('[mitm-proxy] MITM setup error:', err);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n');
    clientSocket.end();
  }
}

function transparentConnect(clientSocket, head, domain, port) {
  console.log(\`[mitm-proxy] Transparent CONNECT to \${domain}:\${port}\`);
  
  const upstream = net.connect(port, domain);
  
  upstream.on('connect', () => {
    clientSocket.write('HTTP/1.1 200 Connection established\\r\\n\\r\\n');
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
    
    if (head.length > 0) {
      upstream.write(head);
    }
  });
  
  upstream.on('error', (err) => {
    console.error(\`[mitm-proxy] Upstream connection error to \${domain}:\${port}:\`, err);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n');
    clientSocket.end();
  });
  
  clientSocket.on('close', () => {
    upstream.destroy();
  });
}

// =============================================================================
// LLM Proxy Logic
// =============================================================================

function proxyLlmRequest(req, res, provider, subpath) {
  const cfg = LLM_PROVIDERS[provider];
  if (!cfg) return sendJson(res, 400, { error: "Unknown provider: " + provider });

  const token = cfg.extractToken(req.headers);
  if (!AUTH_TOKEN || token !== AUTH_TOKEN) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const realKey = cfg.realKey();
  if (!realKey) return sendJson(res, 502, { error: "No API key configured for " + provider });

  const targetUrl = new URL(subpath, cfg.upstream);
  // Preserve query string from the original request
  const incoming = new URL(req.url, "http://localhost");
  targetUrl.search = incoming.search;

  const fwdHeaders = Object.assign({}, req.headers);
  delete fwdHeaders["host"];
  delete fwdHeaders["connection"];
  delete fwdHeaders["accept-encoding"];
  cfg.setAuth(fwdHeaders, realKey);

  const opts = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: fwdHeaders,
  };

  const upstream = https.request(opts, (upRes) => {
    console.log("[llm-proxy] upstream " + provider + " → " + upRes.statusCode);
    const respHeaders = {};
    const skip = new Set(["transfer-encoding", "content-encoding", "connection"]);
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (!skip.has(k.toLowerCase())) respHeaders[k] = v;
    }
    res.writeHead(upRes.statusCode, respHeaders);
    upRes.pipe(res, { end: true });
  });

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: "Upstream error: " + err.message });
    } else {
      res.end();
    }
  });

  req.pipe(upstream, { end: true });
}

// =============================================================================
// Server Setup
// =============================================================================

// Create MITM proxy server
const mitmServer = http.createServer();

mitmServer.on('connect', (req, clientSocket, head) => {
  const [domain, port] = req.url.split(':');
  const targetPort = parseInt(port) || 443;
  
  console.log(\`[mitm-proxy] CONNECT \${domain}:\${targetPort}\`);
  
  const secret = findSecretForDomain(domain);
  
  if (secret) {
    // MITM this connection
    mitmConnect(clientSocket, head, domain, targetPort, secret);
  } else {
    // Transparent tunnel
    transparentConnect(clientSocket, head, domain, targetPort);
  }
});

mitmServer.on('request', (req, res) => {
  console.log(\`[mitm-proxy] HTTP \${req.method} \${req.url}\`);
  
  // Handle plain HTTP proxy requests
  const url = new URL(req.url);
  const secret = findSecretForDomain(url.hostname);
  
  if (secret) {
    // Inject auth and forward
    let body = Buffer.alloc(0);
    
    req.on('data', (chunk) => {
      body = Buffer.concat([body, chunk]);
    });
    
    req.on('end', () => {
      forwardRequest(
        url.hostname,
        url.port || (url.protocol === 'https:' ? 443 : 80),
        req.method,
        url.pathname + url.search,
        req.headers,
        body.length > 0 ? body : null,
        secret,
        res
      );
    });
  } else {
    res.writeHead(502);
    res.end('No secret configured for domain');
  }
});

// Create combined HTTP server (LLM proxy + WebSocket tunnel)
const httpServer = http.createServer((req, res) => {
  console.log("[combined-proxy] " + req.method + " " + req.url);

  if (req.url === "/health" || req.url === "/health/") {
    return sendJson(res, 200, { 
      status: "ok", 
      services: {
        llm_proxy: "running",
        mitm_proxy: "running",
        tunnel_bridge: "running",
        port_relay_bridge: "running"
      }
    });
  }

  const llmMatch = req.url.match(LLM_ROUTE_RE);
  if (llmMatch) {
    const [, provider, rest] = llmMatch;
    const subpath = rest || "/";
    return proxyLlmRequest(req, res, provider, subpath);
  }

  console.log("[combined-proxy] 404 — no route match for: " + req.url);
  return sendJson(res, 404, { error: "Not found" });
});

// WebSocket server for tunnel
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  console.log('[tunnel-bridge] New tunnel connection');
  
  // Connect to local MITM proxy
  const tcp = net.connect(MITM_PORT, '127.0.0.1');
  let isConnected = false;
  
  tcp.on('connect', () => {
    console.log('[tunnel-bridge] Connected to MITM proxy');
    isConnected = true;
    
    // Handle WebSocket to TCP data flow with backpressure
    ws.on('message', (data) => {
      if (!isConnected || !tcp.writable) {
        console.warn('[tunnel-bridge] Dropping WS message, TCP not writable');
        return;
      }
      
      const success = tcp.write(data);
      if (!success) {
        // Backpressure: pause WebSocket until TCP drain
        ws.pause?.();
        tcp.once('drain', () => {
          console.log('[tunnel-bridge] TCP drain, resuming WebSocket');
          ws.resume?.();
        });
      }
    });
    
    // Handle TCP to WebSocket data flow with backpressure
    tcp.on('data', (data) => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn('[tunnel-bridge] Dropping TCP data, WebSocket not open');
        return;
      }
      
      try {
        ws.send(data);
        // Note: WebSocket send() is async but doesn't return a promise
        // For proper backpressure, we'd need to check ws.bufferedAmount
        if (ws.bufferedAmount > 64 * 1024) { // 64KB threshold
          console.warn('[tunnel-bridge] WebSocket buffer high:', ws.bufferedAmount);
          tcp.pause();
          // Resume when buffer clears (simplified approach)
          setTimeout(() => {
            if (tcp.readable && ws.bufferedAmount < 16 * 1024) {
              tcp.resume();
            }
          }, 100);
        }
      } catch (err) {
        console.error('[tunnel-bridge] Error sending to WebSocket:', err);
        tcp.destroy();
      }
    });
  });
  
  tcp.on('close', () => {
    console.log('[tunnel-bridge] TCP connection closed');
    isConnected = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'TCP connection closed');
    }
  });
  
  tcp.on('error', (err) => {
    console.error('[tunnel-bridge] TCP error:', err);
    isConnected = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'TCP error: ' + err.message);
    }
  });
  
  tcp.on('timeout', () => {
    console.warn('[tunnel-bridge] TCP timeout');
    tcp.destroy();
  });
  
  ws.on('close', (code, reason) => {
    console.log(\`[tunnel-bridge] WebSocket closed: \${code} \${reason}\`);
    isConnected = false;
    tcp.destroy();
  });
  
  ws.on('error', (err) => {
    console.error('[tunnel-bridge] WebSocket error:', err);
    isConnected = false;
    tcp.destroy();
  });
  
  // Set reasonable timeout for the TCP connection
  tcp.setTimeout(30000); // 30 second timeout
});

// Port relay WebSocket server
const portRelayWss = new WebSocket.Server({ noServer: true });

portRelayWss.on('connection', (ws, req) => {
  const urlParts = req.url.split('/');
  if (urlParts.length < 3 || urlParts[1] !== 'port-relay') {
    console.log('[port-relay] Invalid URL format:', req.url);
    ws.close(1008, 'Invalid URL format');
    return;
  }
  
  const targetPort = parseInt(urlParts[2]);
  if (isNaN(targetPort) || targetPort <= 0 || targetPort > 65535) {
    console.log('[port-relay] Invalid port:', urlParts[2]);
    ws.close(1008, 'Invalid port number');
    return;
  }
  
  console.log(\`[port-relay] New port relay connection for port \${targetPort}\`);
  
  // Connect to the target port on localhost
  const tcp = net.connect(targetPort, '127.0.0.1');
  let isConnected = false;
  
  tcp.on('connect', () => {
    console.log(\`[port-relay] Connected to localhost:\${targetPort}\`);
    isConnected = true;
    
    // Handle WebSocket to TCP data flow with backpressure
    ws.on('message', (data) => {
      if (!isConnected || !tcp.writable) {
        console.warn('[port-relay] Dropping WS message, TCP not writable');
        return;
      }
      
      const success = tcp.write(data);
      if (!success) {
        // Backpressure: pause WebSocket until TCP drain
        ws.pause?.();
        tcp.once('drain', () => {
          console.log('[port-relay] TCP drain, resuming WebSocket');
          ws.resume?.();
        });
      }
    });
    
    // Handle TCP to WebSocket data flow with backpressure  
    tcp.on('data', (data) => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn('[port-relay] Dropping TCP data, WebSocket not open');
        return;
      }
      
      try {
        ws.send(data);
        // Handle backpressure for large transfers
        if (ws.bufferedAmount > 64 * 1024) { // 64KB threshold
          console.warn(\`[port-relay] WebSocket buffer high: \${ws.bufferedAmount}\`);
          tcp.pause();
          // Resume when buffer clears (simplified approach)
          setTimeout(() => {
            if (tcp.readable && ws.bufferedAmount < 16 * 1024) {
              tcp.resume();
            }
          }, 100);
        }
      } catch (err) {
        console.error('[port-relay] Error sending to WebSocket:', err);
        tcp.destroy();
      }
    });
  });
  
  tcp.on('close', () => {
    console.log(\`[port-relay] TCP connection to port \${targetPort} closed\`);
    isConnected = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'TCP connection closed');
    }
  });
  
  tcp.on('error', (err) => {
    console.error(\`[port-relay] TCP error for port \${targetPort}:\`, err);
    isConnected = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'TCP error: ' + err.message);
    }
  });
  
  tcp.on('timeout', () => {
    console.warn(\`[port-relay] TCP timeout for port \${targetPort}\`);
    tcp.destroy();
  });
  
  ws.on('close', (code, reason) => {
    console.log(\`[port-relay] WebSocket closed for port \${targetPort}: \${code} \${reason}\`);
    isConnected = false;
    tcp.destroy();
  });
  
  ws.on('error', (err) => {
    console.error(\`[port-relay] WebSocket error for port \${targetPort}:\`, err);
    isConnected = false;
    tcp.destroy();
  });
  
  // Set reasonable timeout for the TCP connection
  tcp.setTimeout(30000); // 30 second timeout
});

// Handle WebSocket upgrades
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/tunnel') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else if (req.url.startsWith('/port-relay/')) {
    portRelayWss.handleUpgrade(req, socket, head, (ws) => {
      portRelayWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Create port relay HTTP server for WebSocket upgrades
const portRelayServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/health/") {
    return sendJson(res, 200, { 
      status: "ok", 
      service: "port_relay_bridge"
    });
  }

  console.log("[port-relay] HTTP request to: " + req.url);
  return sendJson(res, 404, { error: "Not found - use WebSocket endpoints /port-relay/:port" });
});

// Handle port relay WebSocket upgrades
portRelayServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/port-relay/')) {
    portRelayWss.handleUpgrade(req, socket, head, (ws) => {
      portRelayWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Start servers
mitmServer.listen(MITM_PORT, "127.0.0.1", () => {
  console.log("[mitm-proxy] listening on port " + MITM_PORT);
});

portRelayServer.listen(PORT_RELAY_PORT, "0.0.0.0", () => {
  console.log("[port-relay] HTTP server listening on port " + PORT_RELAY_PORT);
  console.log("[port-relay] Port relay WebSocket available at /port-relay/:port");
});

httpServer.listen(LLM_PORT, "0.0.0.0", () => {
  console.log("[combined-proxy] HTTP server listening on port " + LLM_PORT);
  console.log("[combined-proxy] LLM proxy available at /llm-proxy/*");
  console.log("[combined-proxy] Tunnel bridge available at /tunnel");
  console.log("[combined-proxy] Health check available at /health");
});
`;
}