package sandbox

import (
	"fmt"
	"strings"
)

const bridgePort = 8080

// GenerateBridgeScript returns the JavaScript source for bridge.js
// that runs inside a Daytona sandbox. Identical to the TypeScript
// getBridgeScript() in libs/orchestrator/src/lib/bridge-script.ts.
func GenerateBridgeScript(port int, projectDir string) string {
	safeProjDir := strings.ReplaceAll(projectDir, `"`, `\"`)

	return fmt.Sprintf(`const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const pty = require("node-pty");
const crypto = require("crypto");

const PORT = %d;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PROJECT_DIR = "%s" || process.env.HOME || "/home/daytona";
const MAX_SCROLLBACK = 5000;
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY || "";
const DAYTONA_API_URL = (process.env.DAYTONA_API_URL || "https://app.daytona.io/api").replace(/\/$/, "");
const SANDBOX_ID = process.env.DAYTONA_SANDBOX_ID || "";
const https = require("https");
const urlMod = require("url");

let state = { ws: null };
const claudeProcesses = new Map();

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

function startFileWatcher() {
  if (inotifyProc) return;
  try {
    inotifyProc = spawn("inotifywait", [
      "-mr", "--format", "%%w", "-e", "create,delete,move,modify",
      "--exclude", "(/\\.git/|/node_modules/)",
      PROJECT_DIR,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    inotifyProc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        const dir = line.trim().replace(/\/$/, "");
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
        log("\u{1F441}", "inotify stderr: " + msg);
      }
    });

    inotifyProc.on("error", (e) => {
      log("\u{274C}", "File watcher error: " + e.message + " — is inotify-tools installed?");
      inotifyProc = null;
    });

    inotifyProc.on("exit", (code) => {
      log("\u{1F441}", "inotifywait exited with code " + code);
      inotifyProc = null;
    });

    log("\u{1F441}", "File watcher (inotifywait) started for " + PROJECT_DIR);
  } catch (e) {
    log("\u{274C}", "File watcher failed: " + e.message + " — is inotify-tools installed?");
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

      function pipeToStdin(proc, jsonObj) {
        if (proc) {
          proc.write(JSON.stringify(jsonObj) + "\n");
        }
      }

      function spawnClaude(chatId, prompt, mode, model, sessionId) {
        const agentMode = mode || "agent";
        log("\u{1F916}", "Spawning Claude for chat " + chatId + " mode=" + agentMode + ": " + prompt.slice(0, 50) + "...");

        const claudeArgs = [
          "--verbose",
          "--output-format", "stream-json",
          "--input-format", "stream-json",
        ];

        if (agentMode === "plan") {
          claudeArgs.push("--dangerously-skip-permissions");
          claudeArgs.push("--disallowedTools", "Edit", "Write", "MultiEdit");
          claudeArgs.push("--append-system-prompt", "You are in Plan mode. Analyze the request and produce a detailed plan. You CANNOT create or edit files. Only use read-only tools to explore the codebase, then present your plan as text.");
        } else if (agentMode === "ask") {
          claudeArgs.push("--dangerously-skip-permissions");
          claudeArgs.push("--disallowedTools", "Edit", "Write", "MultiEdit", "Bash");
          claudeArgs.push("--append-system-prompt", "You are in Ask mode. Only answer the question using read-only tools. You CANNOT create, edit, or write files, or run shell commands.");
        } else {
          claudeArgs.push("--dangerously-skip-permissions");
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
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.replace(/[\x00-\x1f\x7f]+(\[\?[\d;]*[a-zA-Z])?/g, "").trim();
              if (!trimmed) continue;
              try {
                const parsed = JSON.parse(trimmed);
                ws.send(JSON.stringify({ type: "claude_message", chatId: chatId, data: parsed }));
              } catch {}
            }
          });

          proc.onExit(({ exitCode }) => {
            if (buffer.trim()) {
              const trimmed = buffer.replace(/[\x00-\x1f\x7f]+(\[\?[\d;]*[a-zA-Z])?/g, "").trim();
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
          log("\u{1F916}", "Piping follow-up to existing Claude for chat " + chatId + ": " + msg.prompt.slice(0, 50) + "...");
          pipeToStdin(existing, {
            type: "user",
            message: { role: "user", content: msg.prompt },
          });
        } else {
          if (existing) { try { existing.kill(); } catch {} claudeProcesses.delete(chatId); }
          spawnClaude(chatId, msg.prompt, msg.mode, msg.model, msg.sessionId);
        }

      } else if (msg.type === "claude_user_answer") {
        const proc = claudeProcesses.get(msg.chatId);
        if (proc && proc.pid > 0) {
          log("\u{1F916}", "Piping user answer for chat " + msg.chatId + " tool=" + msg.toolUseId);
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
    for (const [cid, p] of claudeProcesses) { try { p.kill(); } catch {} claudeProcesses.delete(cid); }
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
