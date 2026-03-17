# Multi-Agent Bridge Abstraction

The bridge script supports three agent backends through an adapter pattern. Each adapter normalizes its agent's native streaming protocol into the same event format (`system`/`assistant`/`result` with content blocks), so the gateway and dashboard remain agent-agnostic.

## Supported Agents

| Agent | Binary | Process Model | Auth |
|---|---|---|---|
| **Claude Code** (`claude_code`) | `claude` | Long-lived PTY, bidirectional JSONL stdin/stdout | `ANTHROPIC_API_KEY` env var |
| **OpenCode** (`open_code`) | `/home/daytona/.opencode/bin/opencode` | Per-prompt PTY, `--session` for context | Free built-in models; or `opencode auth login` |
| **Codex** (`codex`) | `codex app-server --listen stdio://` | Long-lived child process, JSON-RPC 2.0 | `codex login --with-api-key` (writes `~/.codex/auth.json`) |

## Architecture

```
[Dashboard] --Socket.io--> [AgentGateway] --SandboxManager.sendPrompt()--> [Bridge WS]
                                                                               |
[Bridge inside sandbox] <--WebSocket--> [Orchestrator]                         |
       |                                                                       |
       +-- AdapterFactory selects adapter based on AGENT_TYPE                  |
       |        |                                                              |
       |        +-- claudeAdapter:   pty.spawn("claude", [...])                |
       |        +-- openCodeAdapter: pty.spawn("opencode", ["run", ...])       |
       |        +-- codexAdapter:    spawn("codex", ["app-server", ...])       |
       |                                                                       |
       +-- All adapters emit normalized events via emitAgentMessage()          |
       |        system  -> { type: "system", subtype: "init", session_id }     |
       |        assistant -> { type: "assistant", message: { content: [...] }} |
       |        result  -> { type: "result", subtype: "success", usage }       |
       |                                                                       |
       +-- Shared: terminals, file watcher, port scanning, preview URLs        |
       +-- ask_user: /internal/ask-user → ask_user_pending/resolved          |
```

## Agent Protocols (Empirically Verified)

### Claude Code

- **Command**: `claude -p --output-format stream-json --input-format stream-json --verbose --dangerously-skip-permissions "prompt"`
- `--verbose` is **required** with `--output-format stream-json` in `-p` mode
- Follow-ups: pipe `{"type":"user","message":{"role":"user","content":"..."}}` to stdin
- User answers: pipe `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}` to stdin
- Session resume: `--resume <session_id>` when process has died
- Spawned via PTY (`pty.spawn`) for line-buffered ANSI-stripped output

### OpenCode

- **Command**: `opencode run --format json -m <model> "prompt"`
- Free built-in models: `opencode/gpt-5-nano`, `opencode/big-pickle`, `opencode/minimax-m2.5-free`
- Output events (JSONL): `step_start`, `tool_use`, `text`, `step_finish`
- Follow-ups: kill old process, spawn new with `--session <sessionID>`
- **Must use PTY** (`pty.spawn`), not `child_process.spawn` — OpenCode (Go binary) buffers stdout when not connected to a terminal, causing zero output and gateway timeouts
- Tool name normalization: `bash`→`Bash`, `read`→`Read`, `apply_patch`→`Write`, `glob`→`Glob`, `grep`→`Grep`
- First run triggers a one-time DB migration — pre-warmed during `installBridge` via `opencode session list`

### Codex (app-server mode)

- **Command**: `codex app-server --listen stdio://`
- Auth: `echo "$KEY" | codex login --with-api-key` (writes `~/.codex/auth.json`). Neither `CODEX_API_KEY` nor `OPENAI_API_KEY` env vars work for app-server.
- JSON-RPC 2.0 lifecycle:
  1. Send `initialize` → receive response → send `initialized`
  2. Send `thread/start` → receive `thread/started` notification (capture `threadId`)
  3. Send `turn/start` with prompt → stream `item/*` notifications → `turn/completed`
- Follow-up turns: new `turn/start` on same `threadId` (same process, context preserved)
- Item types: `commandExecution` (normalized to `Bash`), `agentMessage` (text), `fileChange` (normalized to `Write`)
- Token-by-token text streaming via `item/agentMessage/delta` events
- Uses `child_process.spawn` (not PTY) since JSON-RPC doesn't need terminal emulation

## Key Files

| File | Role |
|---|---|
| `libs/orchestrator/src/lib/bridge-script.ts` | Bridge JS template with all three adapters, adapter registry, and bridge core routing |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Sandbox lifecycle, per-agent auth setup, bridge installation, `sendPrompt()` with `agentType` |
| `libs/orchestrator/src/lib/types.ts` | Bridge message types (`claude_message`, `claude_exit`, `claude_error` — kept for backward compat) |
| `libs/shared/src/lib/enums.ts` | `AgentType` enum: `claude_code`, `open_code`, `codex` |
| `apps/api/src/modules/agent/agent.gateway.ts` | Socket.io gateway, resolves `thread.agentType ?? project.agentType` for all `sendPrompt()` calls |
| `apps/api/src/modules/projects/projects.service.ts` | Provisioning, passes `agentType` to `createSandbox()` and `provisionSandbox()` |
| `apps/api/src/modules/settings/settings.service.ts` | `OPENAI_API_KEY` added to allowed settings keys |
| `apps/dashboard/src/stores/agent-settings-store.ts` | Per-agent model lists (`AGENT_MODELS_BY_TYPE`), `AGENT_TYPES`, `agentType` state, `getModelsForAgentType()` helper |
| `apps/dashboard/src/components/agent/mode-model-dropdowns.tsx` | `AgentDropdown` (per-thread agent selector) + `ModelDropdown` (agent-aware model list) in prompt toolbar |
| `apps/dashboard/src/components/projects/create-project-dialog.tsx` | Agent type selector (Claude Code / OpenCode / Codex) for project-level default |
| `apps/dashboard/src/pages/settings-page.tsx` | OpenAI API Key field for Codex |
| `apps/cli/internal/sandbox/bridge.go` | Go CLI `sendPrompt()` includes `agentType` field |
| `apps/cli/internal/sandbox/scripts.go` | `GenerateBridgeScript()` accepts `agentType` parameter |

## Bridge Adapter Interface

Each adapter implements:

| Method | Claude | OpenCode | Codex |
|---|---|---|---|
| `spawn(threadId, prompt, mode, model, sessionId)` | `pty.spawn("claude", [...])` | `pty.spawn("opencode", ["run", ...])` | `spawn("codex", ["app-server", ...])` + JSON-RPC handshake |
| `isAlive(entry)` | `proc.pid > 0` | `proc.pid > 0` | `!proc.killed && exitCode === null` |
| `sendFollowUp(entry, prompt)` | Pipe JSONL user message to stdin | `null` (respawn with `--session`) | `turn/start` JSON-RPC on same thread |
| `sendUserAnswer(entry, toolUseId, answer)` | Pipe JSONL tool_result to stdin (fallback) | Not supported (fallback) | `turn/steer` JSON-RPC (fallback) |
| `kill(entry)` | `proc.kill()` | `proc.kill()` | `proc.stdin.end()` + `proc.kill()` |
| `processModel` | `"long-lived"` | `"per-prompt"` | `"long-lived"` |

The bridge core (`handleStartAgent`) checks `adapter.processModel`:
- `"long-lived"`: calls `adapter.sendFollowUp()` for existing processes
- `"per-prompt"`: kills old process and spawns new one (OpenCode uses `--session` for context)

### Unified ask_user Flow

Claude's native `AskUserQuestion` tool is **disallowed** for all agents via `--disallowedTools`. Instead, all agents use the MCP `ask_user` tool which routes through the bridge's `/internal/ask-user` HTTP endpoint. This provides a single code path regardless of agent type:

1. Agent calls MCP `mcp__terminal-server__ask_user` → MCP server POSTs to `/internal/ask-user`
2. Bridge emits `ask_user_pending { threadId, questionId }` + `claude_message` with AskUserQuestion tool_use
3. Bridge blocks the HTTP response (5-min timeout) in the `pendingAskUser` map
4. Client (dashboard or CLI) sets thread status to `waiting_for_input`
5. User answers → `claude_user_answer { threadId, toolUseId, answer }` → bridge resolves `pendingAskUser`
6. Bridge emits `ask_user_resolved { threadId, questionId }` → status back to `running`
7. HTTP response returns answer to MCP server → MCP returns to agent → agent continues

The adapter-specific `sendUserAnswer` methods serve as fallbacks but are not used in the normal flow. The sandbox instructions (CLAUDE.md / AGENTS.md) explicitly tell agents to use `mcp__terminal-server__ask_user` for questions.

## Per-Agent Sandbox Setup (`installBridge`)

| Agent | Auth Setup | Instructions File | MCP Config |
|---|---|---|---|
| Claude Code | `ANTHROPIC_API_KEY` env var on bridge process | `~/.claude/CLAUDE.md` | `~/.claude.json` with terminal-server |
| OpenCode | Pre-warm: `opencode session list` (triggers DB migration) | `AGENTS.md` in project dir | `opencode.json` with terminal-server + 300s MCP timeout |
| Codex | `echo "$KEY" \| codex login --with-api-key` | `AGENTS.md` in project dir | `codex mcp add terminal-server` |

The bridge process env includes `HOME=/home/daytona` and `PATH` with `/home/daytona/.opencode/bin` for all agent types.

## Testing

### Unit Tests (55 tests)

```bash
npm run test:bridge-adapters   # or: cd libs/orchestrator && npx vitest run
```

Tests adapter code generation, tool name normalization, protocol structure, and routing for all three agents.

### Gateway Tests (6 tests)

```bash
npm run test:agent-retry
```

Tests timeout auto-retry, crash recovery, and waiting_for_input status transitions with mock SandboxManager.

### E2E Tests (7 tests — real sandboxes, real agents)

```bash
# Requires running API server:
npm run serve

# In another terminal:
npm run test:multi-agent-e2e
```

Creates a real Daytona sandbox for each agent type, sends a prompt, and validates the normalized event stream. Requires:
- `DAYTONA_API_KEY` — sandbox provisioning
- `ANTHROPIC_API_KEY` — Claude Code (skips if missing)
- `OPENAI_API_KEY` — Codex (skips if missing)
- OpenCode uses free models (always runs)

### Ask-User E2E Tests (real sandbox)

```bash
npm run serve
npm run test:ask-user-e2e
```

Tests the waiting_for_input status lifecycle with a real Claude Code sandbox:
- Sends a prompt that triggers the MCP `ask_user` tool
- Verifies `agent_status` transitions to `waiting_for_input`
- Verifies the `AskUserQuestion` tool_use block appears in the event stream
- Sends a `user_answer` and verifies status transitions back to `running`
- Verifies the agent completes after receiving the answer

Requires:
- `DAYTONA_API_KEY` — sandbox provisioning
- `ANTHROPIC_API_KEY` — Claude Code

### Verified Results

| Test | Agent | Time | Status |
|---|---|---|---|
| Provision | Claude Code | 12s | Pass |
| Prompt + response | Claude Code | 2.7s | Pass |
| Provision | OpenCode | 15s | Pass |
| Prompt + response | OpenCode | 4.9s | Pass |
| Provision | Codex | 12s | Pass |
| Prompt + response | Codex | 2.1s | Pass |
| Normalization contract | All | <1ms | Pass |

## Per-Thread Agent Selection

Agent type can be set at two levels:

1. **Project level** (`project.agentType`) — default for all threads in the project, set at project creation.
2. **Thread level** (`task.agentType`) — optional per-thread override, set from the `AgentDropdown` in the prompt toolbar.

The gateway resolves the effective agent type as `thread.agentType ?? project.agentType`. This allows different threads within the same project to use different agents (e.g., one thread with Claude Code, another with Codex). The `send_prompt` and `execute_thread` WebSocket payloads accept an optional `agentType` field which is persisted on the thread entity.

The `AgentDropdown` in the prompt input toolbar lets users switch agents per-thread. When an agent is selected, the `ModelDropdown` dynamically updates to show only models available for that agent (`AGENT_MODELS_BY_TYPE`). When switching to an existing thread that has a stored `agentType`, the dropdowns restore to match.

## Backward Compatibility

- Wire message types unchanged: `start_claude`, `claude_message`, `claude_exit`, `claude_error` (bridge uses these regardless of agent type)
- The `start_claude` message now carries an optional `agentType` field; bridge falls back to its `AGENT_TYPE` constant
- Gateway `messageHandler` unchanged — bridge normalizes all output into the format the gateway already expects
- Dashboard rendering unchanged — all agents produce `text`, `tool_use`, `tool_result` content blocks with normalized tool names
- Threads with `agentType: null` continue to use the project-level default

## Troubleshooting

**OpenCode produces no output / times out**: Ensure OpenCode is spawned via `pty.spawn`, not `child_process.spawn`. The Go binary buffers stdout when not connected to a terminal.

**Codex app-server auth fails (401)**: `CODEX_API_KEY` and `OPENAI_API_KEY` env vars don't work for app-server. Must run `codex login --with-api-key` to write `~/.codex/auth.json`.

**OpenCode first-run slow**: The one-time DB migration can take 30+ seconds. The `installBridge` pre-warm (`opencode session list`) triggers it during provisioning, before the first prompt.

**OpenCode ask_user times out immediately**: OpenCode's default MCP tool timeout is 5 seconds. The `ask_user` tool needs to block until the user responds (up to 5 minutes). The `opencode.json` config must set both `experimental.mcp_timeout` and per-server `timeout` to 300000ms (5 min) to match the bridge's ask_user timeout.

**Codex `danger-full-access` mode**: Uses `commandExecution` (bash) for everything including file reads/writes. Structured `fileChange` items only appear in `workspace-write` sandbox mode. The bridge's file watcher catches all filesystem changes regardless.
