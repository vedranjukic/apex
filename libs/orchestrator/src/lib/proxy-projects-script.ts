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

var projects = new Map();
var threads = new Map();
var messagesMap = new Map();

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

function persistProjects() {
  persistFile(PROJECTS_FILE, JSON.stringify(Array.from(projects.values()), null, 2));
}

function persistThreads() {
  persistFile(THREADS_FILE, JSON.stringify(Array.from(threads.values()), null, 2));
}

function persistMessages() {
  var obj = {};
  messagesMap.forEach(function (msgs, key) { obj[key] = msgs; });
  persistFile(MESSAGES_FILE, JSON.stringify(obj));
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

  // All API routes below require auth
  if (!checkAuth(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  console.log("[projects-api] " + method + " " + urlPath);

  // ── Projects CRUD ────────────────────────

  if (urlPath === "/projects" || urlPath === "/projects/") {
    if (method === "GET") {
      return sendJson(res, 200, Array.from(projects.values()));
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
