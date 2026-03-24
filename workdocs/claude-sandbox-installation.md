# Agent in the Sandbox – How It Works

## Overview

OpenCode runs inside sandboxes (Daytona cloud, Docker local, Apple Container, or local host). The OpenCode binary is **pre-installed in the sandbox snapshot image**. At runtime, a Node.js "bridge" layer is uploaded into the sandbox to manage the agent process and relay its output back to the API server over WebSocket.

Three named agents are available — **Build** (full autonomous coding), **Plan** (read-only analysis), and **Sisyphus** (orchestration) — all running through the same OpenCode runtime.

---

## 1. Sandbox Snapshot

Sandboxes are created from a snapshot that already contains the `opencode` binary on `$PATH`:

```
snapshot: config.snapshot || 'daytona-claude-l'
```

> **Source:** `libs/orchestrator/src/lib/sandbox-manager.ts`

No additional CLI installation happens at runtime — the binary is baked into the image.

---

## 2. Runtime Setup (Bridge Installation)

When a project is created, `SandboxManager.createSandbox()` calls `installBridge()`, which performs the following steps inside the sandbox:

### 2.1 Create bridge directory

A working directory is created to hold the bridge scripts and their dependencies.

### 2.2 Upload bridge scripts

Two scripts are uploaded via the sandbox provider's file system API:

| File | Purpose |
|---|---|
| `bridge.js` | WebSocket server that manages agent CLI processes, handles PTY terminal sessions, and coordinates the `ask_user` question/answer flow |
| `mcp-terminal-server.js` | MCP server that gives agents access to terminals, preview URLs, and the `ask_user` tool for blocking user questions |

Both scripts are generated in-memory from template functions (`getBridgeScript()`, `getMcpTerminalScript()`) in `libs/orchestrator/src/lib/bridge-script.ts`.

### 2.3 Register MCP server with OpenCode

MCP configuration is written to `opencode.json` in the project directory with `mcp.terminal-server` configured as a stdio MCP server. The config also sets `experimental.mcp_timeout` and per-server `timeout` to 300000ms (5 min) to support the `ask_user` blocking flow.

The MCP terminal server provides tools for terminals, preview URLs, plan format, secrets listing, and `ask_user` (blocks until the user responds, triggers `waiting_for_input` status).

### 2.4 Install Node.js dependencies

The bridge needs `ws` (WebSocket library) and `node-pty` (PTY/terminal emulation):

```bash
npm init -y
npm install ws node-pty
```

### 2.5 Pre-warm OpenCode

```bash
opencode session list
```

Triggers the one-time DB migration that can take 30+ seconds on first run, so it happens during provisioning rather than on the first prompt.

### 2.6 Start the bridge process

The bridge is started as a background session process:

```bash
cd /bridge/dir && ANTHROPIC_API_KEY="sk-proxy-placeholder" node bridge.js
```

The bridge opens a WebSocket server on port 8080 (exposed via the sandbox provider's preview URL mechanism or container networking). The orchestrator connects to this port from the outside.

---

## 3. How OpenCode Is Invoked

When a user sends a prompt in a thread, the bridge spawns OpenCode as a per-prompt PTY child process:

```bash
opencode run --format json --agent build -m anthropic/claude-sonnet-4 "prompt"
```

| Flag | Purpose |
|---|---|
| `--format json` | Outputs structured JSONL events, enabling real-time streaming |
| `--agent <name>` | Selects the agent: `build`, `plan`, or `sisyphus` |
| `-m <model>` | Selects the model (e.g. `anthropic/claude-sonnet-4`, `openai/gpt-5`) |
| `--session <id>` | Resumes a previous session for context continuity (on follow-up prompts) |

The process is spawned via PTY (`node-pty`) because OpenCode (a Go binary) buffers stdout when not connected to a terminal. LLM API keys are set via proxy environment variables (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`) that point to the API server's LLM key proxy — real keys never enter the container.

---

## 4. Data Flow

```
User (Dashboard)
  │
  │  Socket.io: execute_thread / send_prompt / user_answer
  ▼
API Server (AgentGateway)
  │
  │  SandboxManager.sendPrompt() / sendUserAnswer()
  ▼
Bridge (inside sandbox, port 8080 via WSS preview URL)
  │
  │  pty.spawn("opencode", ["run", ...]) per prompt
  ▼
OpenCode Process (per-prompt, session-based context)
  │
  │  stdout → bridge: JSONL events (step_start, tool_use, text, step_finish)
  ▼
Bridge parses JSONL, normalizes events
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
| `claude_message` | Normalized agent event (system/assistant/result) |
| `claude_stdout` | Raw stdout line that couldn't be parsed as JSON |
| `claude_stderr` | Stderr output from agent |
| `claude_exit` | Agent process exited (includes exit code) |
| `claude_error` | Error spawning or managing agent |
| `ask_user_pending` | Agent asked a question via MCP `ask_user` — thread status → `waiting_for_input` |
| `ask_user_resolved` | User answered (or timeout) — thread status → `running` |
| `terminal_output` | PTY terminal output |
| `terminal_created` | New terminal session created |
| `terminal_exit` | Terminal session ended |

Wire type names are kept as `claude_*` for backward compatibility.

### Message types: orchestrator → bridge

| Type | Description |
|---|---|
| `start_claude` | Spawn a new agent process with `agent` field for agent selection |
| `claude_user_answer` | Resolve a pending `ask_user` question with the user's answer |
| `claude_input` | Raw stdin data for a running process |
| `stop_claude` | Kill the agent process for a thread |

---

## 5. Follow-up Prompts & AskUserQuestion

OpenCode uses a per-prompt process model. For follow-up prompts, the bridge kills the old process and spawns a new one with `--session <sessionId>` to resume context.

### AskUserQuestion / ask_user

All agents use the MCP `ask_user` tool (`mcp__terminal-server__ask_user`), which routes through the bridge:

1. Agent calls MCP `ask_user` → MCP server POSTs to bridge `/internal/ask-user`
2. Bridge emits `claude_message` (AskUserQuestion tool_use) + `ask_user_pending` over WebSocket
3. Thread status → `waiting_for_input` (persisted to DB)
4. Dashboard renders `AskQuestionBlock`; CLI TUI shows answer prompt
5. User answers → `user_answer` socket event (or `answerCh` in CLI) → bridge resolves pending HTTP
6. Bridge emits `ask_user_resolved` → status → `running`; MCP returns answer to agent
7. Pending questions time out after 5 minutes

The sandbox `AGENTS.md` instructions explicitly tell agents to use `mcp__terminal-server__ask_user` for questions and not ask in plain text.

---

## 6. Key Files

| File | Role |
|---|---|
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Creates sandboxes, installs bridge, manages WebSocket connections, sends prompts |
| `libs/orchestrator/src/lib/bridge-script.ts` | Generates the `bridge.js` source code (template function) |
| `libs/orchestrator/src/lib/mcp-terminal-script.ts` | Generates the MCP terminal server (ask_user, terminals, preview URLs, secrets) |
| `libs/orchestrator/src/lib/types.ts` | TypeScript types for all bridge protocol messages |
| `apps/api/src/modules/agent/agent.ws.ts` | WebSocket gateway that connects the dashboard to the sandbox manager |
| `apps/api/src/modules/projects/projects.service.ts` | Triggers sandbox provisioning on project creation |
| `apps/cli/internal/sandbox/scripts.go` | Go CLI mirror of bridge + MCP scripts |
| `apps/cli/internal/thread/bridge.go` | Go CLI bridge message processing (handles `ask_user_pending`/`ask_user_resolved`) |
