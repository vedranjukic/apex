# OpenCode Bridge Architecture

The bridge script uses OpenCode in **serve mode** as the single agent runtime. Three named agents — **Build**, **Plan**, and **Sisyphus** (orchestration) — and models from any provider (Anthropic, OpenAI, Google, OpenCode Zen free) are selected per-prompt via the API payload.

## Runtime

| Binary | Process Model | Auth |
|---|---|---|
| `/home/daytona/.opencode/bin/opencode` | `opencode serve` (HTTP API + SSE), sessions via `/session/:id/prompt_async` | Configured via `opencode.json` providers with `{env:VAR}` syntax |

## Architecture

```
[Dashboard] --WebSocket--> [AgentGateway] --SandboxManager.sendPrompt()--> [Bridge WS]
                                                                               |
[Bridge inside sandbox] <--WebSocket--> [Orchestrator]                         |
       |                                                                       |
       +-- opencode serve (HTTP API on 127.0.0.1, started once on boot)        |
       |                                                                       |
       +-- Bridge polls /session/:id/message for parts, emits normalized:      |
       |        system  -> { type: "system", subtype: "init", session_id }     |
       |        assistant -> { type: "assistant", message: { content: [...] }} |
       |        result  -> { type: "result", subtype: "success", usage }       |
       |                                                                       |
       +-- Shared: terminals, file watcher, port scanning, preview URLs        |
       +-- ask_user: /internal/ask-user → ask_user_pending/resolved          |
```

## OpenCode Serve Protocol

- **Startup**: `opencode serve --port <port> --hostname 127.0.0.1` (started once on bridge boot, auto-restarted on exit)
- **Health check**: `GET /global/health` polled until `res.healthy === true`
- **Session creation**: `POST /session` with `{ title: threadId }`
- **Prompt dispatch**: `POST /session/:id/prompt_async` with `{ content, agent, model }`
- **Output polling**: `GET /session/:id/message?limit=20` — bridge polls every 1.5s, deduplicates parts by ID
- **Text buffering**: text and reasoning parts are buffered until stable (unchanged between polls) to avoid capturing partial streaming content
- **Status polling**: `GET /session/status` — detects idle sessions to emit exit
- **Abort**: `POST /session/:id/abort` — used by `stop_agent` and when aborting stale sessions
- Tool name normalization: `bash`→`Bash`, `read`→`Read`, `apply_patch`→`Write`, `glob`→`Glob`, `grep`→`Grep`
- First run triggers a one-time DB migration — pre-warmed during `installBridge` via `opencode session list`

## Agents

| Agent | Value | Description | Provider Restriction |
|---|---|---|---|
| **Build** | `build` | Full autonomous coding agent | All providers |
| **Plan** | `plan` | Read-only analysis and planning | All providers |
| **Sisyphus** | `sisyphus` | Orchestration agent | Anthropic only |

Agents are defined in the `AgentType` enum (`libs/shared/src/lib/enums.ts`) and configured in `opencode.json` which is uploaded to the sandbox during bridge installation.

## Key Files

| File | Role |
|---|---|
| `libs/orchestrator/src/lib/bridge-script.ts` | Bridge JS template with OpenCode adapter, bridge core routing |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Sandbox lifecycle, bridge installation, `sendPrompt()` with `agent` parameter |
| `libs/orchestrator/src/lib/types.ts` | Bridge message types (`claude_message`, `claude_exit`, `claude_error` — kept for backward compat) |
| `libs/shared/src/lib/enums.ts` | `AgentType` enum: `build`, `plan`, `sisyphus` |
| `apps/api/src/modules/agent/agent.ws.ts` | WebSocket gateway, resolves `thread.agentType ?? project.agentType` for all `sendPrompt()` calls |
| `apps/api/src/modules/projects/projects.service.ts` | Provisioning, passes `agentType` to `createSandbox()` and `provisionSandbox()` |
| `apps/dashboard/src/stores/agent-settings-store.ts` | `AGENTS` list, `AGENT_MODELS` (unified model list across all providers), `getModelsForAgent()` helper |
| `apps/dashboard/src/components/agent/mode-model-dropdowns.tsx` | `AgentDropdown` (per-thread agent selector) + `ModelDropdown` (agent-aware model list) in prompt toolbar |
| `apps/cli/internal/sandbox/bridge.go` | Go CLI `sendPrompt()` includes `agent` field |
| `apps/cli/internal/sandbox/scripts.go` | `GenerateBridgeScript()` accepts `agentType` parameter |

## Bridge Core Functions

| Function | Role |
|---|---|
| `startOpenCodeServe()` | Starts `opencode serve`, polls health, connects SSE |
| `handleStartAgent(msg)` | Creates/reuses OpenCode session, sends prompt via `prompt_async`, starts `pollSession` |
| `handleStopAgent(msg)` | Aborts the OpenCode session via `/abort` API |
| `handleUserAnswer(msg)` | Resolves pending ask_user HTTP requests |
| `pollSession(threadId, sessionId)` | Polls messages, buffers text parts until stable, emits tool/result events, detects idle |
| `flushPendingText()` | Emits buffered text/reasoning parts (called on stability, tool completion, or session idle) |

The bridge core (`handleStartAgent`) aborts any running session for the thread before dispatching a new prompt. Follow-up prompts from the gateway use fresh sessions with conversation context prepended.

### Unified ask_user Flow

All agents use the MCP `ask_user` tool which routes through the bridge's `/internal/ask-user` HTTP endpoint. This provides a single code path regardless of agent type:

1. Agent calls MCP `mcp__terminal-server__ask_user` → MCP server POSTs to `/internal/ask-user`
2. Bridge emits `ask_user_pending { threadId, questionId }` + `claude_message` with AskUserQuestion tool_use
3. Bridge blocks the HTTP response (5-min timeout) in the `pendingAskUser` map
4. Client (dashboard or CLI) sets thread status to `waiting_for_input`
5. User answers → `claude_user_answer { threadId, toolUseId, answer }` → bridge resolves `pendingAskUser`
6. Bridge emits `ask_user_resolved { threadId, questionId }` → status back to `running`
7. HTTP response returns answer to MCP server → MCP returns to agent → agent continues

The sandbox instructions (`AGENTS.md` in the project dir) explicitly tell agents to use `mcp__terminal-server__ask_user` for questions.

## Sandbox Setup (`installBridge`)

| Step | Details |
|---|---|
| Auth | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars on bridge process (proxied through LLM key proxy) |
| Pre-warm | `opencode session list` (triggers one-time DB migration) |
| Instructions | `AGENTS.md` in project dir |
| MCP Config | `opencode.json` with `mcp.terminal-server` + 300s MCP timeout |

The bridge process env includes `HOME=/home/daytona` and `PATH` with `/home/daytona/.opencode/bin`.

## Testing

### Unit Tests

```bash
npm run test:bridge-adapters   # or: cd libs/orchestrator && npx vitest run
```

Tests adapter code generation, tool name normalization, protocol structure, and routing.

### Gateway Tests

```bash
npm run test:agent-retry
```

Tests timeout auto-retry, crash recovery, and waiting_for_input status transitions with mock SandboxManager.

### E2E Tests (real sandboxes, real agents)

```bash
# Requires running API server:
npm run serve

# In another terminal:
npm run test:multi-agent-e2e
```

Creates a real sandbox, sends a prompt, and validates the normalized event stream. Requires:
- `DAYTONA_API_KEY` — sandbox provisioning
- `ANTHROPIC_API_KEY` — for Anthropic models

## Per-Thread Agent Selection

Agent type can be set at two levels:

1. **Project level** (`project.agentType`) — default for all threads in the project (defaults to `build`).
2. **Thread level** (`task.agentType`) — optional per-thread override, set from the `AgentDropdown` in the prompt toolbar.

The gateway resolves the effective agent type as `thread.agentType ?? project.agentType`. This allows different threads within the same project to use different agents (e.g., one thread with Build, another with Plan). The `send_prompt` and `execute_thread` WebSocket payloads accept an optional `agentType` field which is persisted on the thread entity.

The `AgentDropdown` in the prompt input toolbar lets users switch agents per-thread. When an agent is selected, the `ModelDropdown` dynamically updates to show only models available for that agent (Sisyphus is restricted to Anthropic models). When switching to an existing thread that has a stored `agentType`, the dropdowns restore to match.

## Backward Compatibility

- Wire message types unchanged: `start_claude`, `claude_message`, `claude_exit`, `claude_error` (bridge uses these regardless of agent type for backward compat)
- The `start_claude` message carries an `agent` field with the agent name (`build`, `plan`, `sisyphus`)
- Gateway `messageHandler` unchanged — bridge normalizes all output into the format the gateway already expects
- Dashboard rendering unchanged — all agents produce `text`, `tool_use`, `tool_result` content blocks with normalized tool names
- Threads with `agentType: null` continue to use the project-level default

## Troubleshooting

**OpenCode produces no output / times out**: Ensure OpenCode is spawned via `pty.spawn`, not `child_process.spawn`. The Go binary buffers stdout when not connected to a terminal.

**OpenCode first-run slow**: The one-time DB migration can take 30+ seconds. The `installBridge` pre-warm (`opencode session list`) triggers it during provisioning, before the first prompt.

**OpenCode ask_user times out immediately**: OpenCode's default MCP tool timeout is 5 seconds. The `ask_user` tool needs to block until the user responds (up to 5 minutes). The `opencode.json` config must set both `experimental.mcp_timeout` and per-server `timeout` to 300000ms (5 min) to match the bridge's ask_user timeout.
