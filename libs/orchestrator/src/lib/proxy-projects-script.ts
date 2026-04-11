/**
 * Returns the JavaScript source for the project registry + mobile dashboard
 * service that runs INSIDE the Daytona proxy sandbox.
 *
 * The service is a lightweight HTTP server that:
 *  - Maintains a registry of Daytona projects, threads, and messages (CRUD)
 *  - Authenticates API requests via Bearer token (PROXY_AUTH_TOKEN)
 *  - Persists data to JSON files on disk
 *  - Serves the mobile dashboard SPA from /app/*
 *
 * Env vars consumed at runtime:
 *  - PROXY_AUTH_TOKEN      — bearer token for authentication
 *  - PROJECTS_API_PORT     — listen port (default 3001)
 */
export function getProxyProjectsScript(port = 3001): string {
  return `"use strict";
process.on("uncaughtException", function (err) {
  try { require("fs").appendFileSync("/tmp/projects-api-errors.log", new Date().toISOString() + " UNCAUGHT: " + err.stack + "\\n"); } catch {}
  console.error("UNCAUGHT:", err.stack || err);
});
var http = require("http");
var fs = require("fs");
var pathMod = require("path");

var PORT = Number(process.env.PROJECTS_API_PORT || ${port});
var AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || "";
var DATA_DIR = "/home/daytona";
var PROJECTS_FILE = DATA_DIR + "/projects.json";
var THREADS_FILE = DATA_DIR + "/threads.json";
var MESSAGES_FILE = DATA_DIR + "/messages.json";
var DASHBOARD_DIR = DATA_DIR + "/mobile-dashboard";

var crypto = require("crypto");

var projects = new Map();
var threads = new Map();
var messagesMap = new Map();
var runningAgents = new Map();

// ── Persistence ──────────────────────────────────────

function loadMap(file, map) {
  try {
    if (fs.existsSync(file)) {
      var raw = fs.readFileSync(file, "utf8");
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (var i = 0; i < arr.length; i++) map.set(arr[i].id || arr[i]._key, arr[i]);
      }
    }
  } catch (err) {
    console.error("[projects-api] Failed to load " + file + ":", err.message);
  }
}

function loadMessagesFromDisk() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      var raw = fs.readFileSync(MESSAGES_FILE, "utf8");
      var obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
          messagesMap.set(keys[i], obj[keys[i]]);
        }
      }
    }
  } catch (err) {
    console.error("[projects-api] Failed to load messages:", err.message);
  }
}

function persistFile(file, data) {
  try {
    var tmp = file + ".tmp." + Date.now();
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error("[projects-api] Failed to persist " + file + ":", err.message);
  }
}

var persistTimers = {};
function debouncedPersist(name, fn, delayMs) {
  if (persistTimers[name]) clearTimeout(persistTimers[name]);
  persistTimers[name] = setTimeout(function () {
    persistTimers[name] = null;
    try { fn(); } catch (err) { console.error("[projects-api] persist " + name + " error:", err.message); }
  }, delayMs || 2000);
}

function persistProjects() {
  debouncedPersist("projects", function () {
    persistFile(PROJECTS_FILE, JSON.stringify(Array.from(projects.values()), null, 2));
  }, 1000);
}

function persistThreads() {
  debouncedPersist("threads", function () {
    persistFile(THREADS_FILE, JSON.stringify(Array.from(threads.values()), null, 2));
  }, 1000);
}

function persistMessages() {
  debouncedPersist("messages", function () {
    var obj = {};
    messagesMap.forEach(function (msgs, key) { obj[key] = msgs; });
    persistFile(MESSAGES_FILE, JSON.stringify(obj));
  }, 3000);
}

// ── Helpers ──────────────────────────────────────────

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function checkAuth(req) {
  if (!AUTH_TOKEN) return false;
  var auth = req.headers["authorization"] || "";
  if (!auth.startsWith("Bearer ")) return false;
  return auth.slice(7) === AUTH_TOKEN;
}

function extractPath(url) {
  var qIdx = url.indexOf("?");
  return qIdx === -1 ? url : url.slice(0, qIdx);
}

var MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(res, urlPath) {
  var relPath = urlPath.replace(/^\\/app\\/?/, "") || "index.html";
  var filePath = pathMod.join(DASHBOARD_DIR, relPath);
  if (!filePath.startsWith(DASHBOARD_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = pathMod.join(DASHBOARD_DIR, "index.html");
    }
    var data = fs.readFileSync(filePath);
    var ext = pathMod.extname(filePath).toLowerCase();
    var ct = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": ct,
      "content-length": data.length,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404); res.end("Not found");
  }
}

// ── WebSocket client (uses Node built-in or manual fallback) ──────

function connectBridgeWs(url, headers, onMessage, onClose) {
  var wsUrl = url.replace("https://", "wss://").replace("http://", "ws://");
  console.log("[projects-api] Connecting WS to " + wsUrl.slice(0, 60) + "...");

  // Try Node built-in WebSocket first (Node 22+, experimental in 18-21)
  if (typeof globalThis.WebSocket === "function") {
    try {
      var ws = new globalThis.WebSocket(wsUrl, { headers: headers });
      ws.onopen = function () {
        console.log("[projects-api] WS connected (built-in)");
      };
      ws.onmessage = function (ev) {
        try { onMessage(JSON.parse(ev.data)); } catch {}
      };
      ws.onclose = function () { if (onClose) onClose(); };
      ws.onerror = function (err) {
        console.error("[projects-api] WS error (built-in):", err.message || err);
        if (onClose) onClose();
      };
      onMessage._send = function (obj) { ws.send(JSON.stringify(obj)); };
      onMessage._close = function () { ws.close(); };
      return;
    } catch (e) {
      console.log("[projects-api] Built-in WebSocket failed, trying manual:", e.message);
    }
  }

  // Manual WebSocket via https upgrade
  var mod = wsUrl.startsWith("wss") ? require("https") : require("http");
  var parsed = new (require("url").URL)(wsUrl.replace("wss://", "https://").replace("ws://", "http://"));
  var key = crypto.randomBytes(16).toString("base64");
  var opts = {
    hostname: parsed.hostname,
    port: parsed.port || (wsUrl.startsWith("wss") ? 443 : 80),
    path: parsed.pathname + (parsed.search || ""),
    method: "GET",
    headers: Object.assign({
      "Connection": "Upgrade",
      "Upgrade": "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": key,
    }, headers || {}),
    rejectUnauthorized: false,
  };
  var req = mod.request(opts);
  req.on("upgrade", function (_res, socket) {
    console.log("[projects-api] WS connected (manual upgrade)");

    function wsSend(text) {
      var data = Buffer.from(text, "utf8");
      var mask = crypto.randomBytes(4);
      var hdrLen = data.length < 126 ? 6 : (data.length < 65536 ? 8 : 14);
      var frame = Buffer.alloc(hdrLen + data.length);
      frame[0] = 0x81;
      if (data.length < 126) {
        frame[1] = 0x80 | data.length;
        mask.copy(frame, 2);
      } else if (data.length < 65536) {
        frame[1] = 0x80 | 126;
        frame.writeUInt16BE(data.length, 2);
        mask.copy(frame, 4);
      } else {
        frame[1] = 0x80 | 127;
        frame.writeBigUInt64BE(BigInt(data.length), 2);
        mask.copy(frame, 10);
      }
      for (var i = 0; i < data.length; i++) frame[hdrLen + i] = data[i] ^ mask[i % 4];
      socket.write(frame);
    }
    onMessage._send = function (obj) { wsSend(JSON.stringify(obj)); };
    onMessage._close = function () { socket.end(); };

    var buf = Buffer.alloc(0);
    socket.on("data", function (chunk) {
      try {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          var opcode = buf[0] & 0x0f;
          var masked = (buf[1] & 0x80) !== 0;
          var payloadLen = buf[1] & 0x7f;
          var offset = 2;
          if (payloadLen === 126) {
            if (buf.length < 4) return;
            payloadLen = buf.readUInt16BE(2); offset = 4;
          } else if (payloadLen === 127) {
            if (buf.length < 10) return;
            payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10;
          }
          if (payloadLen > 10 * 1024 * 1024) { buf = Buffer.alloc(0); return; }
          var maskOffset = masked ? 4 : 0;
          if (buf.length < offset + maskOffset + payloadLen) return;
          var payload = buf.slice(offset + maskOffset, offset + maskOffset + payloadLen);
          if (masked) {
            var maskKey = buf.slice(offset, offset + 4);
            for (var i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
          }
          buf = buf.slice(offset + maskOffset + payloadLen);
          if (opcode === 0x1) {
            try { onMessage(JSON.parse(payload.toString("utf8"))); } catch {}
          } else if (opcode === 0x8) {
            socket.end(); return;
          } else if (opcode === 0x9) {
            var pong = Buffer.alloc(2); pong[0] = 0x8a; pong[1] = 0;
            socket.write(pong);
          }
        }
      } catch (frameErr) {
        console.error("[projects-api] WS frame error:", frameErr.message);
        buf = Buffer.alloc(0);
      }
    });
    socket.on("close", function () { if (onClose) onClose(); });
    socket.on("error", function (err) {
      console.error("[projects-api] WS socket error:", err.message);
      if (onClose) onClose();
    });
  });
  req.on("response", function (res) {
    console.error("[projects-api] WS upgrade rejected: HTTP " + res.statusCode);
    if (onClose) onClose();
  });
  req.on("error", function (err) {
    console.error("[projects-api] WS connect error:", err.message);
    if (onClose) onClose();
  });
  req.end();
}

// ── Agent execution ──────────────────────────────────

function executePrompt(projectId, threadId, prompt) {
  var proj = projects.get(projectId);
  if (!proj || !proj.bridgeUrl) {
    console.error("[projects-api] No bridge URL for project " + projectId);
    return;
  }

  var headers = { "X-Daytona-Skip-Preview-Warning": "true" };
  if (proj.bridgeToken) headers["x-daytona-preview-token"] = proj.bridgeToken;

  runningAgents.set(threadId, { status: "connecting", startedAt: new Date().toISOString() });

  var onMessage = function (msg) {
    var logExtra = msg.data ? " data.type=" + msg.data.type : "";
    if (msg.type === "agent_error" || msg.type === "start_agent_ack") logExtra += " " + JSON.stringify(msg.data || msg).slice(0, 300);
    console.log("[projects-api] Bridge msg: " + msg.type + logExtra);

    if (msg.type === "bridge_ready") {
      console.log("[projects-api] Bridge ready, sending prompt for thread " + threadId.slice(0, 8));
      runningAgents.set(threadId, { status: "running", startedAt: new Date().toISOString() });
      if (onMessage._send) {
        if (proj.proxyBaseUrl) {
          onMessage._send({
            type: "update_proxy_url",
            proxyBaseUrl: proj.proxyBaseUrl,
            authToken: proj.proxyAuthToken || AUTH_TOKEN,
            restart: true,
          });
        }
        onMessage._send({
          type: "start_agent",
          prompt: prompt,
          threadId: threadId,
          agent: "build",
        });
      }
    }

    if (msg.type === "agent_message" && msg.data) {
      var role = msg.data.type;
      if (role === "assistant" || role === "system" || role === "result") {
        var existing = messagesMap.get(threadId) || [];
        existing.push({
          id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
          taskId: threadId,
          role: role === "result" ? "system" : role,
          content: msg.data.message ? msg.data.message.content || [] : [],
          metadata: role === "result" ? {
            costUsd: msg.data.total_cost_usd,
            numTurns: msg.data.num_turns,
            durationMs: msg.data.duration_ms,
          } : msg.data.message ? {
            model: msg.data.message.model,
            stopReason: msg.data.message.stop_reason,
          } : null,
          createdAt: new Date().toISOString(),
        });
        messagesMap.set(threadId, existing);
        persistMessages();
      }

      if (role === "result") {
        runningAgents.delete(threadId);
        if (onMessage._close) try { onMessage._close(); } catch {}
        var thread = threads.get(threadId);
        if (thread) {
          thread.status = msg.data.is_error ? "error" : "completed";
          thread.updatedAt = new Date().toISOString();
          threads.set(threadId, thread);
          persistThreads();
        }
      }
    }

    if (msg.type === "agent_error") {
      var errMsg = msg.error || msg.data?.error || JSON.stringify(msg.data || "unknown");
      console.error("[projects-api] Agent error for thread " + threadId.slice(0, 8) + ": " + errMsg);

      // Retry once on stale proxy sandbox errors -- the bridge restarts OpenCode
      // with updated env from update_proxy_url, second attempt should succeed
      if (!onMessage._retried && errMsg.indexOf("not found") !== -1 && errMsg.indexOf("Sandbox with ID") !== -1) {
        console.log("[projects-api] Stale proxy detected, retrying in 5s...");
        onMessage._retried = true;
        setTimeout(function () {
          if (onMessage._send) {
            onMessage._send({
              type: "start_agent",
              prompt: prompt,
              threadId: threadId,
              agent: "build",
            });
          }
        }, 5000);
        return;
      }

      runningAgents.delete(threadId);
      var thread = threads.get(threadId);
      if (thread) { thread.status = "error"; thread.updatedAt = new Date().toISOString(); threads.set(threadId, thread); persistThreads(); }
      var existing = messagesMap.get(threadId) || [];
      existing.push({
        id: crypto.randomBytes(16).toString("hex"),
        taskId: threadId, role: "system",
        content: [{ type: "text", text: "Agent error: " + errMsg }],
        metadata: { error: true }, createdAt: new Date().toISOString(),
      });
      messagesMap.set(threadId, existing);
      persistMessages();
      if (onMessage._close) try { onMessage._close(); } catch {}
    }

    if (msg.type === "agent_exit") {
      runningAgents.delete(threadId);
      if (onMessage._close) try { onMessage._close(); } catch {}
    }
  };

  connectBridgeWs(proj.bridgeUrl, headers, onMessage, function () {
    console.log("[projects-api] WS closed for thread " + threadId.slice(0, 8));
    runningAgents.delete(threadId);
  });
}

// ── Request handler ──────────────────────────────────

var server = http.createServer(function (req, res) {
  var method = req.method;
  var urlPath = extractPath(req.url);

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  // Static dashboard files (no auth)
  if (urlPath === "/" || urlPath === "/app" || urlPath.startsWith("/app/")) {
    if (urlPath === "/") {
      res.writeHead(302, { location: "/app" });
      return res.end();
    }
    return serveStatic(res, urlPath);
  }

  if (urlPath === "/health" || urlPath === "/health/") {
    return sendJson(res, 200, { status: "ok", projects: projects.size, threads: threads.size });
  }

  if (urlPath === "/debug/log") {
    try {
      var log = fs.readFileSync("/tmp/projects-api.log", "utf8");
      var lines = log.split("\\n").slice(-80).join("\\n");
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(lines);
    } catch (e) {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("No log file");
    }
  }

  // All API routes below require auth
  if (!checkAuth(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  console.log("[projects-api] " + method + " " + urlPath);

  // ── Projects CRUD ────────────────────────

  if (urlPath === "/projects" || urlPath === "/projects/") {
    if (method === "GET") {
      var list = Array.from(projects.values());
      list.sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); });
      return sendJson(res, 200, list);
    }
    if (method === "POST") {
      return readBody(req).then(function (body) {
        if (!body.id) return sendJson(res, 400, { error: "Missing project id" });
        var now = new Date().toISOString();
        var existing = projects.get(body.id);
        var project = {
          id: body.id,
          name: body.name || (existing && existing.name) || "",
          description: body.description || (existing && existing.description) || "",
          status: body.status || (existing && existing.status) || "unknown",
          gitRepo: body.gitRepo || (existing && existing.gitRepo) || null,
          sandboxId: body.sandboxId || (existing && existing.sandboxId) || null,
          bridgeUrl: body.bridgeUrl || (existing && existing.bridgeUrl) || null,
          bridgeToken: body.bridgeToken !== undefined ? body.bridgeToken : (existing && existing.bridgeToken) || null,
          proxyBaseUrl: body.proxyBaseUrl || (existing && existing.proxyBaseUrl) || null,
          proxyAuthToken: body.proxyAuthToken || (existing && existing.proxyAuthToken) || null,
          createdAt: (existing && existing.createdAt) || body.createdAt || now,
          updatedAt: now,
        };
        projects.set(project.id, project);
        persistProjects();
        return sendJson(res, existing ? 200 : 201, project);
      }).catch(function (err) {
        return sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  // GET /projects/:id/threads
  var projThreadsMatch = urlPath.match(/^\\/projects\\/([^\\/]+)\\/threads\\/?$/);
  if (projThreadsMatch && method === "GET") {
    var pid = projThreadsMatch[1];
    var list = [];
    threads.forEach(function (t) { if (t.projectId === pid) list.push(t); });
    list.sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); });
    return sendJson(res, 200, list);
  }

  // /projects/:id (single project CRUD)
  var projMatch = urlPath.match(/^\\/projects\\/([^\\/]+)\\/?$/);
  if (projMatch) {
    var id = projMatch[1];
    if (method === "GET") {
      var p = projects.get(id);
      if (!p) return sendJson(res, 404, { error: "Project not found" });
      return sendJson(res, 200, p);
    }
    if (method === "PUT") {
      return readBody(req).then(function (body) {
        var existing = projects.get(id);
        if (!existing) return sendJson(res, 404, { error: "Project not found" });
        var updated = Object.assign({}, existing, body, { id: id, updatedAt: new Date().toISOString() });
        projects.set(id, updated);
        persistProjects();
        return sendJson(res, 200, updated);
      }).catch(function (err) {
        return sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      });
    }
    if (method === "DELETE") {
      var existed = projects.delete(id);
      persistProjects();
      return sendJson(res, 200, { ok: true, deleted: existed });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  // ── Threads CRUD ─────────────────────────

  if (urlPath === "/threads" || urlPath === "/threads/") {
    if (method === "POST") {
      return readBody(req).then(function (body) {
        if (!body.id) return sendJson(res, 400, { error: "Missing thread id" });
        var now = new Date().toISOString();
        var existing = threads.get(body.id);
        var thread = {
          id: body.id,
          projectId: body.projectId || (existing && existing.projectId) || "",
          title: body.title || (existing && existing.title) || "",
          status: body.status || (existing && existing.status) || "unknown",
          agentType: body.agentType || (existing && existing.agentType) || null,
          model: body.model || (existing && existing.model) || null,
          createdAt: (existing && existing.createdAt) || body.createdAt || now,
          updatedAt: now,
        };
        threads.set(thread.id, thread);
        persistThreads();
        return sendJson(res, existing ? 200 : 201, thread);
      }).catch(function (err) {
        return sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  // GET/DELETE /threads/:id and POST/GET /threads/:id/messages
  var threadMsgMatch = urlPath.match(/^\\/threads\\/([^\\/]+)\\/messages\\/?$/);
  if (threadMsgMatch) {
    var tid = threadMsgMatch[1];
    if (method === "GET") {
      return sendJson(res, 200, messagesMap.get(tid) || []);
    }
    if (method === "POST") {
      return readBody(req).then(function (body) {
        if (!Array.isArray(body)) return sendJson(res, 400, { error: "Expected array of messages" });
        messagesMap.set(tid, body);
        persistMessages();
        return sendJson(res, 200, { ok: true, count: body.length });
      }).catch(function (err) {
        return sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  var threadMatch = urlPath.match(/^\\/threads\\/([^\\/]+)\\/?$/);
  if (threadMatch) {
    var tid = threadMatch[1];
    if (method === "GET") {
      var t = threads.get(tid);
      if (!t) return sendJson(res, 404, { error: "Thread not found" });
      return sendJson(res, 200, t);
    }
    if (method === "DELETE") {
      var existed = threads.delete(tid);
      messagesMap.delete(tid);
      persistThreads();
      persistMessages();
      return sendJson(res, 200, { ok: true, deleted: existed });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  // ── Prompt execution ─────────────────────

  if (urlPath === "/prompts" || urlPath === "/prompts/") {
    if (method === "POST") {
      return readBody(req).then(function (body) {
        if (!body.projectId || !body.prompt) {
          return sendJson(res, 400, { error: "Missing projectId or prompt" });
        }
        var proj = projects.get(body.projectId);
        if (!proj || !proj.bridgeUrl) {
          return sendJson(res, 400, { error: "Project not found or no bridge connection" });
        }
        var tid = body.threadId;
        if (!tid) {
          tid = crypto.randomBytes(16).toString("hex");
          var now = new Date().toISOString();
          threads.set(tid, {
            id: tid, projectId: body.projectId,
            title: body.prompt.slice(0, 100), status: "running",
            agentType: "build", model: null,
            createdAt: now, updatedAt: now,
          });
          persistThreads();
        }
        // Store user message
        var existing = messagesMap.get(tid) || [];
        existing.push({
          id: crypto.randomBytes(16).toString("hex"),
          taskId: tid, role: "user",
          content: [{ type: "text", text: body.prompt }],
          metadata: null, createdAt: new Date().toISOString(),
        });
        messagesMap.set(tid, existing);
        persistMessages();

        // Update thread status
        var thread = threads.get(tid);
        if (thread) { thread.status = "running"; thread.updatedAt = new Date().toISOString(); threads.set(tid, thread); persistThreads(); }

        console.log("[projects-api] Executing prompt on thread " + tid.slice(0, 8) + " via bridge");
        executePrompt(body.projectId, tid, body.prompt);
        return sendJson(res, 201, { ok: true, threadId: tid });
      }).catch(function (err) {
        return sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  var promptStatusMatch = urlPath.match(/^\\/prompts\\/status\\/([^\\/]+)\\/?$/);
  if (promptStatusMatch && method === "GET") {
    var tid = promptStatusMatch[1];
    var agent = runningAgents.get(tid);
    return sendJson(res, 200, { running: !!agent, status: agent ? agent.status : "idle" });
  }

  sendJson(res, 404, { error: "Not found" });
});

// ── Startup ──────────────────────────────────────────

loadMap(PROJECTS_FILE, projects);
loadMap(THREADS_FILE, threads);
loadMessagesFromDisk();
console.log("[projects-api] Loaded " + projects.size + " projects, " + threads.size + " threads");

server.listen(PORT, "0.0.0.0", function () {
  console.log("[projects-api] listening on port " + PORT);
});
`;
}
