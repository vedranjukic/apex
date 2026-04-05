# Apex – Architecture Overview

## Stack
- **API**: NestJS + TypeORM + SQLite (`apps/api`) on port 6000
- **Dashboard**: React + Zustand + Tailwind (`apps/dashboard`) on port 4200 (Vite)
- **Orchestrator lib**: `libs/orchestrator` – provider-agnostic sandbox management (Daytona cloud, Docker local, Apple Container macOS VM, or local host) + WebSocket bridge to agent CLI
- **Sandbox bridge**: Node.js script uploaded into each sandbox. Uses OpenCode as the single agent runtime with three named agents:
  - **Build**: full autonomous coding agent
  - **Plan**: read-only analysis and planning
  - **Sisyphus**: orchestration agent (Anthropic models only)
  All agents are invoked via `opencode run --agent <name> --format json` as per-prompt PTY processes with `--session` for context continuity. Output is normalized into a unified event format (`system`/`assistant`/`result` with content blocks). Terminal PTY sessions are shared across all agent types.

## Data Model
- **Project** → has a sandbox (provisioned async on creation). Each project stores a `provider` field (`daytona`, `docker`, `apple-container`, or `local`) that selects the sandbox backend. Optional `gitRepo` URL for cloning a repository (supports GitHub issue/PR/branch/commit URLs — normalized to clone URL server-side). Optional `githubContext` JSON stores fetched issue/PR content (title, body, labels, branch) for `@issue`/`@pr` prompt references. Stores `agentType` as the project-level default agent (`build`, `plan`, `sisyphus`; defaults to `build`).
- **Thread** (DB table: `tasks`) → belongs to a project, has messages. Title auto-generated from first prompt. Stores `claudeSessionId` for session context continuity across follow-up prompts. Optional `agentType` overrides the project default, allowing different threads within one project to use different agents (e.g., one with Build, another with Plan).
- **Message** → belongs to a thread. Roles: `user`, `assistant`, `system`. Content is JSON array of blocks (text, tool_use, tool_result, image). Image blocks carry a `source` field with base64-encoded data.

## Key Flows

### Project Creation
1. `POST /api/projects` → creates project with `status: creating`. Accepts optional `gitRepo` URL (plain repo, GitHub issue/PR/branch/commit URL), `gitBranch`, `githubContext`, and `provider` (default `daytona`). The backend normalizes GitHub URLs via `parseGitHubUrl()` — extracting the clone URL, branch ref, and auto-fetching issue/PR content from the GitHub API when the frontend doesn't provide it.
2. `ProjectsService.provisionSandbox()` runs async → routes to the correct `SandboxManager` based on the project's `provider` field, creates sandbox, installs bridge + MCP terminal server, connects via preview URL → sets `status: running` + stores `sandboxId`
3. During sandbox provisioning: if `gitRepo` is set, creates the project directory, then clones the repo (`git clone --branch <ref> <url> .` for branches; `git clone` + `git checkout <sha>` for commits; plain `git clone` for repos/issues); otherwise runs `git init` so every project starts version-controlled. If a GitHub token is configured, `git config --global user.name` and `user.email` are set from the GitHub profile (or manual overrides in `GIT_USER_NAME`/`GIT_USER_EMAIL` settings)
4. Dashboard polls project status while `creating`, shows sandbox status indicator (green/yellow/red) in top bar

### Thread + Agent Execution (Session-per-Thread)
Each thread uses OpenCode serve mode. The bridge starts `opencode serve` once on boot and communicates via its HTTP API and SSE event stream.

1. User clicks "New Thread" → composing mode (prompt input, no dialog)
2. User types prompt → `POST /api/projects/:id/threads` creates thread + stores first user message
3. Dashboard emits `execute_thread { threadId }` via Socket.io → gateway reads first message, sends to sandbox
4. `SandboxManager.sendPrompt(sandboxId, prompt, threadId, sessionId)` → auto-reconnects if server restarted
5. Bridge sends prompt to OpenCode serve via `POST /session/:id/prompt_async`, polls `/session/:id/message` for output
6. OpenCode's `system` init message contains `session_id` → gateway captures it → stored on the thread entity as `claudeSessionId`
7. Agent output streams: bridge → WS (tagged with `threadId`) → SandboxManager → gateway filters by `threadId` → forwards via Socket.io `agent_message` → dashboard renders in real-time
8. Multiple threads can have concurrent agent processes in the same sandbox (bridge tracks active threads per threadId)

### Follow-up Prompts
1. User sends another message → dashboard emits `send_prompt { threadId, prompt, images? }`
2. Gateway builds conversation context from prior messages via `buildConversationContext()` (last 20KB of conversation history), prepends it as `<conversation_history>` tags, and creates a fresh OpenCode session for the follow-up to avoid stale session races
3. Gateway stores user message in DB (with image content blocks if present), sends `start_claude` to bridge with optional `images` array → bridge converts images to OpenCode `FilePartInput` format (`{ type: "file", mime, url: "data:..." }`) and includes them in the prompt alongside the text

### Stop Agent
Users can abort a running agent at any time:

1. Dashboard sends `stop_agent { threadId }` via WebSocket
2. Gateway cleans up the active message handler, timeout, and health check for that thread
3. Gateway calls `manager.stopClaude()` → bridge sends abort to the OpenCode session
4. Thread status is set to `completed` and broadcast to all subscribers

### Prompt Queue
The prompt input stays editable while the agent is running. If the user submits a prompt while the agent is working:

1. The prompt is added to a local queue displayed above the input with Play (send) and Delete buttons
2. When the agent finishes (status transitions from `running`), the first queued prompt auto-sends
3. Clicking Play on a queued prompt stops the current agent, then sends the queued prompt when the stop completes

### Bridge Health Check
A 10-second health check interval runs alongside every active agent execution:

1. Every 10s, the gateway checks `manager.isBridgeConnected()` to verify the bridge WebSocket is alive
2. If disconnected, immediately attempts reconnect + retry (instead of waiting for the 90-300s timeout)
3. Emits "Lost connection to sandbox. Reconnecting…" system message to the client
4. If recovery fails, marks the thread as `error` immediately

### Thread Status Lifecycle

Thread statuses and their transitions:

| Status | Meaning | Set by |
|--------|---------|--------|
| `running` | Agent is actively working | `executeAgainstSandbox`, `ask_user_resolved` |
| `waiting_for_input` | Agent asked user a question via `ask_user` MCP tool | `ask_user_pending` bridge event |
| `waiting_for_user_action` | Agent finished but needs user to act (plan review or pending todos) | `save_plan` handler, or frontend pending-todos detection |
| `completed` | Agent finished successfully | `result`/`exit` bridge events |
| `error` | Agent crashed or timed out | `claude_error`, timeout, failed retry |

**Status protection**: The `result` and `exit` handlers skip overwriting to `completed` if the thread is already in `waiting_for_input` or `waiting_for_user_action`, preventing race conditions where a plan save or ask_user arrives just before the process exits.

**Pending todos detection**: When the agent completes, the frontend checks the last 3 assistant messages for `TodoWrite` tool calls with `pending`/`in_progress` items. If found, overrides the status to `waiting_for_user_action` and notifies the server via `update_thread_status`. The 3-message window prevents stale todos from deep in the history from triggering false positives.

**Status sync across stores**: Thread status lives in two frontend stores — the projects store (embedded in project objects, used by the project list) and the threads store (used by thread detail views). When `agent_status` events arrive, `use-agent-socket.ts` updates both stores to keep them in sync.

### Stale Thread Reconciliation
On server startup and client subscription, threads stuck in active states are cleaned up:

1. **Server startup** (`init()`): resets all `running`/`waiting_for_input`/`idle` threads to `completed`, clears stale `claudeSessionId`. Does NOT touch `waiting_for_user_action` threads (plans/pending todos survive restarts).
2. **Client subscribe** (`subscribe_project`): synchronously reconciles stale threads (checks `activeHandlers` map) before sending `subscribed` response, ensuring `fetchThreads` reads clean data

### AskUserQuestion (waiting_for_input)
All agents use the MCP `ask_user` tool (`mcp__terminal-server__ask_user`) which routes through the bridge's `/internal/ask-user` endpoint:

1. Agent calls `mcp__terminal-server__ask_user` → MCP server POSTs to bridge `/internal/ask-user`
2. Bridge emits `claude_message` (with `AskUserQuestion` tool_use block) + `ask_user_pending` over WebSocket
3. Gateway/CLI sets thread status to `waiting_for_input` and emits `agent_status { status: 'waiting_for_input' }`
4. Dashboard renders `AskQuestionBlock` with multiple-choice UI; CLI TUI shows `?` indicator and answer prompt
5. User answers → `user_answer { threadId, toolUseId, answer }` via Socket.io (or `answerCh` in CLI TUI)
6. Bridge resolves the pending HTTP request, emits `ask_user_resolved`, status returns to `running`
7. MCP server returns the answer to the agent, which continues execution

The `waiting_for_input` status is persisted in the DB and survives page reloads. The bridge times out pending questions after 5 minutes.

### Terminals
Each project supports multiple persistent terminal sessions (like tmux). Terminals survive dashboard reloads via scrollback replay.

#### User-created terminals
1. User clicks "+" in terminal panel → dashboard emits `terminal_create { projectId, terminalId, cols, rows, name }`
2. Gateway resolves project → if sandbox available, sends to bridge via `SandboxManager.createTerminal()` (with 3s timeout fallback); if no sandbox, spawns **local PTY** via `node-pty` directly on the API server
3. Bridge spawns PTY (`node-pty`), stores in terminal map with scrollback buffer (~5000 chunks)
4. PTY output streams: bridge → WS `terminal_output` → SandboxManager → gateway → Socket.io `terminal_output` → dashboard writes to xterm.js
5. User keystrokes flow: dashboard `onData` → Socket.io `terminal_input` → gateway → bridge → `pty.write(data)`
6. Resize: dashboard `ResizeObserver` + `FitAddon` → Socket.io `terminal_resize` → bridge → `pty.resize(cols, rows)`

#### Reconnection on page reload
1. Dashboard connects → `useTerminalSocket` emits `terminal_list { projectId }`
2. Gateway → SandboxManager → bridge responds with list of alive terminals + scrollback per terminal
3. Dashboard creates xterm instances, writes scrollback buffers, attaches input/output listeners
4. User sees all terminals exactly as they left them

#### Claude-driven terminals (MCP)
An MCP server (`mcp-terminal-server.js`) runs inside the sandbox alongside the bridge. It provides these tools:

| MCP Tool | Description |
|---|---|
| `open_terminal` | Create a named terminal, optionally run a command (e.g. `npm run dev`) |
| `read_terminal` | Read recent scrollback output from a terminal |
| `list_terminals` | List all open terminal sessions |
| `write_to_terminal` | Send input to a terminal (e.g. answer a prompt) |
| `close_terminal` | Close a terminal |
| `get_preview_url` | Get public preview URL for a port running in the sandbox |
| `get_plan_format_instructions` | Get the exact plan format delimiters for Plan mode |
| `ask_user` | Ask the user a question and block until they respond (triggers `waiting_for_input` status) |

The MCP server communicates with the bridge via local HTTP endpoints (`/internal/terminal-create`, `/internal/terminal-read`, `/internal/ask-user`, etc.). Agents discover the tools via the `opencode.json` MCP configuration in the project directory.

Example: user asks *"start the dev server so I can watch it"* → agent calls `open_terminal({ name: "Dev Server", command: "npm run dev" })` → a new tab appears in the dashboard terminal panel with live output.

## Socket.io Setup
- Server: NestJS `@WebSocketGateway` at namespace `/ws/agent`, path `/ws/socket.io`
- Client: `socket.io-client` connects with same path
- Vite proxy: `/ws` → `http://localhost:6000` with `ws: true`
- Thread events: `subscribe_project`, `execute_thread`, `send_prompt`, `user_answer`, `update_thread_status`, `save_plan` (client→server); `agent_message`, `agent_status`, `agent_error` (server→client). `send_prompt` and `execute_thread` accept optional `agentType` to override the project default per-thread. `send_prompt` also accepts an optional `images` array (base64-encoded `{ type, media_type, data }` objects) for multimodal prompts. `agent_status` values: `running`, `waiting_for_input`, `waiting_for_user_action`, `retrying`, `completed`, `error`. `update_thread_status` allows the frontend to set a thread's status (e.g. `waiting_for_user_action` when pending todos are detected). `agent_message` carries `system`/`init` (MCP servers, tools, model), `assistant` (content blocks + usage), and `result` (cost, tokens, duration, turns) subtypes.
- Terminal events: `terminal_create`, `terminal_input`, `terminal_resize`, `terminal_close`, `terminal_list` (client→server); `terminal_created`, `terminal_output`, `terminal_exit`, `terminal_error`, `terminal_list` (server→client)
- File events: `file_list`, `file_create`, `file_rename`, `file_delete`, `file_move`, `file_read`, `file_write` (client→server); `file_list_result`, `file_op_result`, `file_changed`, `file_read_result`, `file_write_result` (server→client)
- Project info events: `project_info` (client→server + server→client) – returns `{ gitBranch, projectDir }` for the status bar and file tree root
- Git branch events: `git_branches`, `git_create_branch`, `git_checkout` (client→server); `git_branches_result` (server→client) – branch list and switching
- LSP events: `lsp_data` (client→server, raw JSON-RPC to LSP server); `lsp_response` (server→client, JSON-RPC from LSP server); `lsp_status` (server→client, per-language server status). All carry a `language` field for routing.
- Payload uses `threadId` (maps to internal `taskId` in DB)

## Message Rendering
- Consecutive assistant messages are **grouped** into a single agent block (no repeated headers)
- "Thought for Xs" label shows time between user prompt and first agent response
- `result` messages stored with empty content (metadata only: cost, duration, turns, tokens) to avoid duplicating the last assistant text. Rendered inline as simple text: `$0.0234 · 12.3k tokens · 4.2s`
- **Thread Stats Bar**: toggled via a "Stats" button in the thread header. Shows aggregated stats across all runs: total cost, input/output token breakdown, context window usage % (color-coded bar), duration, turns, connected MCP servers. Data sources: result message metadata (cost, tokens, duration) + `threadSessionInfo` from `system`/`init` messages (MCP servers, model)
- Tool use/result blocks rendered inline within the agent group
- Text blocks with markdown headings (≥200 chars) auto-render in collapsible `MarkdownBlock` cards

### Plan Mode Rendering
When the user sends a prompt in **Plan** mode, the response renders in a special `PlanBlock` inline card:
1. `use-agent-socket.ts` marks the thread as a plan thread and accumulates text blocks into `usePlanStore`
2. Plan content is extracted from the first `#` heading onward (conversational preamble stays as regular text)
3. Plan card shows: filename (slug + timestamp `.md`), READY badge on completion, rendered markdown body, and a **Build** button
4. Clicking **Build** sends the plan as a prompt in `agent` mode via `sendSilentPrompt` (adds a hidden user message for group separation, hidden by `UserBubble` via `BUILD_PROMPT_PREFIX` detection)
5. Build execution renders normally (tool cards, text, `MarkdownBlock` for summaries) — separate from the plan card
6. After Build, the button grays out and shows "Built" (detected by checking for `BUILD_PROMPT_PREFIX` in user messages)
7. After page refresh, plans reconstruct from message content: `AgentGroup` scans text blocks for headings, and the build-prompt message proves plan-mode history

## LLM API Key Proxy

API keys for LLM providers (Anthropic, OpenAI) are **never sent into sandbox containers**. Instead, all LLM API calls are routed through a proxy that injects real keys server-side. The proxy implementation varies by provider:

- **Local providers** (Docker, Apple Container, local): The Elysia API on the host acts as the proxy.
- **Daytona** (cloud): A dedicated **proxy sandbox** on Daytona runs the proxy service, since the host API is typically unreachable from cloud sandboxes.

### How It Works (Local Providers)

```
Container (OpenCode) → http://<host-ip>:6000/llm-proxy/anthropic/v1/messages
                                    ↓
                        Elysia LLM Proxy (llm-proxy.routes.ts)
                                    ↓
                        Reads real key from SettingsService
                                    ↓
                        https://api.anthropic.com/v1/messages (with real x-api-key header)
```

### How It Works (Daytona — Proxy Sandbox)

```
Regular Sandbox (OpenCode) → https://<proxy-sandbox-preview-url>/llm-proxy/anthropic/v1/messages
                                         (x-api-key: <auth-token>)
                                    ↓
                        Proxy Sandbox (apex-proxy binary on port 3000)
                                    ↓
                        Verifies auth token, reads real key from env
                                    ↓
                        https://api.anthropic.com/v1/messages (with real x-api-key header)
```

A **proxy sandbox** is a lightweight Daytona sandbox that runs the **`apex-proxy` Rust binary** — a single statically-linked binary providing LLM proxy, MITM secrets proxy, and WebSocket tunnel functionality. One proxy sandbox is shared across all regular Daytona sandboxes in the same application instance. It is created automatically at startup and lazily re-created if it becomes unhealthy. The binary is cross-compiled for `x86_64-unknown-linux-musl` and uploaded to the sandbox at creation time.

**Services in Proxy Sandbox (single `apex-proxy` binary):**
- **LLM Proxy** (port 3000) — API key proxying functionality + `/health` endpoint
- **MITM Secrets Proxy** (port 9340, internal) — TLS termination with secrets injection, ECDSA P256 domain certs signed by RSA CA
- **WebSocket Tunnel Bridge** (`/tunnel` endpoint) — enables TCP-over-WebSocket tunneling for HTTPS proxy connections from regular sandboxes
- **Port Relay Bridge** (`/port-relay/:port` endpoint) — arbitrary TCP port forwarding via WebSocket

**Security:** The proxy sandbox's Daytona preview URL contains the sandbox UUID (hard to guess). Each application instance generates a unique auth token (e.g. `sk-proxy-<random-hex>`) that regular sandboxes send as their "API key". The proxy verifies this token before forwarding requests. Real API keys never leave the proxy sandbox.

**Lifecycle:** The proxy sandbox is created on first Daytona sandbox operation and persists across app restarts (sandbox ID stored in the settings DB). It is recreated when API keys change (detected via SHA-256 hash comparison) or when the sandbox is found to be stopped/destroyed.

### Container Environment

Containers receive:
- `ANTHROPIC_API_KEY=<auth-token>` / `OPENAI_API_KEY=<auth-token>` — the auth token that doubles as an SDK-compatible "API key" (for local providers, `sk-proxy-placeholder` is used instead)
- `ANTHROPIC_BASE_URL=<proxy-url>/llm-proxy/anthropic/v1` — redirects all Anthropic API calls through the proxy
- `OPENAI_BASE_URL=<proxy-url>/llm-proxy/openai/v1` — redirects all OpenAI API calls through the proxy

The OpenCode config (`opencode.json`) uses `{env:ANTHROPIC_BASE_URL}` / `{env:OPENAI_BASE_URL}` in `provider.*.options.baseURL` to pick up these URLs.

### Provider-Aware Routing

The proxy URL resolution in `sandbox-manager.ts` adapts to the sandbox provider:

- **Local provider**: `localhost` URLs work as-is (process runs on host).
- **Container providers** (Docker, Apple Container): `localhost` in the proxy URL is replaced with the host machine's LAN IP (via `os.networkInterfaces()`), since containers can't reach the host via `localhost`. The API server must listen on `0.0.0.0`.
- **Daytona** (cloud): Uses the proxy sandbox's preview URL. If no proxy sandbox is available and `API_BASE_URL` is set to a publicly reachable URL, falls back to the host API. Real API keys are **never** sent into Daytona cloud sandboxes.

### Key Files

| File | Role |
|---|---|
| `apps/api/src/modules/llm-proxy/llm-proxy.routes.ts` | Elysia streaming reverse proxy for local providers — matches `/llm-proxy/(anthropic\|openai)/*`, injects real API keys from `settingsService` |
| `apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts` | Manages the Daytona proxy sandbox lifecycle — create, health check, destroy, settings persistence |
| `apps/proxy/` | Rust `apex-proxy` binary — MITM proxy, LLM proxy, WebSocket tunnel, port relay (cross-compiled for Linux musl, uploaded to Daytona proxy sandbox) |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | `resolveProxyBaseUrl()` — adapts proxy URL per provider; `updateProxyConfig()` — hot-updates proxy URL; `restartBridge()` / `installBridge()` — writes `.env` with proxy URLs + auth tokens |
| `apps/api/src/modules/projects/projects.service.ts` | `ensureDaytonaProxy()` — lazy health check before Daytona operations; integrates proxy sandbox into `initSandboxManagers()` |
| `apps/api/src/modules/settings/settings.service.ts` | Stores API keys and proxy sandbox metadata (`LLM_PROXY_SANDBOX_ID`, `LLM_PROXY_AUTH_TOKEN`, etc.) |
| `images/proxy/Dockerfile` | Multi-stage Docker image for the proxy sandbox (Rust build + minimal runtime + daytona-daemon) |

## Secrets Proxy (MITM)

User-defined API key secrets (Stripe, Twilio, etc.) are stored server-side and **never enter sandbox containers as plaintext**. A transparent MITM HTTPS proxy intercepts outbound traffic from containers and injects real credentials at the HTTP level.

### How It Works

The implementation varies by sandbox provider:

#### Local/Container Providers (Docker, Apple Container)

```
Container app → CONNECT api.stripe.com:443 via HTTPS_PROXY
                            ↓
               MITM Proxy (secrets-proxy.ts, port 9350)
                            ↓
              Looks up domain in secrets DB → match found
                            ↓
              TLS termination with dynamic cert (signed by Apex CA)
                            ↓
              Reads decrypted HTTP request, injects auth header
                            ↓
              https://api.stripe.com (with real Authorization: Bearer <key>)
```

#### Daytona Provider (TCP-over-WebSocket Tunnel)

Since Daytona preview URLs only support HTTP/HTTPS with WebSocket upgrades (no raw TCP ports), HTTPS proxy `CONNECT` requests are tunneled through WebSocket:

```
Regular Sandbox (Daytona)                    Proxy Sandbox (Daytona)
┌─────────────────────────────┐              ┌──────────────────────────────┐
│ App (gh/curl/SDK)           │              │ MITM Secrets Proxy (:9340)  │
│   ↓                         │              │   ▲                          │
│ HTTPS_PROXY=localhost:9339  │  WebSocket   │   │ TCP                      │
│   ↓                         │  /tunnel     │   │                          │
│ TCP-to-WS Client (:9339)    │ ──────────── │ WS-to-TCP Bridge (:3000)    │
│ (bridge script)             │              │ + LLM Proxy                  │
└─────────────────────────────┘              └──────────────────────────────┘
```

For domains **without** secrets, the proxy acts as a transparent TCP tunnel (no interception, no certificate).

### Container Environment

#### Local/Container Providers
- `HTTPS_PROXY` / `HTTP_PROXY` pointing to the proxy (e.g. `http://<host-lan-ip>:9350`)
- `NO_PROXY=localhost,127.0.0.1,0.0.0.0` so local traffic skips the proxy
- Custom CA certificate installed in the system trust store (`update-ca-certificates`)
- `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE` for per-runtime CA trust
- Placeholder env vars for each secret (e.g. `STRIPE_KEY=sk-proxy-placeholder`) so SDKs initialize without error

#### Daytona Provider
- `HTTPS_PROXY=http://localhost:9339` / `HTTP_PROXY=http://localhost:9339` → points to tunnel client in bridge script
- `TUNNEL_ENDPOINT_URL` → WebSocket endpoint URL for tunnel (e.g. `wss://proxy-sandbox/tunnel`)
- `NO_PROXY=localhost,127.0.0.1,0.0.0.0` so local traffic skips the proxy
- Custom CA certificate installed in the system trust store (same as other providers)
- `NODE_EXTRA_CA_CERTS`, etc. for CA trust
- Placeholder env vars for each secret (same as other providers)

### Agent Awareness

Agents can discover configured secrets via the `list_secrets` MCP tool (`mcp__terminal-server__list_secrets`). It returns secret names, domains, and auth types — **never values**. The bridge's `/internal/list-secrets` endpoint fetches this from the API server.

### Auth Types

Each secret specifies how the proxy injects the credential:

| `authType` | Injected Header |
|---|---|
| `bearer` | `Authorization: Bearer <value>` |
| `x-api-key` | `x-api-key: <value>` |
| `basic` | `Authorization: Basic base64(<value>)` |
| `header:X-Custom` | `X-Custom: <value>` |

### CA Certificate Lifecycle

1. On first API server startup, `ca-manager.ts` generates an RSA 2048-bit CA keypair + self-signed certificate using `node-forge`
2. CA cert + key are persisted in the `settings` table (`PROXY_CA_CERT`, `PROXY_CA_KEY`)
3. During `installBridge()` and `restartBridge()`, the CA cert is uploaded to the container and `update-ca-certificates` is run
4. The CA PEM is passed to the Rust `apex-proxy` binary via `CA_CERT_PEM` / `CA_KEY_PEM` env vars. The binary converts PKCS#1 RSA keys to PKCS#8 format for ring/rcgen compatibility.
5. Per-domain certificates use ECDSA P256 keys (fast generation) signed by the RSA CA, and are cached in a lock-free `DashMap`

### Key Files

#### Core Secrets Management
| File | Role |
|---|---|
| `apps/api/src/modules/secrets/secrets.service.ts` | CRUD + domain lookup for secrets (SQLite) |
| `apps/api/src/modules/secrets/secrets.routes.ts` | Elysia REST API under `/api/secrets` |

#### MITM Proxy — Rust Binary (`apps/proxy/`)
| File | Role |
|---|---|
| `apps/proxy/src/main.rs` | Entry point — loads config, starts enabled services (MITM, LLM proxy, tunnel, port relay) |
| `apps/proxy/src/config.rs` | Environment config with `ArcSwap<Vec<Secret>>` for lock-free hot-reload |
| `apps/proxy/src/mitm/mod.rs` | TCP listener, CONNECT handler (MITM vs transparent tunnel), plain HTTP proxy, `/internal/reload-secrets` endpoint |
| `apps/proxy/src/mitm/cert.rs` | CA loading (PKCS#1→PKCS#8), ECDSA P256 domain cert generation, `DashMap` cache |
| `apps/proxy/src/mitm/auth.rs` | `buildAuthHeader()` — bearer, x-api-key, basic, header:* |
| `apps/proxy/src/llm.rs` | LLM reverse proxy, `/health` endpoint, WebSocket upgrade routing |
| `apps/proxy/src/tunnel.rs` | `/tunnel` WebSocket-to-TCP bridge (Daytona tunnel) |
| `apps/proxy/src/port_relay.rs` | `/port-relay/:port` WebSocket-to-TCP bridge |

#### TypeScript Integration
| File | Role |
|---|---|
| `apps/api/src/modules/secrets-proxy/secrets-proxy.ts` | Spawns the Rust binary as a child process; hot-reloads secrets via `/internal/reload-secrets` |
| `apps/api/src/modules/secrets-proxy/ca-manager.ts` | CA keypair generation + persistence (Node.js side, passes PEM to Rust binary) |
| `apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts` | Uploads cross-compiled Linux binary to Daytona proxy sandbox |
| `libs/orchestrator/src/lib/bridge-script.ts` | TCP-to-WebSocket tunnel client on port 9339 |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Daytona proxy config (localhost:9339, tunnel URL), CA cert upload |
| `apps/dashboard/src/pages/secrets-page.tsx` | Secrets management UI at `/secrets` |

## Preview Proxy (Local Providers)

Docker and Apple Container sandboxes have IPs reachable only from the API server host (Docker bridge network or macOS virtual network). The **preview proxy** makes sandbox ports accessible to the browser without port mapping.

### HTTP Reverse Proxy

`apps/api/src/modules/preview/preview.routes.ts` registers an Elysia `onRequest` handler matching `/preview/:projectId/:port/*`. It resolves the project's sandbox IP via `SandboxManager.getPortPreviewUrl()` and proxies the request to `http://<container-ip>:<port>/<subpath>`.

The bridge's `get_preview_url` MCP tool (used by agents) returns proxy URLs when `APEX_PROXY_BASE_URL` and `APEX_PROJECT_ID` are set:

```
/preview/<projectId>/<port>/
```

For Daytona sandboxes, the MCP tool falls back to the Daytona API's signed preview URL (proxied through the Daytona platform).

### TCP Port Forwarding

`apps/api/src/modules/preview/port-forwarder.ts` provides on-demand TCP tunnels for Docker and Apple Container sandboxes. The `forward_port` socket event creates a local TCP server that pipes connections to the container IP. This is used by the desktop app where `localhost` URLs are required. Forwards are cleaned up via `unforward_port` or when the sandbox is deleted.

### Socket Events

| Event | Direction | Description |
|---|---|---|
| `port_preview_url` | client→server | Request a preview URL for a port |
| `port_preview_url_result` | server→client | Returns `{ port, url }` — proxy path for Docker/Apple Container, Daytona URL for cloud |
| `forward_port` | client→server | Create a TCP forward (local providers only) |
| `forward_port_result` | server→client | Returns `{ port, localPort, url }` |
| `unforward_port` | client→server | Tear down a TCP forward |

## Terminal UI
- Bottom resizable panel (VS Code style) with drag handle
- Tab bar with terminal names + "+" to create, "x" to close
- Each tab renders an xterm.js `Terminal` with Tokyo Night theme
- `FitAddon` + `ResizeObserver` for automatic sizing
- `XtermRegistry` class buffers events that arrive before xterm mounts (race condition fix)
- Panel toggle bar always visible; panel hidden by default
- Zustand store (`useTerminalStore`) tracks terminals, active tab, panel open/closed state

## File Editor (Monaco + LSP)
The central panel toggles between `AgentThread` and `CodeViewer` based on `useEditorStore.activeView`.

- Clicking a file in the explorer calls `useEditorStore.openFile()` (switches to `editor` view) and emits `file_read` via socket to fetch content.
- `CodeViewer` renders `@typefox/monaco-editor-react` (`MonacoEditorReactComp`) backed by `monaco-languageclient` and VS Code services (`@codingame/monaco-vscode-*`). Theme is "Default Dark Modern" via VS Code's `userConfiguration`. Language detection via `lang-map.ts`.
- **LSP integration**: On file open, `lsp-context.tsx` determines the language and connects a `LanguageClientWrapper` via a custom Socket.io transport (`lsp-transport.ts`). LSP messages flow: dashboard → Socket.io `lsp_data` → NestJS relay → bridge → LSP server (stdio), and back via `lsp_response`. One language client per language, shared across all open files. Per-language status (starting/ready/error) is tracked in `lsp-store.ts` via `lsp_status` events.
- **Context menu**: Right-click opens a custom context menu with LSP actions (Go to Definition/Type Definition/Implementations/References, Find All References/Implementations, Rename Symbol) plus Cut/Copy/Paste. On the desktop app, Electrobun's native `ContextMenu.showContextMenu()` API is used; on the web, a DOM popup (`EditorContextMenu`). LSP actions are disabled when the language server isn't ready. "Go to" actions use Monaco's built-in commands (`editor.trigger`); "Find All" actions send direct LSP requests via Socket.io and display results in the References sidebar panel.
- **Sandbox file system**: `lsp-context.tsx` registers a `registerFileSystemOverlay` from `@codingame/monaco-vscode-files-service-override` that fetches file content on demand from the sandbox via Socket.io `file_read`/`file_read_result`. This enables Monaco's peek widgets (Go to References, etc.) to load and display code from any file in the sandbox, not just the currently open file.
- **Save flow**: Ctrl/Cmd+S → `editor.save` command → `writeFile(path, content)` → socket `file_write` → gateway → `SandboxManager.writeFile()` → `sandbox.fs.uploadFile()`. On success, gateway emits `file_write_result { ok: true }` → `useEditorStore.markClean()` clears the dirty indicator.
- **Snippet copy**: Ctrl/Cmd+C in the editor attaches `CodeSelection` metadata (file path, line/char range) to the clipboard alongside the plain text. This metadata is used by the prompt input for `@`-referenced code snippets.
- Dirty files are tracked in `useEditorStore.dirtyFiles` (a `Set<string>`). Unsaved changes show a dot in the file tab bar.
- **Reveal line**: Clicking a reference in the References panel or search results calls `openFileAtLine()`, which sets `revealLineAt` in the editor store. `CodeViewer` consumes this to scroll the editor to the target line via `editor.revealLineInCenter()`.

## LSP (Language Server Protocol)

The bridge inside each sandbox manages LSP servers for language intelligence (completions, hover, go-to-definition, diagnostics). Two consumers: the dashboard editor (real-time) and the agent (via MCP tools).

### Bridge LSP Manager

`bridge-script.ts` contains an LSP process manager:

- **On-demand activation**: LSP servers spawn lazily on the first request for a language. No servers run at boot.
- **Language → command mapping**: `typescript`/`javascript` → `typescript-language-server --stdio`, `python` → `pylsp`, `go` → `gopls`, `rust` → `rust-analyzer`, `java` → `jdtls`
- Sends `initialize` handshake with the correct `rootUri`
- Emits `lsp_status` messages (starting/ready/error/stopped) over the bridge WebSocket
- Handles restart-on-crash and cleanup on disconnect
- Two interfaces:
  1. **Streaming** (dashboard): WebSocket `lsp_data`/`lsp_response` message forwarding of raw JSON-RPC
  2. **Request/response** (agent MCP): `POST /internal/lsp-request` sends a single LSP request and returns the response

### MCP LSP Server (Agent)

`mcp-lsp-script.ts` exposes LSP operations as MCP tools for the agent:

| MCP Tool | Description |
|---|---|
| `lsp_hover` | Get hover info at file:line:col |
| `lsp_definition` | Go to definition |
| `lsp_references` | Find all references |
| `lsp_diagnostics` | Get diagnostics for a file |
| `lsp_completions` | Get completions at position |
| `lsp_symbols` | List document or workspace symbols |

Each tool calls `POST /internal/lsp-request` on the bridge. Registered in `opencode.json` alongside the terminal MCP server.

### Dashboard LSP Client

- `lsp-transport.ts`: Custom `MessageTransport` bridging Socket.io events to JSON-RPC reader/writer
- `lsp-context.tsx`: React context managing language client lifecycle per open file
- `lsp-store.ts`: Zustand store tracking per-language LSP status from `lsp_status` events
- `use-lsp-socket.ts`: Socket.io hook for LSP + status event handling

## Project Status Bar
A single-line bottom bar displays project info and git controls (VS Code-style).

**Left side** (left to right):
- **Project name** — truncated to 200px
- **Git branch button** — clickable, opens a `BranchPicker` dropdown with commands (create branch, create from, checkout detached) and a scrollable branch list sorted by last used. Branch name reads from `useGitStore.branch` (stable) → `info.gitBranch` → `project.gitRepo` fallback chain.
- **Sync status button** — refresh icon + ↓N ↑M (commits behind/ahead). Clicking triggers pull/push as needed. Refresh icon spins during git operations.

**Right side**: `SandboxStatus` indicator + "VS Code" browser IDE button (or "Open in IDE" for the desktop app).

- **Branch resolution**: Primary source is `useGitStore.branch` (updated every 5s from `git_status` polling, never resets mid-session). Falls back to `useProjectInfoSocket` (polls `project_info` every 10s) and `project.gitRepo`.
- **Branch management**: `listBranches`, `createBranch`, `checkout` actions in `useGitSocket` emit `git_branches` / `git_create_branch` / `git_checkout` events to the gateway.
- Component: `ProjectStatusBar` + `BranchPicker` rendered at the very bottom of `AppShell`

## Layout Persistence
Layout state (terminal panel, sidebars, active thread, editor tabs) is stored in two places:

1. **Server-side** (sandbox filesystem `~/.apex-layout.json`) — persists across machines and browser sessions.
2. **Client-side** (`localStorage` key `apex-layout:{projectId}`) — instant restore on page refresh even when the sandbox is unavailable.

- **Save**: Any Zustand store change (terminals, threads, panels, editor) → `useLayoutSocket` debounces (500ms) → Socket.io `layout_save` to server + immediate `localStorage` write.
- **Load**: On mount, `localStorage` data is applied instantly (no blank UI). Then `layout_load` is emitted to the server. If the server responds with `layout_data`, it overrides the local backup (server is source of truth). If the server times out (3s), the `localStorage` layout is already active.
- The `LayoutData` shape: `{ terminalPanelOpen, terminalPanelHeight, activeTerminalId, activeThreadId, leftSidebarOpen, rightSidebarOpen, threadScrollOffsets, openFiles, activeFilePath, activeView, fileScrollOffsets }`

## Project Navigation & Store Reset
When switching projects, all project-specific Zustand stores must be reset to avoid stale content from the previous project leaking into the new one.

- **`resetProjectStores()`** (`lib/reset-project-stores.ts`) clears: terminal, threads, editor, file tree, ports, and panels stores.
- Called on **`HomePage` mount** — when the user navigates back to the projects list, stale state from the previous project is wiped.
- NOT called in `openProject()` or `ProjectPage` mount — those open new windows (desktop app) or tabs (browser) with naturally fresh stores.

## Key Files
```
apps/api/src/modules/agent/agent.gateway.ts    – Socket.io gateway, bridges dashboard↔sandbox + local PTY fallback
apps/api/src/modules/tasks/tasks.service.ts     – ThreadsService (CRUD for threads + messages)
apps/api/src/modules/projects/projects.service.ts – Project CRUD + sandbox provisioning
libs/orchestrator/src/lib/sandbox-manager.ts    – Sandbox lifecycle + bridge WS + terminal methods
libs/orchestrator/src/lib/bridge-script.ts      – JS code uploaded into sandbox (OpenCode adapter + PTY terminals + HTTP API)
libs/orchestrator/src/lib/mcp-terminal-script.ts – MCP server script for agent-driven terminals
libs/orchestrator/src/lib/mcp-lsp-script.ts      – MCP server script for agent LSP tools (hover, definition, references, diagnostics, completions, symbols)
libs/orchestrator/src/lib/types.ts              – Bridge message types (agent + terminal + LSP)
apps/dashboard/src/hooks/use-agent-socket.ts    – Socket.io hook for real-time streaming
apps/dashboard/src/hooks/use-terminal-socket.ts – Socket.io hook for terminal events + XtermRegistry
apps/dashboard/src/hooks/use-layout-socket.ts   – Socket.io hook for layout persistence (debounced save/restore + localStorage fallback)
apps/dashboard/src/lib/reset-project-stores.ts  – Centralized reset of all project-specific Zustand stores
apps/dashboard/src/lib/open-project.ts           – Opens project in new window (desktop) or tab (browser)
apps/dashboard/src/hooks/use-project-info-socket.ts – Socket.io hook for git branch polling
apps/dashboard/src/stores/tasks-store.ts        – Zustand store (useThreadsStore)
apps/dashboard/src/stores/terminal-store.ts     – Zustand store (useTerminalStore)
apps/dashboard/src/stores/editor-store.ts        – Zustand store (useEditorStore) — open files, dirty tracking, code selections
apps/dashboard/src/stores/file-tree-store.ts     – Zustand store (useFileTreeStore) — directory cache, root path
apps/dashboard/src/stores/plan-store.ts          – Zustand store (usePlanStore) — plan mode state + content extraction
apps/dashboard/src/stores/agent-settings-store.ts – Zustand store — agent type (build/plan/sisyphus) + model selection
apps/dashboard/src/components/agent/agent-thread.tsx – Main thread panel (stats toggle, reasoning toggle)
apps/dashboard/src/components/agent/message-bubble.tsx – Message grouping + rendering (plan detection, markdown blocks)
apps/dashboard/src/components/agent/thread-stats-bar.tsx – Aggregated thread stats bar (cost, tokens, context %, MCPs)
apps/dashboard/src/lib/model-context.ts             – Model context window sizes + token formatting helpers
apps/dashboard/src/components/agent/plan-block.tsx     – Inline plan card (markdown + Build button)
apps/dashboard/src/components/agent/markdown-block.tsx  – Inline collapsible markdown card (summaries)
apps/dashboard/src/components/editor/code-viewer.tsx      – Monaco-based file editor (LSP-enabled, context menu, syntax highlighting, save, snippet copy, reveal-line)
apps/dashboard/src/components/editor/editor-context-menu.tsx – DOM-based editor context menu (web; desktop uses native Electrobun menu)
apps/dashboard/src/components/editor/lsp-request.ts       – One-shot LSP request utility for Find All References/Implementations
apps/dashboard/src/components/editor/lsp-transport.ts     – Socket.io → JSON-RPC message transport for language clients
apps/dashboard/src/components/editor/lsp-context.tsx      – React context managing per-language LSP client lifecycle + sandbox FS overlay
apps/dashboard/src/components/editor/sandbox-fs-provider.ts – VS Code file system overlay that fetches sandbox files on demand via Socket.io
apps/dashboard/src/components/editor/references-panel.tsx  – Sidebar panel for Find All References/Implementations results
apps/dashboard/src/components/editor/lang-map.ts          – File extension → Monaco language ID mapping
apps/dashboard/src/stores/lsp-store.ts                     – Zustand store — per-language LSP server status
apps/dashboard/src/stores/references-store.ts              – Zustand store — Find All References/Implementations results
apps/dashboard/src/hooks/use-lsp-socket.ts                 – Socket.io hook for LSP data/status events
apps/dashboard/src/components/terminal/terminal-panel.tsx  – Resizable bottom panel with tabs
apps/dashboard/src/components/terminal/terminal-tab.tsx    – Single xterm.js terminal renderer
apps/dashboard/src/components/terminal/terminal-tabs.tsx   – Tab bar (names, +, x)
apps/api/src/modules/preview/preview.routes.ts             – HTTP reverse proxy for Docker/Apple Container sandbox ports
apps/api/src/modules/preview/port-forwarder.ts             – TCP port forwarding for local sandboxes (desktop app)
apps/api/src/modules/secrets/secrets.service.ts            – Secrets CRUD + domain lookup
apps/api/src/modules/secrets/secrets.routes.ts             – Secrets REST API (/api/secrets)
apps/api/src/modules/secrets-proxy/secrets-proxy.ts        – MITM HTTPS proxy (port 9350)
apps/api/src/modules/secrets-proxy/ca-manager.ts           – CA cert generation + per-domain cert caching
apps/dashboard/src/hooks/use-file-tree-socket.ts          – Socket.io hook for file explorer (list, CRUD, read, write)
apps/dashboard/src/components/layout/project-status-bar.tsx – Bottom status bar (project name, git branch picker, sync status)
apps/dashboard/src/components/layout/branch-picker.tsx     – Branch picker dropdown (create/checkout/list branches)
```
