package sandbox

import (
	"fmt"
	"strings"
)

const bridgePort = 8080

// GenerateBridgeScript returns the JavaScript source for bridge.js
// that runs inside a Daytona sandbox. Mirrors the TypeScript
// getBridgeScript() in libs/orchestrator/src/lib/bridge-script.ts.
// Uses OpenCode in serve mode -- the bridge starts opencode serve once
// and communicates via HTTP API + SSE event stream.
func GenerateBridgeScript(port int, projectDir string) string {
	safeProjDir := strings.ReplaceAll(projectDir, `"`, `\"`)

	return fmt.Sprintf(`const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn, execSync } = require("child_process");
const pty = require("node-pty");
const crypto = require("crypto");

const PORT = %d;
const PROJECT_DIR = "%s" || process.env.HOME || "/home/daytona";
const MAX_SCROLLBACK = 5000;
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "";
const DAYTONA_API_URL = (process.env.DAYTONA_API_URL || "https://app.daytona.io/api").replace(/\/$/, "");
const SANDBOX_ID = process.env.DAYTONA_SANDBOX_ID || "";
const https = require("https");
const urlMod = require("url");

let state = { ws: null };
const threadToSession = new Map();
const sessionToThread = new Map();
const activeThreads = new Set();
const sessionCosts = new Map();
let ocServeProc = null;
let sseReq = null;
const pendingAskUser = new Map();

const terminals = new Map();

function createTerminalPty(terminalId, name, cols, rows, cwd, command) {
  if (terminals.has(terminalId)) {
    return { error: "Terminal already exists: " + terminalId };
  }

  const shell = command || (process.env.SHELL || "bash");
  const args = command ? ["-c", command] : [];
  const ptyProcess = pty.spawn(command ? "bash" : shell, args, {
    name: "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd || PROJECT_DIR,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const entry = {
    pty: ptyProcess,
    scrollback: [],
    name: name || "Terminal " + (terminals.size + 1),
    cols: cols || 80,
    rows: rows || 24,
  };
  terminals.set(terminalId, entry);

  ptyProcess.onData((data) => {
    entry.scrollback.push(data);
    if (entry.scrollback.length > MAX_SCROLLBACK) {
      entry.scrollback.shift();
    }
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({
        type: "terminal_output",
        terminalId: terminalId,
        data: data,
      }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    log("\u{1F6AA}", "Terminal " + terminalId + " exited with code " + exitCode);
    terminals.delete(terminalId);
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({
        type: "terminal_exit",
        terminalId: terminalId,
        exitCode: exitCode,
      }));
    }
  });

  log("\u{1F4BB}", "Terminal created: " + terminalId + " (" + entry.name + ")");
  return { terminalId, name: entry.name };
}

function getTerminalsList() {
  const list = [];
  for (const [id, entry] of terminals) {
    list.push({
      id: id,
      name: entry.name,
      cols: entry.cols,
      rows: entry.rows,
      scrollback: entry.scrollback.join(""),
    });
  }
  return list;
}

const path = require("path");
let inotifyProc = null;
const changedDirs = new Set();
let debounceTimer = null;
let watcherRestartDelay = 1000;
const WATCHER_MAX_RESTART_DELAY = 30000;
let watcherFatalError = false;

function startFileWatcher() {
  if (inotifyProc || watcherFatalError) return;
  try {
    inotifyProc = spawn("inotifywait", [
      "-mr", "--format", "%%e %%w%%f", "-e", "create,delete,move,modify",
      "--exclude", "(/\\.git/|/node_modules/)",
      PROJECT_DIR,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    inotifyProc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sp = trimmed.indexOf(" ");
        if (sp === -1) continue;
        const ev = trimmed.substring(0, sp);
        const fp = trimmed.substring(sp + 1).replace(/\/$/, "");
        const pd = path.dirname(fp);
        if (pd) changedDirs.add(pd);
        if (ev.includes("ISDIR") && (ev.includes("CREATE") || ev.includes("MOVED_TO"))) changedDirs.add(fp);
      }
      if (changedDirs.size > 0) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flushFileChanges, 300);
      }
    });

    inotifyProc.stderr.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg && !msg.startsWith("Setting up watches") && !msg.startsWith("Watches established")) {
        log("\u{1F441}", "inotify stderr: " + msg);
        if (msg.includes("No space left on device") || msg.includes("upper limit on inotify")) {
          log("\u{26A0}", "inotify watch limit reached, restarting watcher");
          if (inotifyProc) { try { inotifyProc.kill(); } catch(e) {} }
        }
      }
    });

    inotifyProc.on("error", (e) => {
      log("\u{274C}", "File watcher error: " + e.message + " — is inotify-tools installed?");
      inotifyProc = null;
      watcherFatalError = true;
    });

    inotifyProc.on("exit", (code) => {
      log("\u{1F441}", "inotifywait exited with code " + code);
      inotifyProc = null;
      setTimeout(function() { watcherRestartDelay = Math.min(watcherRestartDelay * 2, WATCHER_MAX_RESTART_DELAY); startFileWatcher(); }, watcherRestartDelay);
    });

    watcherRestartDelay = 1000;
    log("\u{1F441}", "File watcher (inotifywait) started for " + PROJECT_DIR);
  } catch (e) {
    log("\u{274C}", "File watcher failed: " + e.message + " — is inotify-tools installed?");
    watcherFatalError = true;
  }
}

function flushFileChanges() {
  if (changedDirs.size === 0) return;
  if (state.ws && state.ws.readyState === 1) {
    const dirs = Array.from(changedDirs);
    changedDirs.clear();
    state.ws.send(JSON.stringify({ type: "file_changed", dirs: dirs }));
  } else {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushFileChanges, 1000);
  }
}

startFileWatcher();

function log(emoji, msg) {
  console.log(new Date().toISOString() + " " + emoji + " " + msg);
}

function emitAgentMessage(threadId, data) {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "claude_message", threadId: threadId, data: data }));
  }
}
function emitAgentExit(threadId, code) {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "claude_exit", threadId: threadId, code: code }));
  }
}
function emitAgentError(threadId, error) {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "claude_error", threadId: threadId, error: error }));
  }
}

// ══════════════════════════════════════════════════════
// ── OpenCode Serve Adapter ──────────────────────────
// ══════════════════════════════════════════════════════
const OC_PORT = 4096;
const TOOL_NAME_MAP = { bash: "Bash", read: "Read", glob: "Glob", grep: "Grep", apply_patch: "Write", write: "Write", edit: "Edit", todowrite: "TodoWrite", todo_write: "TodoWrite", websearch: "WebSearch", web_search: "WebSearch", webfetch: "WebFetch", web_fetch: "WebFetch", task: "Task" };

function ocFetch(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: "127.0.0.1", port: OC_PORT, path: urlPath, method: method, headers: {} };
    if (body) opts.headers["Content-Type"] = "application/json";
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        if (res.statusCode === 204) { resolve(null); return; }
        if (res.statusCode >= 400) { reject(new Error("HTTP " + res.statusCode + ": " + data)); return; }
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function loadDotEnv(dir) {
  try {
    const fs = require("fs");
    const content = fs.readFileSync(dir + "/.env", "utf8");
    const vars = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      vars[trimmed.substring(0, eq).trim()] = trimmed.substring(eq + 1).trim();
    }
    return vars;
  } catch { return {}; }
}

function startOpenCodeServe() {
  if (ocServeProc) return;
  log("\u{1F680}", "Starting opencode serve on port " + OC_PORT);
  const ocBin = "/home/daytona/.opencode/bin/opencode";
  const dotEnvVars = loadDotEnv(PROJECT_DIR);
  const serveEnv = { ...process.env, ...dotEnvVars, HOME: "/home/daytona" };
  ocServeProc = spawn(ocBin, ["serve", "--port", String(OC_PORT), "--hostname", "127.0.0.1"], {
    cwd: PROJECT_DIR,
    env: serveEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  ocServeProc.stdout.on("data", (d) => log("\u{1F916}", "oc-serve: " + d.toString().trim()));
  ocServeProc.stderr.on("data", (d) => log("\u{1F916}", "oc-serve err: " + d.toString().trim()));
  ocServeProc.on("exit", (code) => {
    log("\u{26A0}", "opencode serve exited code=" + code);
    ocServeProc = null;
    setTimeout(() => { if (!ocServeProc) startOpenCodeServe(); }, 3000);
  });
  ocServeProc.on("error", (err) => {
    log("\u{274C}", "opencode serve spawn error: " + err.message);
    ocServeProc = null;
  });
  pollHealth(0);
}

function pollHealth(attempt) {
  if (attempt >= 60) { log("\u{274C}", "opencode serve health timed out"); return; }
  setTimeout(() => {
    ocFetch("GET", "/global/health", null)
      .then((res) => {
        if (res && res.healthy) {
          log("\u{2705}", "opencode serve healthy v=" + (res.version || "?"));
          connectSSE();
        } else { pollHealth(attempt + 1); }
      })
      .catch(() => pollHealth(attempt + 1));
  }, attempt === 0 ? 500 : 1000);
}

function connectSSE() {
  if (sseReq) { try { sseReq.kill(); } catch {} sseReq = null; }
  log("\u{1F4E1}", "Connecting SSE /event via curl");
  const proc = spawn("curl", ["-s", "-N", "http://127.0.0.1:" + OC_PORT + "/event"], { stdio: ["ignore", "pipe", "pipe"] });
  sseReq = proc;
  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const blocks = buf.split("\n\n");
    buf = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split("\n");
      let evType = "";
      let dataLines = [];
      for (const l of lines) {
        if (l.startsWith("event:")) evType = l.slice(6).trim();
        else if (l.startsWith("data:")) dataLines.push(l.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;
      try {
        const parsed = JSON.parse(dataLines.join(""));
        if (!evType && parsed.type) evType = parsed.type;
        if (!evType) continue;
        handleSSEEvent(evType, parsed);
      } catch (e) { log("\u{26A0}", "SSE parse error " + evType + ": " + e.message); }
    }
  });
  proc.stderr.on("data", (d) => { const m = d.toString().trim(); if (m) log("\u{26A0}", "SSE curl stderr: " + m); });
  proc.on("exit", (code) => { sseReq = null; log("\u{26A0}", "SSE curl exited code=" + code + ", reconnecting..."); setTimeout(connectSSE, 2000); });
  proc.on("error", (e) => { sseReq = null; log("\u{26A0}", "SSE curl error: " + e.message); setTimeout(connectSSE, 3000); });
}

function handleSSEEvent(evType, data) {
  const props = data.properties || data;
  if (evType === "permission.updated") {
    const sessionId = props.sessionID || props.id;
    const permId = props.permissionID || props.id;
    if (sessionId && permId) {
      log("\u{1F513}", "Auto-approving permission " + permId + " for session " + sessionId);
      ocFetch("POST", "/session/" + sessionId + "/permissions/" + permId, { response: true }).catch((e) => {
        log("\u{26A0}", "Permission approval failed: " + (e.message || String(e)));
      });
    }
  }
}

async function sendPrompt(threadId, prompt, agent, model, sessionId) {
  const ocAgent = agent || "build";
  const ocModel = model || "";
  log("\u{1F916}", "Sending prompt thread=" + threadId + " agent=" + ocAgent + " model=" + (ocModel || "default"));

  let ocSessionId = threadToSession.get(threadId);
  if (!ocSessionId) {
    const sess = await ocFetch("POST", "/session", { title: threadId });
    ocSessionId = sess.id;
    log("\u{1F4DD}", "Created session " + ocSessionId + " for thread " + threadId);
  }

  const oldThread = sessionToThread.get(ocSessionId);
  if (oldThread && oldThread !== threadId) threadToSession.delete(oldThread);
  const oldSession = threadToSession.get(threadId);
  if (oldSession && oldSession !== ocSessionId) sessionToThread.delete(oldSession);
  threadToSession.set(threadId, ocSessionId);
  sessionToThread.set(ocSessionId, threadId);
  activeThreads.add(threadId);
  sessionCosts.set(ocSessionId, 0);

  emitAgentMessage(threadId, { type: "system", subtype: "init", session_id: ocSessionId, tools: [], model: ocModel || ocAgent, cwd: PROJECT_DIR });

  let modelObj;
  if (ocModel && ocModel.includes("/")) {
    const si = ocModel.indexOf("/");
    modelObj = { providerID: ocModel.substring(0, si), modelID: ocModel.substring(si + 1) };
  }

  await ocFetch("POST", "/session/" + ocSessionId + "/prompt_async", {
    parts: [{ type: "text", text: prompt }],
    agent: ocAgent,
    model: modelObj,
  });
  log("\u{1F916}", "Prompt dispatched to session " + ocSessionId);
  pollSession(threadId, ocSessionId);
}

function pollSession(threadId, sessionId) {
  const emittedParts = new Set();
  let lastCost = 0;
  const poll = () => {
    if (!activeThreads.has(threadId)) return;
    ocFetch("GET", "/session/" + sessionId + "/message?limit=20", null)
      .then((msgs) => {
        if (!Array.isArray(msgs)) { setTimeout(poll, 1500); return; }
        for (const msg of msgs) {
          if (!msg.parts || !msg.info || msg.info.role !== "assistant") continue;
          for (const part of msg.parts) {
            const pid = part.id;
            if (!pid || emittedParts.has(pid)) continue;
            if (part.type === "text" && part.text) {
              emittedParts.add(pid);
              emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: "", content: [{ type: "text", text: part.text }], stop_reason: "end_turn" } });
            } else if (part.type === "reasoning" && part.text) {
              emittedParts.add(pid);
              emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: "", content: [{ type: "thinking", thinking: part.text }], stop_reason: null } });
            } else if (part.type === "tool") {
              const s = part.state || {};
              const tn = part.tool || "unknown";
              const nn = TOOL_NAME_MAP[tn] || tn;
              const toolId = part.callID || part.id;
              if (s.status === "completed") {
                emittedParts.add(pid);
                emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: "", content: [
                  { type: "tool_use", id: toolId, name: nn, input: s.input || {} },
                  { type: "tool_result", tool_use_id: toolId, content: typeof s.output === "string" ? s.output : JSON.stringify(s.output || "") },
                ], stop_reason: "tool_use" } });
              } else if (s.status === "running" && !emittedParts.has(pid + ":running")) {
                emittedParts.add(pid + ":running");
                emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: "", content: [
                  { type: "tool_use", id: toolId, name: nn, input: s.input || {} },
                ], stop_reason: "tool_use" } });
              }
            } else if (part.type === "step-finish") {
              emittedParts.add(pid);
              lastCost += part.cost || 0;
              if (part.reason === "stop") {
                const tk = part.tokens || {};
                emitAgentMessage(threadId, { type: "result", subtype: "success", is_error: false, duration_ms: 0, num_turns: 1, result: "", session_id: sessionId, total_cost_usd: lastCost, usage: { input_tokens: tk.input || 0, output_tokens: tk.output || 0 } });
              }
            }
          }
        }
        return ocFetch("GET", "/session/status", null);
      })
      .then((statuses) => {
        if (!statuses) return;
        const st = statuses[sessionId];
        if (!st || st.type === "idle") {
          log("\u{1F916}", "Session " + sessionId + " idle, emitting exit");
          activeThreads.delete(threadId);
          emitAgentExit(threadId, 0);
          return;
        }
        setTimeout(poll, 1500);
      })
      .catch((e) => {
        log("\u{26A0}", "Poll error: " + (e.message || String(e)));
        setTimeout(poll, 3000);
      });
  };
  setTimeout(poll, 1000);
}

startOpenCodeServe();

// ── LSP Manager ──────────────────────────────────────
const LSP_COMMANDS = {
  typescript: ["typescript-language-server", ["--stdio"]],
  javascript: ["typescript-language-server", ["--stdio"]],
  python: ["pylsp", []],
  go: ["gopls", []],
  rust: ["rust-analyzer", []],
  java: ["jdtls", ["/tmp/jdtls-workspace"]],
};
const lspServers = new Map();
let lspRequestId = 1;

function lspSend(proc, msg) {
  const json = JSON.stringify(msg);
  const header = "Content-Length: " + Buffer.byteLength(json) + "\r\n\r\n";
  proc.stdin.write(header + json);
}

function createLspParser(onMessage) {
  let buffer = Buffer.alloc(0);
  let contentLength = -1;
  return function feed(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (contentLength === -1) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
        contentLength = parseInt(match[1], 10);
        buffer = buffer.slice(headerEnd + 4);
      }
      if (buffer.length < contentLength) break;
      const body = buffer.slice(0, contentLength).toString("utf8");
      buffer = buffer.slice(contentLength);
      contentLength = -1;
      try { onMessage(JSON.parse(body)); } catch (e) { log("\u{274C}", "LSP parse error: " + e); }
    }
  };
}

function emitLspStatus(language, status, error) {
  if (state.ws && state.ws.readyState === 1) {
    const msg = { type: "lsp_status", language, status };
    if (error) msg.error = error;
    state.ws.send(JSON.stringify(msg));
  }
}

function getOrStartLsp(language) {
  const existing = lspServers.get(language);
  if (existing && existing.status !== "stopped" && existing.status !== "error") {
    if (existing.status === "ready") return Promise.resolve(existing);
    return existing.readyPromise;
  }
  const cmdEntry = LSP_COMMANDS[language];
  if (!cmdEntry) return Promise.reject(new Error("No LSP server for language: " + language));
  const [cmd, args] = cmdEntry;
  let resolveReady, rejectReady;
  const readyPromise = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const entry = { proc: null, status: "starting", language, readyPromise, pendingRequests: new Map(), capabilities: null };
  lspServers.set(language, entry);
  emitLspStatus(language, "starting");
  log("\u{1F680}", "Starting LSP for " + language + ": " + cmd);
  try {
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_DIR });
    entry.proc = proc;
    const parser = createLspParser(function(msg) {
      if (msg.id !== undefined && entry.pendingRequests.has(msg.id)) {
        const cb = entry.pendingRequests.get(msg.id); entry.pendingRequests.delete(msg.id); cb(msg);
      }
      if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: "lsp_response", language, jsonrpc: msg }));
    });
    proc.stdout.on("data", parser);
    proc.stderr.on("data", (d) => { log("\u{1F4DD}", "LSP " + language + " stderr: " + d.toString().trim()); });
    proc.on("error", (e) => { entry.status = "error"; emitLspStatus(language, "error", e.message); rejectReady(e); });
    proc.on("exit", (code) => {
      entry.status = "stopped"; emitLspStatus(language, "stopped");
      for (const [id, cb] of entry.pendingRequests) cb({ id, error: { code: -32600, message: "LSP server exited" } });
      entry.pendingRequests.clear();
    });
    const initId = lspRequestId++;
    lspSend(proc, { jsonrpc: "2.0", id: initId, method: "initialize", params: {
      processId: process.pid, rootUri: "file://" + PROJECT_DIR,
      capabilities: { textDocument: { hover: { contentFormat: ["markdown","plaintext"] }, completion: { completionItem: { snippetSupport: false } }, definition: {}, references: {}, documentSymbol: {}, publishDiagnostics: { relatedInformation: true } }, workspace: { workspaceFolders: true } },
      workspaceFolders: [{ uri: "file://" + PROJECT_DIR, name: "workspace" }],
    }});
    entry.pendingRequests.set(initId, function(resp) {
      if (resp.error) { entry.status = "error"; emitLspStatus(language, "error", resp.error.message || "Init failed"); rejectReady(new Error(resp.error.message)); return; }
      entry.capabilities = resp.result ? resp.result.capabilities : {};
      lspSend(proc, { jsonrpc: "2.0", method: "initialized", params: {} });
      entry.status = "ready"; emitLspStatus(language, "ready"); resolveReady(entry);
    });
    setTimeout(function() { if (entry.status === "starting") { entry.status = "error"; emitLspStatus(language, "error", "Init timeout"); rejectReady(new Error("LSP init timeout")); } }, 30000);
  } catch (e) { entry.status = "error"; emitLspStatus(language, "error", e.message); rejectReady(e); }
  return readyPromise;
}

function lspRequest(language, method, params) {
  return getOrStartLsp(language).then(function(entry) {
    return new Promise(function(resolve) {
      const id = lspRequestId++;
      entry.pendingRequests.set(id, resolve);
      lspSend(entry.proc, { jsonrpc: "2.0", id, method, params });
      setTimeout(function() { if (entry.pendingRequests.has(id)) { entry.pendingRequests.delete(id); resolve({ id, error: { code: -32001, message: "LSP request timeout" } }); } }, 15000);
    });
  });
}

function lspNotify(language, method, params) {
  return getOrStartLsp(language).then(function(entry) { lspSend(entry.proc, { jsonrpc: "2.0", method, params }); });
}

function detectLanguageFromUri(uri) {
  const ext = (uri.split(".").pop() || "").toLowerCase();
  return { ts:"typescript",tsx:"typescript",mts:"typescript",cts:"typescript",js:"javascript",jsx:"javascript",mjs:"javascript",cjs:"javascript",py:"python",pyw:"python",go:"go",rs:"rust",java:"java" }[ext] || null;
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/internal/terminal-create") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { name, command, cols, rows, cwd } = JSON.parse(body);
        const terminalId = "mcp-" + crypto.randomUUID().slice(0, 8);
        const result = createTerminalPty(terminalId, name, cols || 80, rows || 24, cwd, command);
        if (result.error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else {
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({
              type: "terminal_created",
              terminalId: terminalId,
              name: result.name,
            }));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/internal/terminal-write") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { terminalId, input } = JSON.parse(body);
        const entry = terminals.get(terminalId);
        if (!entry) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Terminal not found" }));
          return;
        }
        entry.pty.write(input);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/internal/terminal-close") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { terminalId } = JSON.parse(body);
        const entry = terminals.get(terminalId);
        if (!entry) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Terminal not found" }));
          return;
        }
        entry.pty.kill();
        terminals.delete(terminalId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/internal/terminal-list") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ terminals: getTerminalsList() }));
    return;
  }

  if (req.method === "POST" && req.url === "/internal/terminal-read") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { terminalId, lines } = JSON.parse(body);
        const entry = terminals.get(terminalId);
        if (!entry) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Terminal not found" }));
          return;
        }
        const chunks = lines ? entry.scrollback.slice(-lines) : entry.scrollback;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ terminalId, output: chunks.join("") }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/internal/preview-url") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const { port } = JSON.parse(body);
        if (!port) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "port is required" }));
          return;
        }
        if (!DAYTONA_API_KEY || !SANDBOX_ID) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Daytona credentials not configured" }));
          return;
        }
        const apiUrl = DAYTONA_API_URL + "/sandbox/" + SANDBOX_ID + "/ports/" + port + "/preview-url";
        const parsed = urlMod.parse(apiUrl);
        const reqOpts = {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.path,
          method: "GET",
          headers: { "Authorization": "Bearer " + DAYTONA_API_KEY },
        };
        const apiReq = https.request(reqOpts, (apiRes) => {
          let apiBody = "";
          apiRes.on("data", (c) => apiBody += c);
          apiRes.on("end", () => {
            if (apiRes.statusCode !== 200) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Daytona API error (HTTP " + apiRes.statusCode + "): " + apiBody }));
              return;
            }
            try {
              const result = JSON.parse(apiBody);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ url: result.url, token: result.token }));
            } catch (e) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid API response" }));
            }
          });
        });
        apiReq.on("error", (e) => {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "API request failed: " + e.message }));
        });
        apiReq.end();
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/internal/ask-user") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const questionId = "ask-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        const activeThreadId = payload.threadId !== "default" ? payload.threadId : (activeThreads.size > 0 ? Array.from(activeThreads).pop() : "default");
        if (state.ws && state.ws.readyState === 1) {
          state.ws.send(JSON.stringify({ type: "claude_message", threadId: activeThreadId, data: { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: questionId, name: "AskUserQuestion", input: payload.input || {} }], stop_reason: "tool_use" } } }));
          state.ws.send(JSON.stringify({ type: "ask_user_pending", threadId: activeThreadId, questionId: questionId }));
        }
        const ASK_TIMEOUT_MS = 300000;
        const entry = { resolve: null, timer: null };
        entry.timer = setTimeout(() => {
          pendingAskUser.delete(questionId);
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({ type: "ask_user_resolved", threadId: activeThreadId, questionId: questionId }));
          }
          res.writeHead(408, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "User did not respond in time" }));
        }, ASK_TIMEOUT_MS);
        pendingAskUser.set(questionId, { resolve: (answer) => {
          clearTimeout(entry.timer);
          pendingAskUser.delete(questionId);
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({ type: "ask_user_resolved", threadId: activeThreadId, questionId: questionId }));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ answer }));
        } });
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/internal/lsp-request") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const { language, method, params, file } = JSON.parse(body);
        const lang = language || (file ? detectLanguageFromUri(file) : null);
        if (!lang) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Cannot detect language" })); return; }
        lspRequest(lang, method, params).then((resp) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(resp)); })
          .catch((e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); });
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (req.method === "POST" && req.url === "/internal/lsp-notify") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const { language, method, params, file } = JSON.parse(body);
        const lang = language || (file ? detectLanguageFromUri(file) : null);
        if (!lang) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Cannot detect language" })); return; }
        lspNotify(lang, method, params).then(() => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); })
          .catch((e) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); });
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  res.writeHead(200);
  res.end("bridge-ok");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  log("\u{1F517}", "Orchestrator connected");
  state.ws = ws;
  ws.send(JSON.stringify({ type: "bridge_ready", port: PORT }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "start_claude") {
        (async () => {
          const threadId = msg.threadId || "default";
          const existingSession = threadToSession.get(threadId);
          if (existingSession && activeThreads.has(threadId)) {
            log("\u{1F916}", "Aborting running session for thread " + threadId);
            try { await ocFetch("POST", "/session/" + existingSession + "/abort", {}); } catch {}
            activeThreads.delete(threadId);
          }
          try {
            await sendPrompt(threadId, msg.prompt, msg.agent || msg.agentType, msg.model, msg.sessionId);
          } catch (e) { emitAgentError(threadId, e.message || String(e)); }
        })().catch(e => log("\u{274C}", "start_claude error: " + e));

      } else if (msg.type === "claude_user_answer") {
        let pending = pendingAskUser.get(msg.toolUseId);
        if (!pending && msg.threadId) {
          for (const [, entry] of pendingAskUser) {
            if (entry.threadId === msg.threadId) { pending = entry; break; }
          }
        }
        if (pending) { pending.resolve(msg.answer); }
        else { emitAgentError(msg.threadId, "No pending ask_user to receive answer"); }

      } else if (msg.type === "stop_claude") {
        (async () => {
          if (msg.threadId) {
            const sid = threadToSession.get(msg.threadId);
            if (sid) { try { await ocFetch("POST", "/session/" + sid + "/abort", {}); } catch {} }
            activeThreads.delete(msg.threadId);
          } else {
            for (const tid of activeThreads) {
              const sid = threadToSession.get(tid);
              if (sid) { try { await ocFetch("POST", "/session/" + sid + "/abort", {}); } catch {} }
            }
            activeThreads.clear();
          }
        })().catch(e => log("\u{274C}", "stop_claude error: " + e));

      } else if (msg.type === "terminal_create") {
        const result = createTerminalPty(
          msg.terminalId, msg.name, msg.cols, msg.rows, msg.cwd, msg.command
        );
        if (result.error) {
          ws.send(JSON.stringify({ type: "terminal_error", terminalId: msg.terminalId, error: result.error }));
        } else {
          ws.send(JSON.stringify({ type: "terminal_created", terminalId: msg.terminalId, name: result.name }));
        }

      } else if (msg.type === "terminal_input") {
        const entry = terminals.get(msg.terminalId);
        if (entry) { entry.pty.write(msg.data); }

      } else if (msg.type === "terminal_resize") {
        const entry = terminals.get(msg.terminalId);
        if (entry) {
          entry.pty.resize(msg.cols, msg.rows);
          entry.cols = msg.cols;
          entry.rows = msg.rows;
        }

      } else if (msg.type === "terminal_close") {
        const entry = terminals.get(msg.terminalId);
        if (entry) {
          entry.pty.kill();
          terminals.delete(msg.terminalId);
        }

      } else if (msg.type === "terminal_list") {
        ws.send(JSON.stringify({ type: "terminal_list", terminals: getTerminalsList() }));

      } else if (msg.type === "lsp_data") {
        const lang = msg.language;
        if (lang && msg.jsonrpc) {
          const method = msg.jsonrpc.method;
          if (method === "initialize") {
            getOrStartLsp(lang).then(function(entry) {
              ws.send(JSON.stringify({ type: "lsp_response", language: lang, jsonrpc: { jsonrpc: "2.0", id: msg.jsonrpc.id, result: { capabilities: entry.capabilities || {} } } }));
            }).catch(function(e) {
              ws.send(JSON.stringify({ type: "lsp_response", language: lang, jsonrpc: { jsonrpc: "2.0", id: msg.jsonrpc.id, error: { code: -32600, message: e.message } } }));
            });
          } else if (method === "initialized") {
            // Already sent by bridge during init; ignore from client
          } else {
            getOrStartLsp(lang).then(function(entry) { lspSend(entry.proc, msg.jsonrpc); })
              .catch(function(e) { if (msg.jsonrpc.id !== undefined) ws.send(JSON.stringify({ type: "lsp_response", language: lang, jsonrpc: { jsonrpc: "2.0", id: msg.jsonrpc.id, error: { code: -32600, message: e.message } } })); });
          }
        }

      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (e) { log("\u{274C}", "Parse error: " + e); }
  });

  ws.on("close", () => {
    log("\u{1F50C}", "Orchestrator disconnected");
    for (const tid of activeThreads) {
      const sid = threadToSession.get(tid);
      if (sid) { ocFetch("POST", "/session/" + sid + "/abort", {}).catch(() => {}); }
    }
    activeThreads.clear();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log("\u{2705}", "Bridge ready on port " + PORT);
});`, port, safeProjDir)
}

// GenerateMCPTerminalScript returns the JavaScript source for mcp-terminal-server.js.
// Identical to getMcpTerminalScript() in libs/orchestrator/src/lib/mcp-terminal-script.ts.
func GenerateMCPTerminalScript(bridgePort int) string {
	return fmt.Sprintf(`const http = require("http");
const readline = require("readline");

const BRIDGE_PORT = %d;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendResponse(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function bridgeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: "localhost",
      port: BRIDGE_PORT,
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let responseBody = "";
      res.on("data", (c) => responseBody += c);
      res.on("end", () => {
        try { resolve(JSON.parse(responseBody)); }
        catch (e) { resolve({ raw: responseBody }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function bridgeGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "localhost",
      port: BRIDGE_PORT,
      path: path,
      method: "GET",
    }, (res) => {
      let responseBody = "";
      res.on("data", (c) => responseBody += c);
      res.on("end", () => {
        try { resolve(JSON.parse(responseBody)); }
        catch (e) { resolve({ raw: responseBody }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const TOOLS = [
  {
    name: "open_terminal",
    description: "Open a new terminal session visible to the user. Returns the terminalId.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name for the terminal tab" },
        command: { type: "string", description: "Optional command to run immediately" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["name"],
    },
  },
  {
    name: "write_to_terminal",
    description: "Send input to an open terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: { type: "string" },
        input: { type: "string" },
      },
      required: ["terminalId", "input"],
    },
  },
  {
    name: "read_terminal",
    description: "Read recent output from an open terminal.",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: { type: "string" },
        lines: { type: "number" },
      },
      required: ["terminalId"],
    },
  },
  {
    name: "list_terminals",
    description: "List all open terminal sessions.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "close_terminal",
    description: "Close an open terminal session.",
    inputSchema: {
      type: "object",
      properties: { terminalId: { type: "string" } },
      required: ["terminalId"],
    },
  },
  {
    name: "get_preview_url",
    description: "Get the public preview URL for a port running in this sandbox. Use this whenever you start a web server or any HTTP service and need to give the user a URL they can open in their browser. The returned URL is publicly accessible — do NOT use localhost links.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", description: "The port number the service is listening on, e.g. 3000, 5173, 8080" },
      },
      required: ["port"],
    },
  },
  {
    name: "get_plan_format_instructions",
    description: "Get the exact format you MUST use when outputting an implementation plan in Plan mode. Call this before presenting your plan to ensure the UI can detect and display it. Required for Plan mode.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ask_user",
    description: "Ask the user a question and wait for their answer. Use this when you need clarification, want to present options, or need the user to make a decision before proceeding. The tool will BLOCK until the user responds, so only use it when you genuinely need input.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Array of questions to present to the user",
          items: {
            type: "object",
            properties: {
              header: { type: "string", description: "Short header/title for the question" },
              question: { type: "string", description: "The question text to display" },
              options: {
                type: "array",
                description: "Available options for the user to choose from",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Short label for the option" },
                    description: { type: "string", description: "Longer description of what this option means" },
                  },
                  required: ["label"],
                },
              },
              multiSelect: { type: "boolean", description: "Whether the user can select multiple options" },
            },
            required: ["question"],
          },
        },
      },
      required: ["questions"],
    },
  },
];

async function handleRequest(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "terminal-server", version: "1.0.0" },
    });
    return;
  }

  if (method === "notifications/initialized") { return; }

  if (method === "tools/list") {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = params && params.name;
    const args = (params && params.arguments) || {};

    try {
      if (toolName === "open_terminal") {
        const result = await bridgeRequest("/internal/terminal-create", { name: args.name, command: args.command, cwd: args.cwd });
        sendResponse(id, result.error
          ? { content: [{ type: "text", text: "Error: " + result.error }], isError: true }
          : { content: [{ type: "text", text: "Terminal opened: " + result.name + " (id: " + result.terminalId + ")" }] });
      } else if (toolName === "write_to_terminal") {
        const result = await bridgeRequest("/internal/terminal-write", { terminalId: args.terminalId, input: args.input });
        sendResponse(id, result.error
          ? { content: [{ type: "text", text: "Error: " + result.error }], isError: true }
          : { content: [{ type: "text", text: "Input sent to terminal " + args.terminalId }] });
      } else if (toolName === "read_terminal") {
        const result = await bridgeRequest("/internal/terminal-read", { terminalId: args.terminalId, lines: args.lines });
        sendResponse(id, result.error
          ? { content: [{ type: "text", text: "Error: " + result.error }], isError: true }
          : { content: [{ type: "text", text: result.output || "(no output yet)" }] });
      } else if (toolName === "list_terminals") {
        const result = await bridgeGet("/internal/terminal-list");
        const list = (result.terminals || []).map((t) => t.id + " - " + t.name).join("\n") || "(no terminals open)";
        sendResponse(id, result.error
          ? { content: [{ type: "text", text: "Error: " + result.error }], isError: true }
          : { content: [{ type: "text", text: list }] });
      } else if (toolName === "close_terminal") {
        const result = await bridgeRequest("/internal/terminal-close", { terminalId: args.terminalId });
        sendResponse(id, result.error
          ? { content: [{ type: "text", text: "Error: " + result.error }], isError: true }
          : { content: [{ type: "text", text: "Terminal " + args.terminalId + " closed" }] });
      } else if (toolName === "get_preview_url") {
        const result = await bridgeRequest("/internal/preview-url", { port: args.port });
        sendResponse(id, result.error
          ? { content: [{ type: "text", text: "Error: " + result.error }], isError: true }
          : { content: [{ type: "text", text: result.url }] });
      } else if (toolName === "get_plan_format_instructions") {
        const instruction = "When presenting your implementation plan, you MUST wrap the entire plan in fenced code blocks with the language tag \"plan\". Use this exact format:\n\n` + "```" + `plan\n[Your plan content here — use markdown for structure, headings, lists, etc.]\n` + "```" + `\n\nThe UI detects plans ONLY when they use this exact delimiter. Do not use ` + "```" + `md or any other tag.";
        sendResponse(id, { content: [{ type: "text", text: instruction }] });
      } else if (toolName === "ask_user") {
        const result = await bridgeRequest("/internal/ask-user", {
          threadId: "default",
          input: { questions: args.questions },
        });
        if (result.error) {
          sendResponse(id, {
            content: [{ type: "text", text: "User did not respond: " + result.error }],
            isError: true,
          });
        } else {
          sendResponse(id, {
            content: [{ type: "text", text: result.answer || "(no answer)" }],
          });
        }
      } else {
        sendError(id, -32601, "Unknown tool: " + toolName);
      }
    } catch (e) {
      sendResponse(id, { content: [{ type: "text", text: "Error calling bridge: " + e.message }], isError: true });
    }
    return;
  }

  if (id !== undefined) { sendError(id, -32601, "Method not found: " + method); }
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const request = JSON.parse(trimmed);
    handleRequest(request);
  } catch (e) {
    process.stderr.write("MCP parse error: " + e + "\n");
  }
});

process.stderr.write("MCP Terminal Server ready (bridge port: " + BRIDGE_PORT + ")\n");`, bridgePort)
}

// GenerateMCPLspScript returns the JavaScript source for mcp-lsp-server.js.
// Identical to getMcpLspScript() in libs/orchestrator/src/lib/mcp-lsp-script.ts.
func GenerateMCPLspScript(bridgePort int) string {
	return fmt.Sprintf(`const http = require("http");
const readline = require("readline");
const path = require("path");
const fs = require("fs");

const BRIDGE_PORT = %d;

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function sendResponse(id, result) { send({ jsonrpc: "2.0", id, result }); }
function sendError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

function bridgeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: "localhost", port: BRIDGE_PORT, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, (res) => {
      let rb = ""; res.on("data", c => rb += c);
      res.on("end", () => { try { resolve(JSON.parse(rb)); } catch { resolve({ raw: rb }); } });
    });
    req.on("error", reject); req.write(data); req.end();
  });
}

function detectLanguage(filePath) {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  return { ts:"typescript",tsx:"typescript",mts:"typescript",cts:"typescript",
    js:"javascript",jsx:"javascript",mjs:"javascript",cjs:"javascript",
    py:"python",pyw:"python",go:"go",rs:"rust",java:"java" }[ext] || null;
}
function fileUri(fp) { return fp.startsWith("file://") ? fp : "file://" + (fp.startsWith("/") ? fp : path.resolve(fp)); }

function formatLocation(loc) {
  if (!loc || !loc.uri) return "(unknown)";
  const fp = loc.uri.replace("file://", "");
  const l = loc.range && loc.range.start ? loc.range.start.line + 1 : 0;
  const c = loc.range && loc.range.start ? loc.range.start.character + 1 : 0;
  return fp + ":" + l + ":" + c;
}
function formatLocations(locs) {
  if (!locs) return "No results";
  const arr = Array.isArray(locs) ? locs : [locs];
  return arr.length === 0 ? "No results" : arr.map(formatLocation).join("\n");
}
function formatHover(r) {
  if (!r || !r.contents) return "No hover information available";
  if (typeof r.contents === "string") return r.contents;
  if (r.contents.value) return r.contents.value;
  if (Array.isArray(r.contents)) return r.contents.map(c => typeof c === "string" ? c : (c.value||"")).join("\n\n");
  return JSON.stringify(r.contents, null, 2);
}
function formatCompletions(r) {
  if (!r) return "No completions";
  const items = r.items || r;
  if (!Array.isArray(items) || items.length === 0) return "No completions";
  return items.slice(0,50).map(i => i.label + (i.detail ? " — " + i.detail : "")).join("\n");
}
function formatSymbols(r, indent) {
  if (!r || !Array.isArray(r) || r.length === 0) return "No symbols found";
  indent = indent || 0;
  return r.map(s => {
    let t = "  ".repeat(indent) + s.name + (s.range ? ":" + (s.range.start.line+1) : "");
    if (s.children && s.children.length) t += "\n" + formatSymbols(s.children, indent+1);
    return t;
  }).join("\n");
}

const TOOLS = [
  { name:"lsp_hover", description:"Get hover info at file:line:col", inputSchema:{ type:"object", properties:{ file:{type:"string"}, line:{type:"number"}, character:{type:"number"} }, required:["file","line","character"] } },
  { name:"lsp_definition", description:"Go to definition at file:line:col", inputSchema:{ type:"object", properties:{ file:{type:"string"}, line:{type:"number"}, character:{type:"number"} }, required:["file","line","character"] } },
  { name:"lsp_references", description:"Find all references at file:line:col", inputSchema:{ type:"object", properties:{ file:{type:"string"}, line:{type:"number"}, character:{type:"number"} }, required:["file","line","character"] } },
  { name:"lsp_diagnostics", description:"Get diagnostics for a file", inputSchema:{ type:"object", properties:{ file:{type:"string"} }, required:["file"] } },
  { name:"lsp_completions", description:"Get completions at file:line:col", inputSchema:{ type:"object", properties:{ file:{type:"string"}, line:{type:"number"}, character:{type:"number"} }, required:["file","line","character"] } },
  { name:"lsp_symbols", description:"List symbols in a file", inputSchema:{ type:"object", properties:{ file:{type:"string"} }, required:["file"] } },
];

async function openDoc(file, lang) {
  const uri = fileUri(file);
  await bridgeRequest("/internal/lsp-notify", {
    language: lang, file, method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: lang || "plaintext", version: 1, text: fs.readFileSync(file, "utf8") } },
  });
  return uri;
}

async function handleRequest(request) {
  const { id, method, params } = request;
  if (method === "initialize") { sendResponse(id, { protocolVersion:"2024-11-05", capabilities:{tools:{}}, serverInfo:{name:"lsp-server",version:"1.0.0"} }); return; }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") { sendResponse(id, { tools: TOOLS }); return; }
  if (method === "tools/call") {
    const tn = params && params.name; const args = (params && params.arguments) || {};
    try {
      const lang = detectLanguage(args.file || "");
      if (tn === "lsp_hover") {
        const uri = await openDoc(args.file, lang);
        const resp = await bridgeRequest("/internal/lsp-request", { language:lang, file:args.file, method:"textDocument/hover", params:{ textDocument:{uri}, position:{line:args.line,character:args.character} } });
        sendResponse(id, { content:[{ type:"text", text: resp.error ? "Error: "+JSON.stringify(resp.error) : formatHover(resp.result) }] });
      } else if (tn === "lsp_definition") {
        const uri = await openDoc(args.file, lang);
        const resp = await bridgeRequest("/internal/lsp-request", { language:lang, file:args.file, method:"textDocument/definition", params:{ textDocument:{uri}, position:{line:args.line,character:args.character} } });
        sendResponse(id, { content:[{ type:"text", text: resp.error ? "Error: "+JSON.stringify(resp.error) : formatLocations(resp.result) }] });
      } else if (tn === "lsp_references") {
        const uri = await openDoc(args.file, lang);
        const resp = await bridgeRequest("/internal/lsp-request", { language:lang, file:args.file, method:"textDocument/references", params:{ textDocument:{uri}, position:{line:args.line,character:args.character}, context:{includeDeclaration:true} } });
        sendResponse(id, { content:[{ type:"text", text: resp.error ? "Error: "+JSON.stringify(resp.error) : formatLocations(resp.result) }] });
      } else if (tn === "lsp_diagnostics") {
        const uri = await openDoc(args.file, lang);
        await new Promise(r => setTimeout(r, 2000));
        const resp = await bridgeRequest("/internal/lsp-request", { language:lang, file:args.file, method:"textDocument/diagnostic", params:{ textDocument:{uri} } });
        sendResponse(id, { content:[{ type:"text", text: resp.error ? "Diagnostics via pull not supported" : ((resp.result && resp.result.items) || []).length === 0 ? "No diagnostics (clean)" : (resp.result.items||[]).map(d => ({1:"Error",2:"Warning",3:"Info",4:"Hint"}[d.severity]||"Diag") + " [" + (d.range?d.range.start.line+1:0) + "]: " + d.message).join("\n") }] });
      } else if (tn === "lsp_completions") {
        const uri = await openDoc(args.file, lang);
        const resp = await bridgeRequest("/internal/lsp-request", { language:lang, file:args.file, method:"textDocument/completion", params:{ textDocument:{uri}, position:{line:args.line,character:args.character} } });
        sendResponse(id, { content:[{ type:"text", text: resp.error ? "Error: "+JSON.stringify(resp.error) : formatCompletions(resp.result) }] });
      } else if (tn === "lsp_symbols") {
        const uri = await openDoc(args.file, lang);
        const resp = await bridgeRequest("/internal/lsp-request", { language:lang, file:args.file, method:"textDocument/documentSymbol", params:{ textDocument:{uri} } });
        sendResponse(id, { content:[{ type:"text", text: resp.error ? "Error: "+JSON.stringify(resp.error) : formatSymbols(resp.result) }] });
      } else { sendError(id, -32601, "Unknown tool: " + tn); }
    } catch (e) { sendResponse(id, { content:[{type:"text",text:"Error: "+e.message}], isError:true }); }
    return;
  }
  if (id !== undefined) sendError(id, -32601, "Method not found: " + method);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const t = line.trim(); if (!t) return;
  try { handleRequest(JSON.parse(t)); } catch (e) { process.stderr.write("MCP LSP parse error: " + e + "\n"); }
});
process.stderr.write("MCP LSP Server ready (bridge port: " + BRIDGE_PORT + ")\n");`, bridgePort)
}
