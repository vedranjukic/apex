package sandbox

import (
	"fmt"
	"strings"
)

const bridgePort = 8080

// GenerateBridgeScript returns the JavaScript source for bridge.js
// that runs inside a Daytona sandbox. Mirrors the TypeScript
// getBridgeScript() in libs/orchestrator/src/lib/bridge-script.ts.
// Uses OpenCode as the single agent runtime.
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
const agentProcesses = new Map();
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
        const activeThreadId = payload.threadId !== "default" ? payload.threadId : (agentProcesses.size > 0 ? Array.from(agentProcesses.keys()).pop() : "default");
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

  res.writeHead(200);
  res.end("bridge-ok");
});

const wss = new WebSocketServer({ server });

function spawnOpenCode(threadId, prompt, agent, model, sessionId) {
  const ocAgent = agent || "build";
  const ocModel = model || "";
  log("\u{1F916}", "Spawning OpenCode for thread " + threadId + " agent=" + ocAgent);
  const ocBin = "/home/daytona/.opencode/bin/opencode";
  const args = ["run", "--format", "json"];
  if (ocAgent) args.push("--agent", ocAgent);
  if (ocModel) args.push("-m", ocModel);
  if (sessionId) args.push("--session", sessionId);
  args.push(prompt);

  try {
    const proc = pty.spawn(ocBin, args, {
      name: "xterm-256color", cols: 200, rows: 50, cwd: PROJECT_DIR,
      env: { ...process.env, HOME: "/home/daytona" },
    });
    agentProcesses.set(threadId, { proc, sessionId, threadId });
    let capturedSessionId = null;
    let stepCost = 0;
    let buffer = "";

    proc.onData((d) => {
      buffer += d;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.replace(/[\x00-\x1f\x7f]+(\[\?[\d;]*[a-zA-Z])?/g, "").trim();
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (!capturedSessionId && ev.sessionID) {
            capturedSessionId = ev.sessionID;
            const ex = agentProcesses.get(threadId);
            if (ex) ex.sessionId = capturedSessionId;
            ws.send(JSON.stringify({ type: "claude_message", threadId: threadId, data: { type: "system", subtype: "init", session_id: capturedSessionId, tools: [], model: ocModel || ocAgent, cwd: PROJECT_DIR } }));
          }
          if (ev.type === "text") {
            ws.send(JSON.stringify({ type: "claude_message", threadId: threadId, data: { type: "assistant", message: { role: "assistant", model: ocModel || ocAgent, content: [{ type: "text", text: ev.part.text || "" }], stop_reason: "end_turn" } } }));
          } else if (ev.type === "tool_use") {
            const s = ev.part.state || {};
            const tn = ev.part.tool || "unknown";
            const nn = { bash: "Bash", read: "Read", glob: "Glob", grep: "Grep", apply_patch: "Write", write: "Write", edit: "Edit" }[tn] || tn;
            ws.send(JSON.stringify({ type: "claude_message", threadId: threadId, data: { type: "assistant", message: { role: "assistant", model: ocModel || ocAgent, content: [
              { type: "tool_use", id: ev.part.callID || ev.part.id, name: nn, input: s.input || {} },
              { type: "tool_result", tool_use_id: ev.part.callID || ev.part.id, content: typeof s.output === "string" ? s.output : JSON.stringify(s.output || "") },
            ], stop_reason: "tool_use" } } }));
          } else if (ev.type === "step_finish") {
            stepCost += ev.part.cost || 0;
            if (ev.part.reason === "stop") {
              const tk = ev.part.tokens || {};
              ws.send(JSON.stringify({ type: "claude_message", threadId: threadId, data: { type: "result", subtype: "success", is_error: false, duration_ms: 0, num_turns: 1, result: "", session_id: capturedSessionId || "", total_cost_usd: stepCost, usage: { input_tokens: tk.input || 0, output_tokens: tk.output || 0 } } }));
            }
          } else if (ev.type === "error") {
            ws.send(JSON.stringify({ type: "claude_error", threadId: threadId, error: (ev.error && ev.error.data && ev.error.data.message) || "OpenCode error" }));
          }
        } catch {}
      }
    });

    proc.onExit(({ exitCode }) => {
      log("\u{1F916}", "OpenCode exited for thread " + threadId + " code=" + exitCode);
      if (!capturedSessionId && exitCode !== 0) {
        ws.send(JSON.stringify({ type: "claude_error", threadId: threadId, error: "OpenCode exited with code " + exitCode }));
      }
      agentProcesses.delete(threadId);
      ws.send(JSON.stringify({ type: "claude_exit", threadId: threadId, code: exitCode || 0 }));
    });
  } catch (e) {
    ws.send(JSON.stringify({ type: "claude_error", threadId: threadId, error: e.message || String(e) }));
  }
}

wss.on("connection", (ws) => {
  log("\u{1F517}", "Orchestrator connected");
  state.ws = ws;
  ws.send(JSON.stringify({ type: "bridge_ready", port: PORT }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "start_claude") {
        const threadId = msg.threadId || "default";
        const existing = agentProcesses.get(threadId);
        if (existing) {
          if (existing.proc) { try { existing.proc.kill(); } catch {} }
          agentProcesses.delete(threadId);
        }
        spawnOpenCode(threadId, msg.prompt, msg.agent || msg.agentType, msg.model, msg.sessionId);

      } else if (msg.type === "claude_user_answer") {
        let pending = pendingAskUser.get(msg.toolUseId);
        if (!pending && msg.threadId) {
          for (const [, entry] of pendingAskUser) {
            if (entry.threadId === msg.threadId) { pending = entry; break; }
          }
        }
        if (pending) { pending.resolve(msg.answer); }
        else { ws.send(JSON.stringify({ type: "claude_error", threadId: msg.threadId, error: "No pending ask_user to receive answer" })); }

      } else if (msg.type === "claude_input") {
        const e = agentProcesses.get(msg.threadId);
        if (e && e.proc && e.proc.write) e.proc.write(msg.data);

      } else if (msg.type === "stop_claude") {
        if (msg.threadId) {
          const e = agentProcesses.get(msg.threadId);
          if (e && e.proc) { try { e.proc.kill(); } catch {} }
          agentProcesses.delete(msg.threadId);
        } else {
          for (const [cid, e] of agentProcesses) { if (e.proc) { try { e.proc.kill(); } catch {} } agentProcesses.delete(cid); }
        }

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

      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (e) { log("\u{274C}", "Parse error: " + e); }
  });

  ws.on("close", () => {
    log("\u{1F50C}", "Orchestrator disconnected");
    for (const [cid, e] of agentProcesses) { if (e.proc) { try { e.proc.kill(); } catch {} } agentProcesses.delete(cid); }
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
