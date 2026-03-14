/**
 * Returns the JavaScript source for the bridge server that runs
 * INSIDE a Daytona sandbox. It is uploaded via sandbox.fs.uploadFile().
 *
 * Handles agent CLI orchestration (Claude Code, OpenCode, Codex) AND
 * multi-terminal PTY sessions.
 */
export function getBridgeScript(
  port: number,
  projectDir?: string,
  agentType?: string,
  _agentConfig?: Record<string, unknown>,
): string {
  const safeProjDir = projectDir ? projectDir.replace(/"/g, '\\"') : '';
  const safeAgentType = agentType || 'claude_code';
  return `const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn, execSync } = require("child_process");
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
const AGENT_TYPE = "${safeAgentType}";

let state = { ws: null };
const agentProcesses = new Map();
const terminals = new Map();
const pendingAskUser = new Map();

// ── Logging ──────────────────────────────────────────
function log(emoji, msg) {
  console.log(new Date().toISOString() + " " + emoji + " " + msg);
}

// ── Emit helpers ─────────────────────────────────────
function emitAgentMessage(chatId, data) {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "claude_message", chatId: chatId, data: data }));
  }
}
function emitAgentExit(chatId, code) {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "claude_exit", chatId: chatId, code: code }));
  }
}
function emitAgentError(chatId, error) {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: "claude_error", chatId: chatId, error: error }));
  }
}

// ══════════════════════════════════════════════════════
// ── Agent Adapters ───────────────────────────────────
// ══════════════════════════════════════════════════════

const claudeAdapter = {
  name: "claude_code",
  processModel: "long-lived",

  spawn(chatId, prompt, mode, model, sessionId) {
    const agentMode = mode || "agent";
    log("\\u{1F916}", "Spawning Claude for chat " + chatId + " mode=" + agentMode);

    const claudeArgs = ["--verbose", "--output-format", "stream-json", "--input-format", "stream-json"];
    claudeArgs.push("--dangerously-skip-permissions");

    if (agentMode === "plan") {
      claudeArgs.push("--disallowedTools", "AskUserQuestion,Edit,Write,MultiEdit");
      claudeArgs.push("--append-system-prompt", "You are in Plan mode. Analyze the request and produce a detailed plan. You CANNOT create or edit files. Only use read-only tools to explore the codebase. When presenting your plan, you MUST wrap the entire plan in fenced code blocks with the language tag \\"plan\\". Use this exact format:\\n\\n" + String.fromCharCode(96,96,96) + "plan\\n[Your plan content - use markdown. Include a File Structure section with the actual directory tree or list of files to create - do not leave it empty.]\\n" + String.fromCharCode(96,96,96) + "\\n\\nThe UI detects plans ONLY when they use this exact delimiter. You may call get_plan_format_instructions for the full specification.");
    } else if (agentMode === "ask") {
      claudeArgs.push("--disallowedTools", "AskUserQuestion,Edit,Write,MultiEdit,Bash");
      claudeArgs.push("--append-system-prompt", "You are in Ask mode. Only answer the question using read-only tools. You CANNOT create, edit, or write files, or run shell commands.");
    } else {
      claudeArgs.push("--disallowedTools", "AskUserQuestion");
    }
    if (model) claudeArgs.push("--model", model);
    if (sessionId) claudeArgs.push("--resume", sessionId);
    claudeArgs.push("-p", prompt);

    const proc = pty.spawn("claude", claudeArgs, {
      name: "xterm-256color", cols: 200, rows: 50, cwd: PROJECT_DIR,
      env: { ...process.env, ANTHROPIC_API_KEY: API_KEY },
    });

    let buffer = "";
    proc.onData((d) => {
      buffer += d;
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.replace(/[\\x00-\\x1f\\x7f]+(\\[\\?[\\d;]*[a-zA-Z])?/g, "").trim();
        if (!trimmed) continue;
        try { emitAgentMessage(chatId, JSON.parse(trimmed)); } catch {}
      }
    });

    proc.onExit(({ exitCode }) => {
      if (buffer.trim()) {
        const trimmed = buffer.replace(/[\\x00-\\x1f\\x7f]+(\\[\\?[\\d;]*[a-zA-Z])?/g, "").trim();
        try { emitAgentMessage(chatId, JSON.parse(trimmed)); } catch {}
      }
      emitAgentExit(chatId, exitCode);
      agentProcesses.delete(chatId);
    });

    return proc;
  },

  isAlive(entry) { return entry.proc && entry.proc.pid > 0; },

  sendFollowUp(entry, prompt) {
    if (entry.proc) {
      entry.proc.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\\n");
      return true;
    }
    return null;
  },

  sendUserAnswer(entry, toolUseId, answer) {
    if (entry.proc) {
      entry.proc.write(JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: answer }] },
      }) + "\\n");
    }
  },

  kill(entry) { if (entry.proc) { try { entry.proc.kill(); } catch {} } },
};

// ── OpenCode Adapter ─────────────────────────────────
const openCodeAdapter = {
  name: "open_code",
  processModel: "per-prompt",

  spawn(chatId, prompt, mode, model, sessionId) {
    const ocModel = model || "opencode/gpt-5-nano";
    log("\\u{1F916}", "Spawning OpenCode for chat " + chatId + " model=" + ocModel);
    const ocBin = "/home/daytona/.opencode/bin/opencode";
    const args = ["run", "--format", "json", "-m", ocModel];
    if (sessionId) args.push("--session", sessionId);
    args.push(prompt);

    log("\\u{1F916}", "OpenCode cmd: " + ocBin + " " + args.join(" ") + " cwd=" + PROJECT_DIR);
    const proc = pty.spawn(ocBin, args, {
      name: "xterm-256color", cols: 200, rows: 50, cwd: PROJECT_DIR,
      env: { ...process.env, HOME: "/home/daytona" },
    });
    let capturedSessionId = null;
    let stepCost = 0;
    let stderrBuf = "";
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
            const ex = agentProcesses.get(chatId);
            if (ex) ex.sessionId = capturedSessionId;
            emitAgentMessage(chatId, { type: "system", subtype: "init", session_id: capturedSessionId, tools: [], model: ocModel, cwd: PROJECT_DIR });
          }
          if (ev.type === "text") {
            emitAgentMessage(chatId, { type: "assistant", message: { role: "assistant", model: ocModel, content: [{ type: "text", text: ev.part.text || "" }], stop_reason: "end_turn" } });
          } else if (ev.type === "tool_use") {
            const s = ev.part.state || {};
            const tn = ev.part.tool || "unknown";
            const nn = { bash: "Bash", read: "Read", glob: "Glob", grep: "Grep", apply_patch: "Write", write: "Write", edit: "Edit" }[tn] || tn;
            emitAgentMessage(chatId, { type: "assistant", message: { role: "assistant", model: ocModel, content: [
              { type: "tool_use", id: ev.part.callID || ev.part.id, name: nn, input: s.input || {} },
              { type: "tool_result", tool_use_id: ev.part.callID || ev.part.id, content: typeof s.output === "string" ? s.output : JSON.stringify(s.output || "") },
            ], stop_reason: "tool_use" } });
          } else if (ev.type === "step_finish") {
            stepCost += ev.part.cost || 0;
            if (ev.part.reason === "stop") {
              const tk = ev.part.tokens || {};
              emitAgentMessage(chatId, { type: "result", subtype: "success", is_error: false, duration_ms: 0, num_turns: 1, result: "", session_id: capturedSessionId || "", total_cost_usd: stepCost, usage: { input_tokens: tk.input || 0, output_tokens: tk.output || 0 } });
            }
          } else if (ev.type === "error") {
            emitAgentError(chatId, (ev.error && ev.error.data && ev.error.data.message) || "OpenCode error");
          }
        } catch {}
      }
    });

    proc.onExit(({ exitCode }) => {
      if (buffer.trim()) {
        const trimmed = buffer.replace(/[\\x00-\\x1f\\x7f]+(\\[\\?[\\d;]*[a-zA-Z])?/g, "").trim();
        try { const ev = JSON.parse(trimmed); if (ev.type) { /* process last line */ } } catch {}
      }
      log("\\u{1F916}", "OpenCode exited for chat " + chatId + " code=" + exitCode);
      if (!capturedSessionId && exitCode !== 0) {
        emitAgentError(chatId, "OpenCode exited with code " + exitCode);
      }
      agentProcesses.delete(chatId);
      emitAgentExit(chatId, exitCode || 0);
    });
    return proc;
  },

  isAlive(entry) { return entry.proc && entry.proc.pid > 0; },
  sendFollowUp() { return null; },
  sendUserAnswer(entry) { emitAgentError(entry.chatId || "default", "OpenCode does not support user answers"); },
  kill(entry) { if (entry.proc) { try { entry.proc.kill(); } catch {} } },
};

// ── Codex Adapter (app-server) ───────────────────────
const codexAdapter = {
  name: "codex",
  processModel: "long-lived",

  spawn(chatId, prompt, mode, model, sessionId) {
    const cm = model || "gpt-4o";
    log("\\u{1F916}", "Spawning Codex app-server for chat " + chatId + " model=" + cm);
    const proc = spawn("codex", ["app-server", "--listen", "stdio://"], {
      cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"], env: process.env,
    });

    const entry = { proc, adapter: codexAdapter, sessionId: null, threadId: null, rpcId: 100, chatId, pendingPrompt: prompt, pendingModel: cm };
    const readline = require("readline");
    const rl = readline.createInterface({ input: proc.stdout });

    function rpc(msg) { proc.stdin.write(JSON.stringify(msg) + "\\n"); }

    let initDone = false;
    let threadStarted = false;
    let textBuf = "";

    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);

        if (msg.id === 0 && msg.result && !initDone) {
          initDone = true;
          rpc({ method: "initialized", params: {} });
          setTimeout(() => {
            entry.rpcId++;
            rpc({ method: "thread/start", id: entry.rpcId, params: { model: entry.pendingModel, cwd: PROJECT_DIR, approvalPolicy: "never", sandbox: "danger-full-access" } });
          }, 100);
          return;
        }

        if (msg.method === "thread/started" && msg.params?.thread?.id && !threadStarted) {
          threadStarted = true;
          entry.threadId = msg.params.thread.id;
          entry.sessionId = entry.threadId;
          emitAgentMessage(chatId, { type: "system", subtype: "init", session_id: entry.threadId, tools: [], model: entry.pendingModel, cwd: PROJECT_DIR });
          setTimeout(() => {
            entry.rpcId++;
            rpc({ method: "turn/start", id: entry.rpcId, params: { threadId: entry.threadId, input: [{ type: "text", text: entry.pendingPrompt }] } });
            entry.pendingPrompt = null;
          }, 100);
          return;
        }

        if (msg.method === "item/started") {
          const it = msg.params?.item || {};
          if (it.type === "commandExecution" && it.status === "inProgress") {
            emitAgentMessage(chatId, { type: "assistant", message: { role: "assistant", model: entry.pendingModel, content: [{ type: "tool_use", id: it.id, name: "Bash", input: { command: it.command || "" } }], stop_reason: "tool_use" } });
          } else if (it.type === "agentMessage") {
            textBuf = "";
          }
        }

        if (msg.method === "item/agentMessage/delta") {
          textBuf += (msg.params?.text || msg.params?.delta || "");
        }

        if (msg.method === "item/completed") {
          const it = msg.params?.item || {};
          if (it.type === "commandExecution" && it.status === "completed") {
            emitAgentMessage(chatId, { type: "assistant", message: { role: "assistant", model: entry.pendingModel, content: [{ type: "tool_result", tool_use_id: it.id, content: it.aggregated_output || "" }], stop_reason: "tool_use" } });
          } else if (it.type === "agentMessage") {
            emitAgentMessage(chatId, { type: "assistant", message: { role: "assistant", model: entry.pendingModel, content: [{ type: "text", text: it.text || textBuf }], stop_reason: "end_turn" } });
            textBuf = "";
          } else if (it.type === "fileChange") {
            for (const ch of (it.changes || [])) {
              emitAgentMessage(chatId, { type: "assistant", message: { role: "assistant", model: entry.pendingModel, content: [
                { type: "tool_use", id: it.id + "-" + (ch.path || ""), name: "Write", input: { file_path: ch.path, diff: ch.diff } },
                { type: "tool_result", tool_use_id: it.id + "-" + (ch.path || ""), content: "File changed: " + (ch.path || "") },
              ], stop_reason: "tool_use" } });
            }
          }
        }

        if (msg.method === "turn/completed") {
          const turn = msg.params?.turn || {};
          const usage = msg.params?.usage || {};
          const failed = turn.status === "failed";
          if (failed) emitAgentError(chatId, turn.error?.message || "Codex turn failed");
          emitAgentMessage(chatId, { type: "result", subtype: failed ? "error" : "success", is_error: failed, duration_ms: 0, num_turns: 1, result: "", session_id: entry.threadId || "", total_cost_usd: 0, usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 } });
        }

        if (msg.method === "error" && msg.params?.error && !msg.params?.willRetry) {
          emitAgentError(chatId, msg.params.error.message || "Codex error");
        }
      } catch {}
    });

    proc.stderr.on("data", (d) => log("\\u{1F916}", "Codex stderr: " + d.toString().trim().slice(0, 200)));
    proc.on("exit", (code) => {
      log("\\u{1F916}", "Codex app-server exited for chat " + chatId + " code=" + code);
      agentProcesses.delete(chatId);
      emitAgentExit(chatId, code || 0);
    });

    rpc({ method: "initialize", id: 0, params: { clientInfo: { name: "apex", title: "Apex", version: "0.1.0" } } });
    return proc;
  },

  isAlive(entry) { return entry.proc && !entry.proc.killed && entry.proc.exitCode === null; },

  sendFollowUp(entry, prompt) {
    if (!entry.proc || !entry.threadId) return null;
    entry.rpcId = (entry.rpcId || 100) + 1;
    entry.proc.stdin.write(JSON.stringify({ method: "turn/start", id: entry.rpcId, params: { threadId: entry.threadId, input: [{ type: "text", text: prompt }] } }) + "\\n");
    return true;
  },

  sendUserAnswer(entry, toolUseId, answer) {
    if (entry.proc && entry.threadId) {
      entry.rpcId = (entry.rpcId || 100) + 1;
      entry.proc.stdin.write(JSON.stringify({ method: "turn/steer", id: entry.rpcId, params: { threadId: entry.threadId, input: [{ type: "text", text: answer }] } }) + "\\n");
    }
  },

  kill(entry) {
    if (entry.proc) { try { entry.proc.stdin.end(); } catch {} try { entry.proc.kill(); } catch {} }
  },
};

// ── Adapter registry ─────────────────────────────────
const adapters = { claude_code: claudeAdapter, open_code: openCodeAdapter, codex: codexAdapter };
function getAdapter(t) { return adapters[t] || adapters.claude_code; }

// ── Bridge core ──────────────────────────────────────
function spawnAgent(chatId, prompt, mode, model, sessionId, agentType) {
  const adapter = getAdapter(agentType || AGENT_TYPE);
  try {
    const proc = adapter.spawn(chatId, prompt, mode, model, sessionId);
    agentProcesses.set(chatId, { proc, adapter, sessionId, chatId });
  } catch (e) { emitAgentError(chatId, e.message || String(e)); }
}

function handleStartAgent(msg) {
  const chatId = msg.chatId || "default";
  const at = msg.agentType || AGENT_TYPE;
  const adapter = getAdapter(at);
  const existing = agentProcesses.get(chatId);

  if (existing && adapter.isAlive(existing)) {
    if (adapter.processModel === "long-lived") {
      log("\\u{1F916}", "Follow-up to existing " + adapter.name + " for chat " + chatId);
      const ok = adapter.sendFollowUp(existing, msg.prompt);
      if (ok !== null) return;
    }
    adapter.kill(existing);
    agentProcesses.delete(chatId);
  } else if (existing) {
    adapter.kill(existing);
    agentProcesses.delete(chatId);
  }

  spawnAgent(chatId, msg.prompt, msg.mode, msg.model, msg.sessionId, at);
}

function handleUserAnswer(msg) {
  let pending = pendingAskUser.get(msg.toolUseId);
  if (!pending && msg.chatId) {
    for (const [, entry] of pendingAskUser) {
      if (entry.chatId === msg.chatId) { pending = entry; break; }
    }
  }
  if (pending) { pending.resolve(msg.answer); return; }
  const entry = agentProcesses.get(msg.chatId);
  if (entry && entry.adapter.isAlive(entry)) {
    entry.adapter.sendUserAnswer(entry, msg.toolUseId, msg.answer);
  } else { emitAgentError(msg.chatId, "No active agent process to receive answer"); }
}

function handleStopAgent(msg) {
  if (msg.chatId) {
    const e = agentProcesses.get(msg.chatId);
    if (e) { e.adapter.kill(e); agentProcesses.delete(msg.chatId); }
  } else {
    for (const [cid, e] of agentProcesses) { e.adapter.kill(e); agentProcesses.delete(cid); }
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
    inotifyProc = spawn("inotifywait", ["-mr", "--format", "%w", "-e", "create,delete,move,modify", "--exclude", "(/\\\\.git/|/node_modules/)", PROJECT_DIR], { stdio: ["ignore", "pipe", "pipe"] });
    inotifyProc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\\n")) { const d = line.trim().replace(/\\/$/, ""); if (d) changedDirs.add(d); }
      if (changedDirs.size > 0) { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(flushFileChanges, 300); }
    });
    inotifyProc.stderr.on("data", (chunk) => { const m = chunk.toString().trim(); if (m && !m.startsWith("Setting up watches") && !m.startsWith("Watches established")) log("\\u{1F441}", "inotify stderr: " + m); });
    inotifyProc.on("exit", (code) => { inotifyProc = null; setTimeout(() => { watcherRestartDelay = Math.min(watcherRestartDelay * 2, WATCHER_MAX_RESTART_DELAY); startFileWatcher(); }, watcherRestartDelay); });
    inotifyProc.on("error", (err) => { inotifyProc = null; watcherFatalError = true; });
    watcherRestartDelay = 1000;
  } catch (e) { watcherFatalError = true; }
}
function flushFileChanges() {
  if (changedDirs.size === 0) return;
  const dirs = Array.from(changedDirs); changedDirs.clear();
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: "file_changed", dirs }));
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
        const activeChatId = payload.chatId !== "default" ? payload.chatId : (agentProcesses.size > 0 ? Array.from(agentProcesses.keys()).pop() : "default");
        emitAgentMessage(activeChatId, { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: questionId, name: "AskUserQuestion", input: payload.input || {} }], stop_reason: "tool_use" } });
        if (state.ws && state.ws.readyState === 1) {
          state.ws.send(JSON.stringify({ type: "ask_user_pending", chatId: activeChatId, questionId: questionId }));
        }
        const ASK_TIMEOUT_MS = 300000;
        const entry = { resolve: null, timer: null };
        entry.timer = setTimeout(() => {
          pendingAskUser.delete(questionId);
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({ type: "ask_user_resolved", chatId: activeChatId, questionId: questionId }));
          }
          res.writeHead(408, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "User did not respond in time" }));
        }, ASK_TIMEOUT_MS);
        pendingAskUser.set(questionId, { chatId: activeChatId, resolve: (answer) => {
          clearTimeout(entry.timer); pendingAskUser.delete(questionId);
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({ type: "ask_user_resolved", chatId: activeChatId, questionId: questionId }));
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
  log("\\u{1F517}", "Orchestrator connected (agent=" + AGENT_TYPE + ")");
  state.ws = ws;
  ws.send(JSON.stringify({ type: "bridge_ready", port: PORT }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "start_claude") { handleStartAgent(msg); }
      else if (msg.type === "claude_user_answer") { handleUserAnswer(msg); }
      else if (msg.type === "claude_input") {
        const e = agentProcesses.get(msg.chatId);
        if (e && e.proc) { if (e.proc.write) e.proc.write(msg.data); else if (e.proc.stdin) e.proc.stdin.write(msg.data); }
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
      try { const p = JSON.parse(data.toString()); if (p.terminalId) ws.send(JSON.stringify({ type: "terminal_error", terminalId: p.terminalId, error: String(e) })); else if (p.chatId) ws.send(JSON.stringify({ type: "claude_error", chatId: p.chatId, error: String(e) })); } catch {}
    }
  });

  ws.on("close", () => {
    log("\\u{1F50C}", "Orchestrator disconnected");
    for (const [cid, e] of agentProcesses) { e.adapter.kill(e); agentProcesses.delete(cid); }
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

server.listen(PORT, "0.0.0.0", () => { log("\\u{2705}", "Bridge ready on port " + PORT + " (agent=" + AGENT_TYPE + ")"); });
`;
}
