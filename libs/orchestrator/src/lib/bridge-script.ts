/**
 * Returns the JavaScript source for the bridge server that runs
 * INSIDE a Daytona sandbox. It is uploaded via sandbox.fs.uploadFile().
 *
 * Handles both Claude CLI orchestration AND multi-terminal PTY sessions.
 */
export function getBridgeScript(port: number, projectDir?: string): string {
  const safeProjDir = projectDir ? projectDir.replace(/"/g, '\\"') : '';
  return `const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const pty = require("node-pty");
const crypto = require("crypto");

const PORT = ${port};
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PROJECT_DIR = "${safeProjDir}" || process.env.HOME || "/home/daytona";
const MAX_SCROLLBACK = 5000;
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "";
const DAYTONA_API_URL = (process.env.DAYTONA_API_URL || "https://app.daytona.io/api").replace(/\\/$/, "");
const SANDBOX_ID = process.env.DAYTONA_SANDBOX_ID || "";
const https = require("https");
const urlMod = require("url");

let state = { ws: null };
const claudeProcesses = new Map(); // chatId -> child_process

// ── Terminal management ──────────────────────────────
const terminals = new Map(); // terminalId -> { pty, scrollback[], name, cols, rows }

// ── Pending ask-user requests (MCP tool waiting for user answer) ──
const pendingAskUser = new Map(); // questionId -> { resolve(answer) }

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
    // Append to scrollback ring buffer
    entry.scrollback.push(data);
    if (entry.scrollback.length > MAX_SCROLLBACK) {
      entry.scrollback.shift();
    }
    // Forward to orchestrator
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({
        type: "terminal_output",
        terminalId: terminalId,
        data: data,
      }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    log("\\u{1F6AA}", "Terminal " + terminalId + " exited with code " + exitCode);
    terminals.delete(terminalId);
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({
        type: "terminal_exit",
        terminalId: terminalId,
        exitCode: exitCode,
      }));
    }
  });

  log("\\u{1F4BB}", "Terminal created: " + terminalId + " (" + entry.name + ")");
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

// ── File watcher (inotifywait-based for Linux) ──────
const path = require("path");
let inotifyProc = null;
const changedDirs = new Set();
let debounceTimer = null;

function startFileWatcher() {
  if (inotifyProc) return;
  try {
    inotifyProc = spawn("inotifywait", [
      "-mr", "--format", "%w", "-e", "create,delete,move,modify",
      "--exclude", "(/\\\\.git/|/node_modules/)",
      PROJECT_DIR,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    inotifyProc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\\n");
      for (const line of lines) {
        const dir = line.trim().replace(/\\/$/, "");
        if (dir) changedDirs.add(dir);
      }
      if (changedDirs.size > 0) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flushFileChanges, 300);
      }
    });

    inotifyProc.stderr.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg && !msg.startsWith("Setting up watches") && !msg.startsWith("Watches established")) {
        log("\\u{1F441}", "inotify stderr: " + msg);
      }
    });

    inotifyProc.on("exit", (code) => {
      log("\\u{1F441}", "inotifywait exited with code " + code);
      inotifyProc = null;
    });

    inotifyProc.on("error", (err) => {
      log("\\u{274C}", "File watcher error: " + err.message + " — inotify-tools not installed, file watching disabled");
      inotifyProc = null;
    });

    log("\\u{1F441}", "File watcher (inotifywait) started for " + PROJECT_DIR);
  } catch (e) {
    log("\\u{274C}", "File watcher failed: " + e.message + " — is inotify-tools installed?");
  }
}

function flushFileChanges() {
  if (changedDirs.size === 0) return;
  const dirs = Array.from(changedDirs);
  changedDirs.clear();
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "file_changed", dirs: dirs }));
  }
}

startFileWatcher();

// ── Logging ──────────────────────────────────────────
function log(emoji, msg) {
  console.log(new Date().toISOString() + " " + emoji + " " + msg);
}

// ── HTTP server (health checks + internal MCP routes) ─
const server = http.createServer((req, res) => {
  // Internal routes for MCP server
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
          // Notify orchestrator about the new terminal
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
        // Return last N scrollback chunks (default all)
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

  // ── Ask User (MCP tool → bridge → orchestrator → frontend → answer back) ──
  if (req.method === "POST" && req.url === "/internal/ask-user") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const questionId = "ask-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

        // Resolve chatId from active Claude processes
        const activeChatId = payload.chatId !== "default" ? payload.chatId
          : (claudeProcesses.size > 0 ? Array.from(claudeProcesses.keys()).pop() : "default");

        // Forward question to orchestrator via WebSocket
        if (state.ws && state.ws.readyState === 1) {
          state.ws.send(JSON.stringify({
            type: "claude_message",
            chatId: activeChatId,
            data: {
              type: "assistant",
              message: {
                role: "assistant",
                content: [{
                  type: "tool_use",
                  id: questionId,
                  name: "AskUserQuestion",
                  input: payload.input || {},
                }],
                stop_reason: "tool_use",
              },
            },
          }));
        }

        // Wait for user answer (max 5 min)
        const ASK_TIMEOUT_MS = 300000;
        const entry = { resolve: null, timer: null };
        entry.timer = setTimeout(() => {
          pendingAskUser.delete(questionId);
          res.writeHead(408, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "User did not respond in time" }));
        }, ASK_TIMEOUT_MS);

        pendingAskUser.set(questionId, {
          resolve: (answer) => {
            clearTimeout(entry.timer);
            pendingAskUser.delete(questionId);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ answer }));
          },
        });
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Default health check
  res.writeHead(200);
  res.end("bridge-ok");
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

      // ── Claude commands ──────────────────────

      // Helper: write a JSONL message to a running Claude PTY process
      function pipeToStdin(proc, jsonObj) {
        if (proc) {
          proc.write(JSON.stringify(jsonObj) + "\\n");
        }
      }

      // Helper: spawn a new Claude process with bidirectional stream-json via PTY
      function spawnClaude(chatId, prompt, mode, model, sessionId) {
        const agentMode = mode || "agent";
        log("\\u{1F916}", "Spawning Claude for chat " + chatId + " mode=" + agentMode + ": " + prompt.slice(0, 50) + "...");

        const claudeArgs = [
          "--verbose",
          "--output-format", "stream-json",
          "--input-format", "stream-json",
        ];

        claudeArgs.push("--dangerously-skip-permissions");

        if (agentMode === "plan") {
          claudeArgs.push("--disallowedTools", "AskUserQuestion,Edit,Write,MultiEdit");
          claudeArgs.push("--append-system-prompt", "You are in Plan mode. Analyze the request and produce a detailed plan. You CANNOT create or edit files. Only use read-only tools to explore the codebase, then present your plan as text.");
        } else if (agentMode === "ask") {
          claudeArgs.push("--disallowedTools", "AskUserQuestion,Edit,Write,MultiEdit,Bash");
          claudeArgs.push("--append-system-prompt", "You are in Ask mode. Only answer the question using read-only tools. You CANNOT create, edit, or write files, or run shell commands.");
        } else {
          claudeArgs.push("--disallowedTools", "AskUserQuestion");
        }

        if (model) {
          claudeArgs.push("--model", model);
        }

        if (sessionId) {
          claudeArgs.push("--resume", sessionId);
        }

        claudeArgs.push("-p", prompt);

        try {
          const proc = pty.spawn("claude", claudeArgs, {
            name: "xterm-256color",
            cols: 200,
            rows: 50,
            cwd: PROJECT_DIR,
            env: { ...process.env, ANTHROPIC_API_KEY: API_KEY },
          });
          claudeProcesses.set(chatId, proc);

          let buffer = "";
          proc.onData((d) => {
            buffer += d;
            const lines = buffer.split("\\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.replace(/[\\x00-\\x1f\\x7f]+(\\[\\?[\\d;]*[a-zA-Z])?/g, "").trim();
              if (!trimmed) continue;
              try {
                const parsed = JSON.parse(trimmed);
                ws.send(JSON.stringify({ type: "claude_message", chatId: chatId, data: parsed }));
              } catch {}
            }
          });

          proc.onExit(({ exitCode }) => {
            if (buffer.trim()) {
              const trimmed = buffer.replace(/[\\x00-\\x1f\\x7f]+(\\[\\?[\\d;]*[a-zA-Z])?/g, "").trim();
              try {
                const parsed = JSON.parse(trimmed);
                ws.send(JSON.stringify({ type: "claude_message", chatId: chatId, data: parsed }));
              } catch {}
            }
            ws.send(JSON.stringify({ type: "claude_exit", chatId: chatId, code: exitCode }));
            claudeProcesses.delete(chatId);
          });
        } catch (e) {
          ws.send(JSON.stringify({ type: "claude_error", chatId: chatId, error: e.message || String(e) }));
          claudeProcesses.delete(chatId);
        }
      }

      if (msg.type === "start_claude") {
        const chatId = msg.chatId || "default";
        const existing = claudeProcesses.get(chatId);

        if (existing && existing.pid > 0) {
          log("\\u{1F916}", "Piping follow-up to existing Claude for chat " + chatId + ": " + msg.prompt.slice(0, 50) + "...");
          pipeToStdin(existing, {
            type: "user",
            message: { role: "user", content: msg.prompt },
          });
        } else {
          if (existing) { try { existing.kill(); } catch {} claudeProcesses.delete(chatId); }
          spawnClaude(chatId, msg.prompt, msg.mode, msg.model, msg.sessionId);
        }

      } else if (msg.type === "claude_user_answer") {
        const pending = pendingAskUser.get(msg.toolUseId);
        if (pending) {
          log("\\u{1F916}", "Resolving MCP ask-user for tool=" + msg.toolUseId);
          pending.resolve(msg.answer);
        } else {
          const proc = claudeProcesses.get(msg.chatId);
          if (proc && proc.pid > 0) {
            log("\\u{1F916}", "Piping user answer for chat " + msg.chatId + " tool=" + msg.toolUseId);
            pipeToStdin(proc, {
              type: "user",
              message: {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: msg.toolUseId, content: msg.answer }],
              },
            });
          } else {
            ws.send(JSON.stringify({ type: "claude_error", chatId: msg.chatId, error: "No active Claude process to receive answer" }));
          }
        }

      } else if (msg.type === "claude_input") {
        const p = claudeProcesses.get(msg.chatId);
        if (p) {
          p.write(msg.data);
        }

      } else if (msg.type === "stop_claude") {
        const targetChatId = msg.chatId;
        if (targetChatId) {
          const p = claudeProcesses.get(targetChatId);
          if (p) { p.kill(); claudeProcesses.delete(targetChatId); }
        } else {
          for (const [cid, p] of claudeProcesses) { p.kill(); claudeProcesses.delete(cid); }
        }

      // ── Terminal commands ─────────────────────
      } else if (msg.type === "terminal_create") {
        try {
          const result = createTerminalPty(
            msg.terminalId, msg.name, msg.cols, msg.rows, msg.cwd, msg.command
          );
          if (result.error) {
            ws.send(JSON.stringify({ type: "terminal_error", terminalId: msg.terminalId, error: result.error }));
          } else {
            ws.send(JSON.stringify({ type: "terminal_created", terminalId: msg.terminalId, name: result.name }));
          }
        } catch (ptyErr) {
          log("\\u{274C}", "terminal_create failed: " + ptyErr);
          ws.send(JSON.stringify({ type: "terminal_error", terminalId: msg.terminalId, error: "Failed to create terminal: " + (ptyErr.message || String(ptyErr)) }));
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
    } catch (e) {
      log("\\u{274C}", "Message handler error: " + e);
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.terminalId) {
          ws.send(JSON.stringify({ type: "terminal_error", terminalId: parsed.terminalId, error: String(e) }));
        } else if (parsed.chatId) {
          ws.send(JSON.stringify({ type: "claude_error", chatId: parsed.chatId, error: String(e) }));
        }
      } catch {}
    }
  });

  ws.on("close", () => {
    log("\\u{1F50C}", "Orchestrator disconnected");
    for (const [cid, p] of claudeProcesses) { try { p.kill(); } catch {} claudeProcesses.delete(cid); }
  });
});

// ── Port scanning ────────────────────────────────────
const INTERNAL_PORTS = new Set([${port}, 9090, 22]);
let lastPortsJson = "";

function parseNetstatOutput(output) {
  const lines = output.split("\\n");
  const ports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.indexOf("LISTEN") === -1) continue;
    if (line.startsWith("Proto") || line.startsWith("Active")) continue;
    const parts = line.split(/\\s+/);
    // netstat -tlnp format:
    // Proto Recv-Q Send-Q Local-Address Foreign-Address State PID/Program
    // tcp   0      0      0.0.0.0:3000  0.0.0.0:*       LISTEN 12950/python3
    if (parts.length < 6) continue;
    const localAddr = parts[3] || "";
    // Skip localhost-only listeners
    if (localAddr.startsWith("127.") || localAddr.startsWith("::1:")) continue;
    // Extract port: always after the last colon
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
  return ports.filter((p) => {
    if (seen.has(p.port)) return false;
    seen.add(p.port);
    return true;
  }).sort((a, b) => a.port - b.port);
}

setInterval(() => {
  if (!state.ws || state.ws.readyState !== 1) return;
  try {
    const proc = spawn("netstat", ["-tlnp"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout.on("data", (chunk) => { output += chunk.toString(); });
    proc.on("close", () => {
      const ports = parseNetstatOutput(output);
      const json = JSON.stringify(ports);
      if (json !== lastPortsJson) {
        lastPortsJson = json;
        state.ws.send(JSON.stringify({ type: "ports_update", ports }));
      }
    });
    proc.on("error", () => {});
  } catch (e) { /* netstat not available */ }
}, 3000);

server.listen(PORT, "0.0.0.0", () => {
  log("\\u{2705}", "Bridge ready on port " + PORT);
});
`;
}
