# Claude in the Sandbox – How It Works

## Overview

Claude Code CLI runs inside Daytona sandboxes. The CLI binary is **pre-installed in the sandbox snapshot image** (`daytona-claude-l`). At runtime, a Node.js "bridge" layer is uploaded into the sandbox to manage the Claude process and relay its output back to the API server over WebSocket.

---

## 1. Sandbox Snapshot

Sandboxes are created from a Daytona snapshot that already contains the `claude` CLI on `$PATH`:

```
snapshot: config.snapshot || 'daytona-claude-l'
```

> **Source:** `libs/orchestrator/src/lib/sandbox-manager.ts`

No `npm install -g @anthropic-ai/claude-code` or similar step happens at runtime — the binary is baked into the image.

---

## 2. Runtime Setup (Bridge Installation)

When a project is created, `SandboxManager.createSandbox()` calls `installBridge()`, which performs the following steps inside the sandbox:

### 2.1 Create bridge directory

A working directory is created to hold the bridge scripts and their dependencies.

### 2.2 Upload bridge scripts

Two scripts are uploaded via the Daytona SDK (`sandbox.fs.uploadFile`):

| File | Purpose |
|---|---|
| `bridge.js` | WebSocket server that manages the Claude CLI process with bidirectional stdin/stdout JSON streaming, and handles PTY terminal sessions |
| `mcp-terminal-server.js` | MCP (Model Context Protocol) server that gives Claude access to terminal sessions inside the sandbox |

Both scripts are generated in-memory from template functions (`getBridgeScript()`, `getMcpTerminalScript()`) in `libs/orchestrator/src/lib/bridge-script.ts`.

### 2.3 Register MCP server with Claude Code

Claude Code reads MCP configuration from `~/.claude/mcp.json`. The bridge installer writes this file so that Claude automatically discovers the terminal MCP server:

```json
{
  "mcpServers": {
    "terminal-server": {
      "command": "node",
      "args": ["/path/to/bridge/mcp-terminal-server.js"]
    }
  }
}
```

This is written to `/home/daytona/.claude/mcp.json`.

### 2.4 Install Node.js dependencies

The bridge needs `ws` (WebSocket library) and `node-pty` (PTY/terminal emulation):

```bash
npm init -y
npm install ws node-pty
```

### 2.5 Start the bridge process

The bridge is started as a background Daytona session process:

```bash
cd /bridge/dir && ANTHROPIC_API_KEY="sk-..." node bridge.js
```

The bridge opens a WebSocket server on port 8080 (exposed via Daytona's preview URL mechanism). The orchestrator connects to this port from the outside.

---

## 3. How Claude CLI Is Invoked

When a user sends the first prompt in a chat, the bridge spawns the Claude CLI as a long-lived child process with bidirectional JSON streaming:

```bash
claude --dangerously-skip-permissions --verbose --output-format stream-json --input-format stream-json -p "<prompt>"
```

| Flag | Purpose |
|---|---|
| `--dangerously-skip-permissions` | Auto-approves all tool use (file edits, commands, etc.) without user confirmation |
| `--verbose` | Enables verbose logging |
| `--output-format stream-json` | Outputs structured JSON messages, one per line, enabling real-time streaming |
| `--input-format stream-json` | Accepts structured JSONL input on stdin, enabling follow-up prompts and user answers mid-conversation |
| `-p <prompt>` | The initial prompt text |

The process is spawned via PTY (`node-pty`) for line-buffered output, and the bridge writes JSONL messages to the PTY's stdin for follow-up prompts and user answers. The `ANTHROPIC_API_KEY` environment variable is set in the bridge process and inherited by the Claude child process.

---

## 4. Data Flow

```
User (Dashboard)
  │
  │  Socket.io: execute_chat / send_prompt / user_answer
  ▼
API Server (AgentGateway)
  │
  │  SandboxManager.sendPrompt() / sendUserAnswer()
  ▼
Bridge (inside sandbox, port 8080 via WSS preview URL)
  │
  │  spawn("claude", [...]) on first prompt
  ▼
Claude CLI Process (long-lived, bidirectional)
  │
  │  stdout → bridge: stream-json lines
  │  stdin  ← bridge: follow-up prompts + user answers (JSONL)
  ▼
Bridge parses JSON lines
  │
  │  WebSocket: { type: "claude_message", data: ... }
  ▼
SandboxManager → emits "message" event
  │
  │  Socket.io: agent_message
  ▼
Dashboard (real-time rendering)
```

### Message types: bridge → orchestrator

| Type | Description |
|---|---|
| `bridge_ready` | Bridge is up and listening |
| `claude_message` | Parsed JSON message from Claude's stream-json output |
| `claude_stdout` | Raw stdout line that couldn't be parsed as JSON |
| `claude_stderr` | Stderr output from Claude |
| `claude_exit` | Claude process exited (includes exit code) |
| `claude_error` | Error spawning or managing Claude |
| `terminal_output` | PTY terminal output |
| `terminal_created` | New terminal session created |
| `terminal_exit` | Terminal session ended |

### Message types: orchestrator → bridge

| Type | Description |
|---|---|
| `start_claude` | Spawn a new Claude process, or pipe a follow-up prompt to an existing one |
| `claude_user_answer` | Pipe the user's answer to an `AskUserQuestion` tool call to Claude's stdin |
| `claude_input` | Raw stdin data for a running Claude process |
| `stop_claude` | Kill the Claude process for a chat |

---

## 5. Follow-up Prompts & AskUserQuestion

The Claude process stays alive across multiple turns within a chat. When a follow-up message arrives, the bridge pipes it as a JSONL user message to the running process's stdin:

```json
{"type":"user","message":{"role":"user","content":"follow-up text"}}
```

A new process is only spawned if the previous one has exited (e.g. after a crash or page reload), in which case `--resume <sessionId>` is used to restore context.

### AskUserQuestion

When Claude calls the `AskUserQuestion` tool, the bridge forwards the `tool_use` block to the dashboard. The dashboard renders a multiple-choice UI. When the user answers, the response is piped back to Claude's stdin as a `tool_result`:

```json
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_xxx","content":"Format: Summary"}]}}
```

---

## 6. Key Files

| File | Role |
|---|---|
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Creates sandboxes, installs bridge, manages WebSocket connections, sends prompts |
| `libs/orchestrator/src/lib/bridge-script.ts` | Generates the `bridge.js` source code (template function) |
| `libs/orchestrator/src/lib/types.ts` | TypeScript types for all bridge protocol messages |
| `apps/api/src/modules/agent/agent.gateway.ts` | Socket.io gateway that connects the dashboard to the sandbox manager |
| `apps/api/src/modules/projects/projects.service.ts` | Triggers sandbox provisioning on project creation |
