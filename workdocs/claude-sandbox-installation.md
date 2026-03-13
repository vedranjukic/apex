# Agent CLIs in the Sandbox – How It Works

## Overview

Agent CLIs (Claude Code, OpenCode, or Codex) run inside Daytona sandboxes. The CLI binaries are **pre-installed in the sandbox snapshot image**. At runtime, a Node.js "bridge" layer is uploaded into the sandbox to manage the agent process and relay its output back to the API server over WebSocket. The bridge uses an adapter pattern — each agent type has an adapter that handles spawning, output parsing, and follow-up routing, while normalizing all output into a unified event format.

### Multi-Agent Support

The bridge now supports three agent backends selected by the project's `agentType` field:

| Agent | Binary | Process Model | Follow-ups |
|---|---|---|---|
| **Claude Code** (`claude_code`) | `claude` | Long-lived process, JSONL stdin/stdout | Pipe user messages to stdin |
| **OpenCode** (`open_code`) | `opencode` | Per-prompt process | `--session <id>` flag on new process |
| **Codex** (`codex`) | `codex app-server` | Long-lived JSON-RPC server | `turn/start` on same thread |

All three produce the same normalized events (`system`/`assistant`/`result`) so the gateway and dashboard remain agent-agnostic.

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
| `bridge.js` | WebSocket server that manages agent CLI processes, handles PTY terminal sessions, and coordinates the `ask_user` question/answer flow |
| `mcp-terminal-server.js` | MCP server that gives agents access to terminals, preview URLs, and the `ask_user` tool for blocking user questions |

Both scripts are generated in-memory from template functions (`getBridgeScript()`, `getMcpTerminalScript()`) in `libs/orchestrator/src/lib/bridge-script.ts`.

### 2.3 Register MCP server with agents

Each agent type has its own MCP configuration:

| Agent | MCP Config |
|---|---|
| Claude Code | `~/.claude.json` with `mcpServers.terminal-server` (stdio) |
| OpenCode | `opencode.json` in project dir with `mcp.terminal-server` |
| Codex | `codex mcp add terminal-server -- node <bridge-dir>/mcp-terminal-server.js` |

The MCP terminal server provides tools for terminals, preview URLs, plan format, and `ask_user` (blocks until the user responds, triggers `waiting_for_input` status).

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
| `ask_user_pending` | Agent asked a question via MCP `ask_user` — chat status → `waiting_for_input` |
| `ask_user_resolved` | User answered (or timeout) — chat status → `running` |
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

### AskUserQuestion / ask_user

Claude's native `AskUserQuestion` tool is **disallowed** in all modes via `--disallowedTools`. Instead, agents use the MCP `ask_user` tool (`mcp__terminal-server__ask_user`), which routes through the bridge:

1. Agent calls MCP `ask_user` → MCP server POSTs to bridge `/internal/ask-user`
2. Bridge emits `claude_message` (AskUserQuestion tool_use) + `ask_user_pending` over WebSocket
3. Chat status → `waiting_for_input` (persisted to DB)
4. Dashboard renders `AskQuestionBlock`; CLI TUI shows answer prompt
5. User answers → `user_answer` socket event (or `answerCh` in CLI) → bridge resolves pending HTTP
6. Bridge emits `ask_user_resolved` → status → `running`; MCP returns answer to agent
7. Pending questions time out after 5 minutes

The sandbox CLAUDE.md / AGENTS.md instructions explicitly tell agents to use `mcp__terminal-server__ask_user` for questions and not ask in plain text.

---

## 6. Key Files

| File | Role |
|---|---|
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Creates sandboxes, installs bridge, manages WebSocket connections, sends prompts |
| `libs/orchestrator/src/lib/bridge-script.ts` | Generates the `bridge.js` source code (template function) |
| `libs/orchestrator/src/lib/mcp-terminal-script.ts` | Generates the MCP terminal server (ask_user, terminals, preview URLs) |
| `libs/orchestrator/src/lib/types.ts` | TypeScript types for all bridge protocol messages |
| `apps/api/src/modules/agent/agent.gateway.ts` | Socket.io gateway that connects the dashboard to the sandbox manager |
| `apps/api/src/modules/projects/projects.service.ts` | Triggers sandbox provisioning on project creation |
| `apps/cli/internal/sandbox/scripts.go` | Go CLI mirror of bridge + MCP scripts |
| `apps/cli/internal/chat/bridge.go` | Go CLI bridge message processing (handles `ask_user_pending`/`ask_user_resolved`) |
