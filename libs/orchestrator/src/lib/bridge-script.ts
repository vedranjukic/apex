/**
 * Returns the JavaScript source for the bridge server that runs
 * INSIDE a Daytona sandbox. It is uploaded via sandbox.fs.uploadFile().
 *
 * Uses OpenCode as the single agent runtime. Custom agents (build, plan,
 * sisyphus, etc.) and models from any provider are selected via
 * `--agent` and `-m` flags on `opencode run`.
 */
export function getBridgeScript(
  port: number,
  projectDir?: string,
  _agentType?: string,
  _agentConfig?: Record<string, unknown>,
): string {
  const safeProjDir = projectDir ? projectDir.replace(/"/g, '\\"') : '';
  return `const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn, execSync } = require("child_process");
const pty = require("node-pty");
const crypto = require("crypto");

const PORT = ${port};
const PROJECT_DIR = "${safeProjDir}" || process.env.HOME || "/home/daytona";
const MAX_SCROLLBACK = 5000;
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "";
const DAYTONA_API_URL = (process.env.DAYTONA_API_URL || "https://app.daytona.io/api").replace(/\\/$/, "");
const SANDBOX_ID = process.env.DAYTONA_SANDBOX_ID || "";
const https = require("https");
const urlMod = require("url");

let state = { ws: null };
const agentProcesses = new Map();
const terminals = new Map();
const pendingAskUser = new Map();

// ── Logging ──────────────────────────────────────────
function log(emoji, msg) {
  console.log(new Date().toISOString() + " " + emoji + " " + msg);
}

// ── Emit helpers ─────────────────────────────────────
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
// ── OpenCode Agent Adapter ───────────────────────────
// ══════════════════════════════════════════════════════

function spawnOpenCode(threadId, prompt, agent, model, sessionId) {
  const ocModel = model || "";
  const ocAgent = agent || "build";
  log("\\u{1F916}", "Spawning OpenCode for thread " + threadId + " agent=" + ocAgent + " model=" + (ocModel || "default"));
  const ocBin = "/home/daytona/.opencode/bin/opencode";
  const args = ["run", "--format", "json"];
  if (ocAgent) args.push("--agent", ocAgent);
  if (ocModel) args.push("-m", ocModel);
  if (sessionId) args.push("--session", sessionId);
  args.push(prompt);

  log("\\u{1F916}", "OpenCode cmd: " + ocBin + " " + args.join(" ") + " cwd=" + PROJECT_DIR);
  const proc = pty.spawn(ocBin, args, {
    name: "xterm-256color", cols: 200, rows: 50, cwd: PROJECT_DIR,
    env: { ...process.env, HOME: "/home/daytona" },
  });
  let capturedSessionId = null;
  let stepCost = 0;
  let buffer = "";

  proc.onData((d) => {
    buffer += d;
    const lines = buffer.split("\\n");
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.replace(/[\\x00-\\x1f\\x7f]+(\\[\\?[\\d;]*[a-zA-Z])?/g, "").trim();
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (!capturedSessionId && ev.sessionID) {
          capturedSessionId = ev.sessionID;
          const ex = agentProcesses.get(threadId);
          if (ex) ex.sessionId = capturedSessionId;
          emitAgentMessage(threadId, { type: "system", subtype: "init", session_id: capturedSessionId, tools: [], model: ocModel || ocAgent, cwd: PROJECT_DIR });
        }
        if (ev.type === "text") {
          emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: ocModel || ocAgent, content: [{ type: "text", text: ev.part.text || "" }], stop_reason: "end_turn" } });
        } else if (ev.type === "tool_use") {
          const s = ev.part.state || {};
          const tn = ev.part.tool || "unknown";
          const nn = { bash: "Bash", read: "Read", glob: "Glob", grep: "Grep", apply_patch: "Write", write: "Write", edit: "Edit", todowrite: "TodoWrite", todo_write: "TodoWrite", websearch: "WebSearch", web_search: "WebSearch", webfetch: "WebFetch", web_fetch: "WebFetch" }[tn] || tn;
          emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: ocModel || ocAgent, content: [
            { type: "tool_use", id: ev.part.callID || ev.part.id, name: nn, input: s.input || {} },
            { type: "tool_result", tool_use_id: ev.part.callID || ev.part.id, content: typeof s.output === "string" ? s.output : JSON.stringify(s.output || "") },
          ], stop_reason: "tool_use" } });
        } else if (ev.type === "step_finish") {
          stepCost += ev.part.cost || 0;
          if (ev.part.reason === "stop") {
            const tk = ev.part.tokens || {};
            emitAgentMessage(threadId, { type: "result", subtype: "success", is_error: false, duration_ms: 0, num_turns: 1, result: "", session_id: capturedSessionId || "", total_cost_usd: stepCost, usage: { input_tokens: tk.input || 0, output_tokens: tk.output || 0 } });
          }
        } else if (ev.type === "error") {
          emitAgentError(threadId, (ev.error && ev.error.data && ev.error.data.message) || "OpenCode error");
        }
      } catch {}
    }
  });

  proc.onExit(({ exitCode }) => {
    if (buffer.trim()) {
      const trimmed = buffer.replace(/[\\x00-\\x1f\\x7f]+(\\[\\?[\\d;]*[a-zA-Z])?/g, "").trim();
      try { const ev = JSON.parse(trimmed); if (ev.type) { /* process last line */ } } catch {}
    }
    log("\\u{1F916}", "OpenCode exited for thread " + threadId + " code=" + exitCode);
    if (!capturedSessionId && exitCode !== 0) {
      emitAgentError(threadId, "OpenCode exited with code " + exitCode);
    }
    agentProcesses.delete(threadId);
    emitAgentExit(threadId, exitCode || 0);
  });
  return proc;
}

// ── Bridge core ──────────────────────────────────────
function spawnAgent(threadId, prompt, agent, model, sessionId) {
  try {
    const proc = spawnOpenCode(threadId, prompt, agent, model, sessionId);
    agentProcesses.set(threadId, { proc, sessionId, threadId });
  } catch (e) { emitAgentError(threadId, e.message || String(e)); }
}

function handleStartAgent(msg) {
  const threadId = msg.threadId || "default";
  const existing = agentProcesses.get(threadId);

  if (existing) {
    log("\\u{1F916}", "Killing existing OpenCode for thread " + threadId);
    if (existing.proc) { try { existing.proc.kill(); } catch {} }
    agentProcesses.delete(threadId);
  }

  spawnAgent(threadId, msg.prompt, msg.agent || msg.agentType, msg.model, msg.sessionId);
}

function handleUserAnswer(msg) {
  let pending = pendingAskUser.get(msg.toolUseId);
  if (!pending && msg.threadId) {
    for (const [, entry] of pendingAskUser) {
      if (entry.threadId === msg.threadId) { pending = entry; break; }
    }
  }
  if (pending) { pending.resolve(msg.answer); return; }
  emitAgentError(msg.threadId, "No pending ask_user to receive answer");
}

function killEntry(e) { if (e && e.proc) { try { e.proc.kill(); } catch {} } }

function handleStopAgent(msg) {
  if (msg.threadId) {
    const e = agentProcesses.get(msg.threadId);
    if (e) { killEntry(e); agentProcesses.delete(msg.threadId); }
  } else {
    for (const [cid, e] of agentProcesses) { killEntry(e); agentProcesses.delete(cid); }
  }
}

// ── Terminal management ──────────────────────────────
function createTerminalPty(terminalId, name, cols, rows, cwd, command) {
  if (terminals.has(terminalId)) return { error: "Terminal already exists: " + terminalId };
  const shell = command || (process.env.SHELL || "bash");
  const args = command ? ["-c", command] : [];
  const ptyProcess = pty.spawn(command ? "bash" : shell, args, {
    name: "xterm-256color", cols: cols || 80, rows: rows || 24, cwd: cwd || PROJECT_DIR,
    env: { ...process.env, TERM: "xterm-256color" },
  });
  const entry = { pty: ptyProcess, scrollback: [], name: name || "Terminal " + (terminals.size + 1), cols: cols || 80, rows: rows || 24 };
  terminals.set(terminalId, entry);

  ptyProcess.onData((data) => {
    entry.scrollback.push(data);
    if (entry.scrollback.length > MAX_SCROLLBACK) entry.scrollback.shift();
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({ type: "terminal_output", terminalId, data }));
    }
  });
  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(terminalId);
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({ type: "terminal_exit", terminalId, exitCode }));
    }
  });
  return { terminalId, name: entry.name };
}
function getTerminalsList() {
  const list = [];
  for (const [id, entry] of terminals) {
    list.push({ id, name: entry.name, cols: entry.cols, rows: entry.rows, scrollback: entry.scrollback.join("") });
  }
  return list;
}

// ── File watcher ─────────────────────────────────────
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
    inotifyProc = spawn("inotifywait", ["-mr", "--format", "%e %w%f", "-e", "create,delete,move,modify", "--exclude", "(/\\\\.git/|/node_modules/)", PROJECT_DIR], { stdio: ["ignore", "pipe", "pipe"] });
    inotifyProc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\\n")) {
        const trimmed = line.trim(); if (!trimmed) continue;
        const sp = trimmed.indexOf(" "); if (sp === -1) continue;
        const ev = trimmed.substring(0, sp);
        const fp = trimmed.substring(sp + 1).replace(/\\/$/, "");
        const pd = path.dirname(fp);
        if (pd) changedDirs.add(pd);
        if (ev.includes("ISDIR") && (ev.includes("CREATE") || ev.includes("MOVED_TO"))) changedDirs.add(fp);
      }
      if (changedDirs.size > 0) { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(flushFileChanges, 300); }
    });
    inotifyProc.stderr.on("data", (chunk) => {
      const m = chunk.toString().trim();
      if (m && !m.startsWith("Setting up watches") && !m.startsWith("Watches established")) {
        log("\\u{1F441}", "inotify stderr: " + m);
        if (m.includes("No space left on device") || m.includes("upper limit on inotify")) {
          log("\\u{26A0}", "inotify watch limit reached, restarting watcher");
          if (inotifyProc) { try { inotifyProc.kill(); } catch(e) {} }
        }
      }
    });
    inotifyProc.on("exit", (code) => { inotifyProc = null; setTimeout(() => { watcherRestartDelay = Math.min(watcherRestartDelay * 2, WATCHER_MAX_RESTART_DELAY); startFileWatcher(); }, watcherRestartDelay); });
    inotifyProc.on("error", (err) => { inotifyProc = null; watcherFatalError = true; });
    watcherRestartDelay = 1000;
  } catch (e) { watcherFatalError = true; }
}
function flushFileChanges() {
  if (changedDirs.size === 0) return;
  if (state.ws && state.ws.readyState === 1) {
    const dirs = Array.from(changedDirs); changedDirs.clear();
    state.ws.send(JSON.stringify({ type: "file_changed", dirs }));
  } else {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushFileChanges, 1000);
  }
}
startFileWatcher();

// ── HTTP server ──────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/internal/terminal-create") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const { name, command, cols, rows, cwd } = JSON.parse(body);
        const tid = "mcp-" + crypto.randomUUID().slice(0, 8);
        const result = createTerminalPty(tid, name, cols || 80, rows || 24, cwd, command);
        if (result.error) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); }
        else {
          if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: "terminal_created", terminalId: tid, name: result.name }));
          res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
        }
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (req.method === "POST" && req.url === "/internal/terminal-write") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const { terminalId, input } = JSON.parse(body);
        const e = terminals.get(terminalId);
        if (!e) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Terminal not found" })); return; }
        e.pty.write(input); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (req.method === "POST" && req.url === "/internal/terminal-close") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const { terminalId } = JSON.parse(body);
        const e = terminals.get(terminalId);
        if (!e) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Terminal not found" })); return; }
        e.pty.kill(); terminals.delete(terminalId); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (req.method === "GET" && req.url === "/internal/terminal-list") {
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ terminals: getTerminalsList() })); return;
  }
  if (req.method === "POST" && req.url === "/internal/terminal-read") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const { terminalId, lines } = JSON.parse(body);
        const e = terminals.get(terminalId);
        if (!e) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Terminal not found" })); return; }
        const chunks = lines ? e.scrollback.slice(-lines) : e.scrollback;
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ terminalId, output: chunks.join("") }));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (req.method === "POST" && req.url === "/internal/preview-url") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const { port } = JSON.parse(body);
        if (!port) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "port is required" })); return; }
        if (!DAYTONA_API_KEY || !SANDBOX_ID) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Daytona credentials not configured" })); return; }
        const apiUrl = DAYTONA_API_URL + "/sandbox/" + SANDBOX_ID + "/ports/" + port + "/preview-url";
        const parsed = urlMod.parse(apiUrl);
        const reqOpts = { hostname: parsed.hostname, port: parsed.port || 443, path: parsed.path, method: "GET", headers: { "Authorization": "Bearer " + DAYTONA_API_KEY } };
        const apiReq = https.request(reqOpts, (apiRes) => {
          let apiBody = ""; apiRes.on("data", (c) => apiBody += c); apiRes.on("end", () => {
            if (apiRes.statusCode !== 200) { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Daytona API error (HTTP " + apiRes.statusCode + "): " + apiBody })); return; }
            try { const result = JSON.parse(apiBody); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ url: result.url, token: result.token })); }
            catch (e) { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid API response" })); }
          });
        });
        apiReq.on("error", (e) => { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "API request failed: " + e.message })); });
        apiReq.end();
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (req.method === "POST" && req.url === "/internal/ask-user") {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const questionId = "ask-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        const activeThreadId = payload.threadId !== "default" ? payload.threadId : (agentProcesses.size > 0 ? Array.from(agentProcesses.keys()).pop() : "default");
        emitAgentMessage(activeThreadId, { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: questionId, name: "AskUserQuestion", input: payload.input || {} }], stop_reason: "tool_use" } });
        if (state.ws && state.ws.readyState === 1) {
          state.ws.send(JSON.stringify({ type: "ask_user_pending", threadId: activeThreadId, questionId: questionId }));
        }
        const ASK_TIMEOUT_MS = 300000;
        const entry = { resolve: null, timer: null };
        entry.timer = setTimeout(() => {
          pendingAskUser.delete(questionId);
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({ type: "ask_user_resolved", threadId: activeThreadId, questionId: questionId }));
          }
          res.writeHead(408, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "User did not respond in time" }));
        }, ASK_TIMEOUT_MS);
        pendingAskUser.set(questionId, { threadId: activeThreadId, resolve: (answer) => {
          clearTimeout(entry.timer); pendingAskUser.delete(questionId);
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({ type: "ask_user_resolved", threadId: activeThreadId, questionId: questionId }));
          }
          res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ answer }));
        } });
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  res.writeHead(200); res.end("bridge-ok");
});

// ── WebSocket server ─────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  log("\\u{1F517}", "Orchestrator connected");
  state.ws = ws;
  ws.send(JSON.stringify({ type: "bridge_ready", port: PORT }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "start_claude") { handleStartAgent(msg); }
      else if (msg.type === "claude_user_answer") { handleUserAnswer(msg); }
      else if (msg.type === "claude_input") {
        const e = agentProcesses.get(msg.threadId);
        if (e && e.proc && e.proc.write) e.proc.write(msg.data);
      }
      else if (msg.type === "stop_claude") { handleStopAgent(msg); }
      else if (msg.type === "terminal_create") {
        try {
          const result = createTerminalPty(msg.terminalId, msg.name, msg.cols, msg.rows, msg.cwd, msg.command);
          if (result.error) ws.send(JSON.stringify({ type: "terminal_error", terminalId: msg.terminalId, error: result.error }));
          else ws.send(JSON.stringify({ type: "terminal_created", terminalId: msg.terminalId, name: result.name }));
        } catch (ptyErr) { ws.send(JSON.stringify({ type: "terminal_error", terminalId: msg.terminalId, error: String(ptyErr) })); }
      }
      else if (msg.type === "terminal_input") { const e = terminals.get(msg.terminalId); if (e) e.pty.write(msg.data); }
      else if (msg.type === "terminal_resize") { const e = terminals.get(msg.terminalId); if (e) { e.pty.resize(msg.cols, msg.rows); e.cols = msg.cols; e.rows = msg.rows; } }
      else if (msg.type === "terminal_close") { const e = terminals.get(msg.terminalId); if (e) { e.pty.kill(); terminals.delete(msg.terminalId); } }
      else if (msg.type === "terminal_list") { ws.send(JSON.stringify({ type: "terminal_list", terminals: getTerminalsList() })); }
      else if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); }
    } catch (e) {
      log("\\u{274C}", "Message handler error: " + e);
      try { const p = JSON.parse(data.toString()); if (p.terminalId) ws.send(JSON.stringify({ type: "terminal_error", terminalId: p.terminalId, error: String(e) })); else if (p.threadId) ws.send(JSON.stringify({ type: "claude_error", threadId: p.threadId, error: String(e) })); } catch {}
    }
  });

  ws.on("close", () => {
    log("\\u{1F50C}", "Orchestrator disconnected");
    for (const [cid, e] of agentProcesses) { killEntry(e); agentProcesses.delete(cid); }
  });
});

// ── Port scanning ────────────────────────────────────
const INTERNAL_PORTS = new Set([${port}, 9090, 22]);
let lastPortsJson = "";
function parseNetstatOutput(output) {
  const lines = output.split("\\n"); const ports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.indexOf("LISTEN") === -1) continue;
    if (line.startsWith("Proto") || line.startsWith("Active")) continue;
    const parts = line.split(/\\s+/);
    if (parts.length < 6) continue;
    const localAddr = parts[3] || "";
    if (localAddr.startsWith("127.") || localAddr.startsWith("::1:")) continue;
    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) continue;
    const portNum = parseInt(localAddr.substring(lastColon + 1), 10);
    if (isNaN(portNum) || INTERNAL_PORTS.has(portNum)) continue;
    let proc = "";
    const pidProg = parts[6] || parts[5] || "";
    const slashIdx = pidProg.indexOf("/");
    if (slashIdx !== -1) proc = pidProg.substring(slashIdx + 1);
    if (proc === "daytona-daemon") continue;
    ports.push({ port: portNum, protocol: "tcp", process: proc });
  }
  const seen = new Set();
  return ports.filter((p) => { if (seen.has(p.port)) return false; seen.add(p.port); return true; }).sort((a, b) => a.port - b.port);
}
setInterval(() => {
  if (!state.ws || state.ws.readyState !== 1) return;
  try {
    const proc = spawn("netstat", ["-tlnp"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout.on("data", (chunk) => { output += chunk.toString(); });
    proc.on("close", () => { const ports = parseNetstatOutput(output); const json = JSON.stringify(ports); if (json !== lastPortsJson) { lastPortsJson = json; state.ws.send(JSON.stringify({ type: "ports_update", ports })); } });
    proc.on("error", () => {});
  } catch (e) {}
}, 3000);

server.listen(PORT, "0.0.0.0", () => { log("\\u{2705}", "Bridge ready on port " + PORT); });
`;
}
