/**
 * Returns the JavaScript source for the bridge server that runs
 * INSIDE a Daytona sandbox. It is uploaded via sandbox.fs.uploadFile().
 *
 * Uses OpenCode in serve mode as the agent runtime. The bridge starts
 * `opencode serve` once on boot and communicates via its HTTP API
 * (POST /session/:id/prompt_async) and SSE event stream (GET /event).
 * Custom agents and models are passed per-prompt in the API payload.
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
const APEX_PROXY_BASE_URL = (process.env.APEX_PROXY_BASE_URL || "").replace(/\\/$/, "");
const APEX_PROJECT_ID = process.env.APEX_PROJECT_ID || "";
const https = require("https");
const urlMod = require("url");

let state = { ws: null };
const threadToSession = new Map();
const sessionToThread = new Map();
const activeThreads = new Set();
const sessionCosts = new Map();
let ocServeProc = null;
let sseReq = null;
const terminals = new Map();
const pendingAskUser = new Map();
const sessionEmittedParts = new Map();

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
// ── OpenCode Serve Adapter ──────────────────────────
// ══════════════════════════════════════════════════════
const OC_PORT = 4096;
const TOOL_NAME_MAP = { bash: "Bash", read: "Read", glob: "Glob", grep: "Grep", apply_patch: "Write", write: "Write", edit: "Edit", todowrite: "TodoWrite", todo_write: "TodoWrite", websearch: "WebSearch", web_search: "WebSearch", webfetch: "WebFetch", web_fetch: "WebFetch", task: "Task" };

function ocFetch(method, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: "127.0.0.1", port: OC_PORT, path: urlPath, method: method, headers: {}, timeout: timeoutMs || 30000 };
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
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout after " + (timeoutMs || 30000) + "ms")); });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function loadDotEnv(dir) {
  try {
    const fs = require("fs");
    const envPath = dir + "/.env";
    const content = fs.readFileSync(envPath, "utf8");
    const vars = {};
    for (const line of content.split("\\n")) {
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
  log("\\u{1F680}", "Starting opencode serve on port " + OC_PORT);
  let ocBin = "opencode";
  try { ocBin = execSync("which opencode 2>/dev/null || echo opencode").toString().trim(); } catch {};
  const dotEnvVars = loadDotEnv(PROJECT_DIR);
  const serveEnv = { ...process.env, ...dotEnvVars, HOME: "/home/daytona", NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  ocServeProc = spawn(ocBin, ["serve", "--port", String(OC_PORT), "--hostname", "127.0.0.1"], {
    cwd: PROJECT_DIR,
    env: serveEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  ocServeProc.stdout.on("data", (d) => log("\\u{1F916}", "oc-serve: " + d.toString().trim()));
  ocServeProc.stderr.on("data", (d) => log("\\u{1F916}", "oc-serve err: " + d.toString().trim()));
  ocServeProc.on("exit", (code) => {
    log("\\u{26A0}", "opencode serve exited code=" + code);
    ocServeProc = null;
    setTimeout(() => { if (!ocServeProc) startOpenCodeServe(); }, 3000);
  });
  ocServeProc.on("error", (err) => {
    log("\\u{274C}", "opencode serve spawn error: " + err.message);
    ocServeProc = null;
  });
  pollHealth(0);
}

function pollHealth(attempt) {
  if (attempt >= 60) { log("\\u{274C}", "opencode serve health timed out"); return; }
  setTimeout(() => {
    ocFetch("GET", "/global/health", null)
      .then((res) => {
        if (res && res.healthy) {
          log("\\u{2705}", "opencode serve healthy v=" + (res.version || "?"));
          connectSSE();
        } else { pollHealth(attempt + 1); }
      })
      .catch(() => pollHealth(attempt + 1));
  }, attempt === 0 ? 500 : 1000);
}

function connectSSE() {
  if (sseReq) { try { sseReq.kill(); } catch {} sseReq = null; }
  log("\\u{1F4E1}", "Connecting SSE /event via curl");
  const proc = spawn("curl", ["-s", "-N", "http://127.0.0.1:" + OC_PORT + "/event"], { stdio: ["ignore", "pipe", "pipe"] });
  sseReq = proc;
  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const blocks = buf.split("\\n\\n");
    buf = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split("\\n");
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
      } catch (e) { log("\\u{26A0}", "SSE parse error " + evType + ": " + e.message); }
    }
  });
  proc.stderr.on("data", (d) => { const m = d.toString().trim(); if (m) log("\\u{26A0}", "SSE curl stderr: " + m); });
  proc.on("exit", (code) => { sseReq = null; log("\\u{26A0}", "SSE curl exited code=" + code + ", reconnecting..."); setTimeout(connectSSE, 2000); });
  proc.on("error", (e) => { sseReq = null; log("\\u{26A0}", "SSE curl error: " + e.message); setTimeout(connectSSE, 3000); });
}

function handleSSEEvent(evType, data) {
  const props = data.properties || data;
  if (evType === "permission.updated") {
    const sessionId = props.sessionID || props.id;
    const permId = props.permissionID || props.id;
    if (sessionId && permId) {
      log("\\u{1F513}", "Auto-approving permission " + permId + " for session " + sessionId);
      ocFetch("POST", "/session/" + sessionId + "/permissions/" + permId, { response: true }).catch((e) => {
        log("\\u{26A0}", "Permission approval failed: " + (e.message || String(e)));
      });
    }
  } else if (evType === "session.error") {
    const sessionId = props.sessionID || props.id;
    const threadId = sessionToThread.get(sessionId);
    if (!threadId) return;
    activeThreads.delete(threadId);
    const errMsg = (props.error && props.error.data && props.error.data.message) || (props.error && props.error.message) || (props.e || "OpenCode session error");
    log("\\u{274C}", "Session error for thread " + threadId + ": " + errMsg);
    emitAgentError(threadId, errMsg);
  }
}

// ── Bridge core ──────────────────────────────────────
async function sendPrompt(threadId, prompt, agent, model, sessionId) {
  const ocAgent = agent || "build";
  const ocModel = model || "";
  log("\\u{1F916}", "Sending prompt thread=" + threadId + " agent=" + ocAgent + " model=" + (ocModel || "default"));

  let ocSessionId = threadToSession.get(threadId);
  if (!ocSessionId) {
    const sess = await ocFetch("POST", "/session", { title: threadId });
    ocSessionId = sess.id;
    log("\\u{1F4DD}", "Created session " + ocSessionId + " for thread " + threadId);
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
  log("\\u{1F916}", "Prompt dispatched to session " + ocSessionId);
  pollSession(threadId, ocSessionId);
}

function pollSession(threadId, sessionId) {
  if (!sessionEmittedParts.has(sessionId)) sessionEmittedParts.set(sessionId, new Set());
  const emittedParts = sessionEmittedParts.get(sessionId);
  const taskChildren = new Map();
  let lastCost = 0;
  let seenBusy = false;
  let idleCount = 0;
  const poll = () => {
    if (!activeThreads.has(threadId)) { log("\\u{26A0}", "Poll skipped: thread " + threadId + " not in activeThreads"); return; }
    log("\\u{1F504}", "Polling session " + sessionId + " (seenBusy=" + seenBusy + " idle=" + idleCount + " parts=" + emittedParts.size + ")");
    ocFetch("GET", "/session/" + sessionId + "/message?limit=20", null)
      .then((msgs) => {
        if (!Array.isArray(msgs)) { setTimeout(poll, 1500); return; }
        for (const msg of msgs) {
          if (!msg.parts || !msg.info || msg.info.role !== "assistant") continue;
          seenBusy = true;
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
                taskChildren.delete(pid);
                emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: "", content: [
                  { type: "tool_use", id: toolId, name: nn, input: s.input || {} },
                  { type: "tool_result", tool_use_id: toolId, content: typeof s.output === "string" ? s.output : JSON.stringify(s.output || "") },
                ], stop_reason: "tool_use" } });
              } else if (s.status === "running") {
                if (!emittedParts.has(pid + ":running")) {
                  emittedParts.add(pid + ":running");
                  emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: "", content: [
                    { type: "tool_use", id: toolId, name: nn, input: s.input || {} },
                  ], stop_reason: "tool_use" } });
                }
                if (tn === "task" && s.metadata && s.metadata.sessionId && !taskChildren.has(pid)) {
                  taskChildren.set(pid, { childSid: s.metadata.sessionId, toolId: toolId, input: s.input || {}, lastHash: "" });
                }
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
        var childPolls = [];
        for (const [pid, ci] of taskChildren) {
          childPolls.push(
            ocFetch("GET", "/session/" + ci.childSid + "/message?limit=10", null)
              .then((childMsgs) => {
                if (!Array.isArray(childMsgs)) return;
                var activity = [];
                for (const cm of childMsgs) {
                  if (!cm.parts || !cm.info || cm.info.role !== "assistant") continue;
                  for (const cp of cm.parts) {
                    if (cp.type === "text" && cp.text) {
                      activity.push({ type: "text", text: cp.text.length > 300 ? cp.text.slice(0, 300) + "..." : cp.text });
                    } else if (cp.type === "tool") {
                      var cs = cp.state || {};
                      var ctn = TOOL_NAME_MAP[cp.tool] || cp.tool || "unknown";
                      activity.push({ type: "tool", name: ctn, status: cs.status || "running", title: cs.title || ctn });
                    }
                  }
                }
                var hash = activity.length + ":" + activity.map(function(a) { return (a.type === "tool" ? a.name + ":" + a.status : "t"); }).join(",");
                if (activity.length > 0 && hash !== ci.lastHash) {
                  ci.lastHash = hash;
                  emitAgentMessage(threadId, { type: "assistant", message: { role: "assistant", model: "", content: [
                    { type: "tool_use", id: ci.toolId, name: "Task", input: Object.assign({}, ci.input, { _childActivity: activity }) },
                  ], stop_reason: "tool_use" } });
                }
              })
              .catch(function() {})
          );
        }
        return (childPolls.length > 0 ? Promise.all(childPolls) : Promise.resolve()).then(function() { return ocFetch("GET", "/session/status", null); });
      })
      .then((statuses) => {
        if (!statuses) return;
        const st = statuses[sessionId];
        if (st && st.type === "busy") { seenBusy = true; idleCount = 0; }
        if (!st || st.type === "idle") {
          idleCount++;
          if (seenBusy || idleCount >= 5) {
            log("\\u{1F916}", "Session " + sessionId + " idle (seenBusy=" + seenBusy + " idleCount=" + idleCount + "), emitting exit");
            activeThreads.delete(threadId);
            emitAgentExit(threadId, 0);
            return;
          }
        }
        setTimeout(poll, 1500);
      })
      .catch((e) => {
        log("\\u{26A0}", "Poll error: " + (e.message || String(e)));
        setTimeout(poll, 3000);
      });
  };
  setTimeout(poll, 2000);
}

async function handleStartAgent(msg) {
  const threadId = msg.threadId || "default";
  const existingSession = threadToSession.get(threadId);
  if (existingSession && activeThreads.has(threadId)) {
    log("\\u{1F916}", "Aborting running session for thread " + threadId);
    try { await ocFetch("POST", "/session/" + existingSession + "/abort", {}); } catch {}
    activeThreads.delete(threadId);
  }
  try {
    await sendPrompt(threadId, msg.prompt, msg.agent || msg.agentType, msg.model, msg.sessionId);
  } catch (e) { emitAgentError(threadId, e.message || String(e)); }
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

async function handleStopAgent(msg) {
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
startOpenCodeServe();

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
        if (APEX_PROXY_BASE_URL && APEX_PROJECT_ID) {
          const proxyUrl = APEX_PROXY_BASE_URL + "/preview/" + APEX_PROJECT_ID + "/" + port;
          res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ url: proxyUrl })); return;
        }
        if (!DAYTONA_API_KEY || !SANDBOX_ID) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Preview URL not available — no proxy or Daytona credentials configured" })); return; }
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
        const activeThreadId = payload.threadId !== "default" ? payload.threadId : (activeThreads.size > 0 ? Array.from(activeThreads).pop() : "default");
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
  if (req.method === "GET" && req.url === "/internal/list-secrets") {
    const proxyBase = process.env.APEX_PROXY_BASE_URL || "";
    const projectId = process.env.APEX_PROJECT_ID || "";
    if (!proxyBase || !projectId) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ secrets: [] }));
      return;
    }
    const fetchUrl = proxyBase + "/api/secrets?projectId=" + encodeURIComponent(projectId);
    const proto = fetchUrl.startsWith("https") ? require("https") : require("http");
    proto.get(fetchUrl, (apiRes) => {
      let data = "";
      apiRes.on("data", (c) => data += c);
      apiRes.on("end", () => {
        try {
          const items = JSON.parse(data);
          const safe = (Array.isArray(items) ? items : []).map((s) => ({
            name: s.name, domain: s.domain, authType: s.authType, description: s.description,
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ secrets: safe }));
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ secrets: [], error: e.message }));
        }
      });
    }).on("error", (e) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ secrets: [], error: e.message }));
    });
    return;
  }
  res.writeHead(200); res.end("bridge-ok");
});

// ── WebSocket server ─────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  log("\\u{1F517}", "Orchestrator connected");
  state.ws = ws;
  lastPortsKey = "";
  ws.send(JSON.stringify({ type: "bridge_ready", port: PORT }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "start_claude") { handleStartAgent(msg).catch(e => log("\\u{274C}", "start_claude error: " + e)); }
      else if (msg.type === "claude_user_answer") { handleUserAnswer(msg); }
      else if (msg.type === "stop_claude") { handleStopAgent(msg).catch(e => log("\\u{274C}", "stop_claude error: " + e)); }
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
    for (const tid of activeThreads) {
      const sid = threadToSession.get(tid);
      if (sid) { ocFetch("POST", "/session/" + sid + "/abort", {}).catch(() => {}); }
    }
    activeThreads.clear();
  });
});

// ── Port scanning ────────────────────────────────────
const INTERNAL_PORTS = new Set([${port}, 9090, OC_PORT, 22, 25, 53, 445, 2375, 2376, 3306, 3389, 5432, 6379, 27017]);
const portFs = require("fs");
let lastPortsKey = "";
let portInfoCache = new Map();

function readCmdline(pid) {
  try { return portFs.readFileSync("/proc/" + pid + "/cmdline", "utf8").replace(/\\0/g, " ").trim(); } catch (e) { return ""; }
}

function scanListeningPorts() {
  const portInodes = new Map();
  const files = ["/proc/net/tcp", "/proc/net/tcp6"];
  for (let f = 0; f < files.length; f++) {
    try {
      const content = portFs.readFileSync(files[f], "utf8");
      const lines = content.split("\\n");
      for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].trim().split(/\\s+/);
        if (fields.length < 10 || fields[3] !== "0A") continue;
        const local = fields[1];
        const ci = local.lastIndexOf(":");
        if (ci === -1) continue;
        const hexIp = local.substring(0, ci);
        if (hexIp === "0100007F" || hexIp === "00000000000000000000000001000000") continue;
        const portNum = parseInt(local.substring(ci + 1), 16);
        if (isNaN(portNum) || INTERNAL_PORTS.has(portNum) || portInodes.has(portNum)) continue;
        portInodes.set(portNum, fields[9]);
      }
    } catch (e) {}
  }
  return portInodes;
}

function resolveProcesses(portInodes) {
  const needInodes = new Set();
  for (const [p, inode] of portInodes) { if (!portInfoCache.has(p)) needInodes.add(inode); }
  const inodePid = new Map();
  if (needInodes.size > 0) {
    try {
      const procs = portFs.readdirSync("/proc");
      for (let i = 0; i < procs.length; i++) {
        if (!/^\\d+$/.test(procs[i])) continue;
        try {
          const fds = portFs.readdirSync("/proc/" + procs[i] + "/fd");
          for (let j = 0; j < fds.length; j++) {
            try {
              const link = portFs.readlinkSync("/proc/" + procs[i] + "/fd/" + fds[j]);
              if (link.startsWith("socket:[")) {
                const ino = link.slice(8, -1);
                if (needInodes.has(ino)) {
                  inodePid.set(ino, procs[i]);
                  needInodes.delete(ino);
                  if (needInodes.size === 0) break;
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
        if (needInodes.size === 0) break;
      }
    } catch (e) {}
  }
  const newCache = new Map();
  const result = [];
  for (const [portNum, inode] of portInodes) {
    let info = portInfoCache.get(portNum);
    if (!info) {
      const pid = inodePid.get(inode) || "";
      const cmd = pid ? readCmdline(pid) : "";
      const parts = cmd.split(" ");
      const base = parts[0] ? parts[0].split("/").pop() : "";
      if (base === "daytona-daemon") continue;
      info = { process: base || "", command: cmd || base };
    }
    newCache.set(portNum, info);
    result.push({ port: portNum, protocol: "tcp", process: info.process, command: info.command });
  }
  portInfoCache = newCache;
  return result.sort((a, b) => a.port - b.port);
}

setInterval(() => {
  if (!state.ws || state.ws.readyState !== 1) return;
  try {
    const portInodes = scanListeningPorts();
    const sortedPorts = Array.from(portInodes.keys()).sort((a, b) => a - b);
    const portsKey = sortedPorts.join(",");
    if (portsKey === lastPortsKey) return;
    lastPortsKey = portsKey;
    const ports = resolveProcesses(portInodes);
    state.ws.send(JSON.stringify({ type: "ports_update", ports }));
  } catch (e) {}
}, 1000);

server.listen(PORT, "0.0.0.0", () => { log("\\u{2705}", "Bridge ready on port " + PORT); });
`;
}
