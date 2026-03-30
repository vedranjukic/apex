/**
 * Returns the JavaScript source for the LLM proxy service that runs
 * INSIDE a Daytona proxy sandbox. It is uploaded via sandbox.fs.uploadFile().
 *
 * The service is a lightweight HTTP server that:
 *  - Validates an auth token on every request
 *  - Forwards LLM API calls to Anthropic / OpenAI with real keys injected
 *  - Streams responses back (critical for SSE)
 *
 * Env vars consumed at runtime:
 *  - PROXY_AUTH_TOKEN  — the token regular sandboxes send as their "API key"
 *  - REAL_ANTHROPIC_API_KEY — real Anthropic key
 *  - REAL_OPENAI_API_KEY    — real OpenAI key
 *  - PROXY_PORT             — listen port (default 3000)
 */
export function getLlmProxyServiceScript(port = 3000): string {
  return `"use strict";
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = Number(process.env.PROXY_PORT || ${port});
const AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || "";
const ANTHROPIC_KEY = process.env.REAL_ANTHROPIC_API_KEY || "";
const OPENAI_KEY = process.env.REAL_OPENAI_API_KEY || "";

const PROVIDERS = {
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

const ROUTE_RE = /^\\/llm-proxy\\/(anthropic|openai)(\\/.*)$/;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function proxyRequest(req, res, provider, subpath) {
  const cfg = PROVIDERS[provider];
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

const server = http.createServer((req, res) => {
  console.log("[llm-proxy] " + req.method + " " + req.url);

  if (req.url === "/health" || req.url === "/health/") {
    return sendJson(res, 200, { status: "ok" });
  }

  const match = req.url.match(ROUTE_RE);
  if (!match) {
    console.log("[llm-proxy] 404 — no route match for: " + req.url);
    return sendJson(res, 404, { error: "Not found" });
  }

  const [, provider, rest] = match;
  const subpath = rest || "/";
  proxyRequest(req, res, provider, subpath);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[llm-proxy] listening on port " + PORT);
});
`;
}
