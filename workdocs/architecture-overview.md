# Apex – Architecture Overview

## Stack
- **API**: NestJS + TypeORM + SQLite (`apps/api`) on port 6000
- **Dashboard**: React + Zustand + Tailwind (`apps/dashboard`) on port 4200 (Vite)
- **Orchestrator lib**: `libs/orchestrator` – provider-agnostic sandbox management (Daytona cloud, Docker local, or Apple Container macOS VM) + WebSocket bridge to agent CLIs
- **Sandbox bridge**: Node.js script uploaded into each Daytona sandbox. Uses an adapter pattern to support three agent backends:
  - **Claude Code**: long-lived `claude --output-format stream-json --input-format stream-json` process with bidirectional stdin/stdout pipes
  - **OpenCode**: per-prompt `opencode run --format json` processes with `--session` for context continuity
  - **Codex**: long-lived `codex app-server --listen stdio://` process with JSON-RPC 2.0 protocol (thread/turn lifecycle)
  All adapters normalize output into the same event format (`system`/`assistant`/`result` with content blocks) so the gateway and dashboard stay agent-agnostic. Terminal PTY sessions are shared across all agent types.

## Data Model
- **Project** → has a sandbox (provisioned async on creation). Each project stores a `provider` field (`daytona`, `docker`, or `apple-container`) that selects the sandbox backend. Optional `gitRepo` URL for cloning a repository. Stores `agentType` as the project-level default agent (claude_code, open_code, codex).
- **Thread** (DB table: `tasks`) → belongs to a project, has messages. Title auto-generated from first prompt. Stores `claudeSessionId` to maintain a persistent Claude Code session across follow-up prompts. Optional `agentType` overrides the project default, allowing different threads within one project to use different agents.
- **Message** → belongs to a thread. Roles: `user`, `assistant`, `system`. Content is JSON array of blocks (text, tool_use, tool_result, image). Image blocks carry a `source` field with base64-encoded data.

## Key Flows

### Project Creation
1. `POST /api/projects` → creates project with `status: creating`. Accepts optional `gitRepo` URL and `provider` (default `daytona`).
2. `ProjectsService.provisionSandbox()` runs async → routes to the correct `SandboxManager` based on the project's `provider` field, creates sandbox, installs bridge + MCP terminal server, connects via preview URL → sets `status: running` + stores `sandboxId`
3. During sandbox provisioning: if `gitRepo` is set, clones the repo into the project directory (`git clone <url> .`); otherwise runs `git init` so every project starts version-controlled
4. Dashboard polls project status while `creating`, shows sandbox status indicator (green/yellow/red) in top bar

### Thread + Agent Execution (Session-per-Thread)
Each thread maintains a long-lived Claude Code process. The first prompt spawns the process; follow-ups are piped to stdin as JSONL messages, keeping full conversational context within a single process.

1. User clicks "New Thread" → composing mode (prompt input, no dialog)
2. User types prompt → `POST /api/projects/:id/threads` creates thread + stores first user message
3. Dashboard emits `execute_thread { threadId }` via Socket.io → gateway reads first message, sends to sandbox
4. `SandboxManager.sendPrompt(sandboxId, prompt, threadId, sessionId)` → auto-reconnects if server restarted
5. Bridge spawns `claude --dangerously-skip-permissions --output-format stream-json --input-format stream-json -p <prompt>` (first prompt), or pipes a JSONL user message to the existing process's stdin (follow-ups). If the process has exited (crash/reload), `--resume <sessionId>` restores context.
6. Claude's `system` init message contains `session_id` → gateway captures it → stored on the thread entity as `claudeSessionId`
7. Claude output streams: bridge → WS (tagged with `threadId`) → SandboxManager → gateway filters by `threadId` → forwards via Socket.io `agent_message` → dashboard renders in real-time
8. Multiple threads can have concurrent Claude processes in the same sandbox (bridge tracks processes per threadId in a Map)

### Follow-up Prompts
1. User sends another message → dashboard emits `send_prompt { threadId, prompt, images? }`
2. Gateway stores user message in DB (with image content blocks if present), sends `start_claude` to bridge with optional `images` array → bridge converts images to OpenCode `FilePartInput` format (`{ type: "file", mime, url: "data:..." }`) and includes them in the `prompt_async` parts alongside the text

### AskUserQuestion (waiting_for_input)
Claude's native `AskUserQuestion` tool is **disallowed** in all modes (both TS and Go bridges). Instead, all agents use the MCP `ask_user` tool (`mcp__terminal-server__ask_user`) which routes through the bridge's `/internal/ask-user` endpoint:

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
An MCP server (`mcp-terminal-server.js`) runs inside the sandbox alongside the bridge. It gives Claude Code 5 tools:

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

The MCP server communicates with the bridge via local HTTP endpoints (`/internal/terminal-create`, `/internal/terminal-read`, `/internal/ask-user`, etc.). Agents discover the tools via their MCP config: Claude Code uses `~/.claude.json`, OpenCode uses `opencode.json`, Codex uses `codex mcp add`.

Example: user asks *"start the dev server so I can watch it"* → Claude calls `open_terminal({ name: "Dev Server", command: "npm run dev" })` → a new tab appears in the dashboard terminal panel with live output.

## Socket.io Setup
- Server: NestJS `@WebSocketGateway` at namespace `/ws/agent`, path `/ws/socket.io`
- Client: `socket.io-client` connects with same path
- Vite proxy: `/ws` → `http://localhost:6000` with `ws: true`
- Thread events: `subscribe_project`, `execute_thread`, `send_prompt`, `user_answer` (client→server); `agent_message`, `agent_status`, `agent_error` (server→client). `send_prompt` and `execute_thread` accept optional `agentType` to override the project default per-thread. `send_prompt` also accepts an optional `images` array (base64-encoded `{ type, media_type, data }` objects) for multimodal prompts. `agent_status` values: `running`, `waiting_for_input`, `retrying`, `completed`, `error`. `agent_message` carries `system`/`init` (MCP servers, tools, model), `assistant` (content blocks + usage), and `result` (cost, tokens, duration, turns) subtypes.
- Terminal events: `terminal_create`, `terminal_input`, `terminal_resize`, `terminal_close`, `terminal_list` (client→server); `terminal_created`, `terminal_output`, `terminal_exit`, `terminal_error`, `terminal_list` (server→client)
- File events: `file_list`, `file_create`, `file_rename`, `file_delete`, `file_move`, `file_read`, `file_write` (client→server); `file_list_result`, `file_op_result`, `file_changed`, `file_read_result`, `file_write_result` (server→client)
- Project info events: `project_info` (client→server + server→client) – returns `{ gitBranch, projectDir }` for the status bar and file tree root
- Git branch events: `git_branches`, `git_create_branch`, `git_checkout` (client→server); `git_branches_result` (server→client) – branch list and switching
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

API keys for LLM providers (Anthropic, OpenAI) are **never sent into sandbox containers**. Instead, the Elysia API runs a streaming reverse proxy that injects real keys server-side.

### How It Works

```
Container (OpenCode) → http://<host-ip>:6000/llm-proxy/anthropic/v1/messages
                                    ↓
                        Elysia LLM Proxy (llm-proxy.routes.ts)
                                    ↓
                        Reads real key from SettingsService
                                    ↓
                        https://api.anthropic.com/v1/messages (with real x-api-key header)
```

Containers receive:
- `ANTHROPIC_API_KEY=sk-proxy-placeholder` / `OPENAI_API_KEY=sk-proxy-placeholder` — dummy values so SDKs initialize without error
- `ANTHROPIC_BASE_URL=http://<host-ip>:<port>/llm-proxy/anthropic/v1` — redirects all Anthropic API calls through the proxy
- `OPENAI_BASE_URL=http://<host-ip>:<port>/llm-proxy/openai/v1` — redirects all OpenAI API calls through the proxy

The OpenCode config (`opencode.json`) uses `{env:ANTHROPIC_BASE_URL}` / `{env:OPENAI_BASE_URL}` in `provider.*.options.baseURL` to pick up these URLs.

### Provider-Aware Routing

The proxy URL resolution in `sandbox-manager.ts` adapts to the sandbox provider:

- **Local providers** (Docker, Apple Container): `localhost` in the proxy URL is replaced with the host machine's LAN IP (via `os.networkInterfaces()`), since containers can't reach the host via `localhost`. The API server must listen on `0.0.0.0`.
- **Daytona** (cloud): The proxy only works when `API_BASE_URL` is set to a publicly reachable URL. If the API is running locally (no public URL), falls back to sending real keys directly into the container (same as pre-proxy behavior).

### Key Files

| File | Role |
|---|---|
| `apps/api/src/modules/llm-proxy/llm-proxy.routes.ts` | Elysia streaming reverse proxy — matches `/llm-proxy/(anthropic\|openai)/*`, injects real API keys from `settingsService` |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | `resolveProxyBaseUrl()` — adapts proxy URL per provider; `restartBridge()` / `installBridge()` — writes `.env` with proxy URLs + dummy keys, configures `opencode.json` with provider base URLs |
| `apps/api/src/modules/settings/settings.service.ts` | Stores and retrieves API keys (SQLite DB + env var fallback) — keys never leave this service |

## Secrets Proxy (MITM)

User-defined API key secrets (Stripe, Twilio, etc.) are stored server-side and **never enter sandbox containers as plaintext**. A transparent MITM HTTPS proxy intercepts outbound traffic from containers and injects real credentials at the HTTP level.

### How It Works

```
Container app → CONNECT api.stripe.com:443 via HTTPS_PROXY
                            ↓
              MITM Proxy (secrets-proxy.ts, port 6001)
                            ↓
              Looks up domain in secrets DB → match found
                            ↓
              TLS termination with dynamic cert (signed by Apex CA)
                            ↓
              Reads decrypted HTTP request, injects auth header
                            ↓
              https://api.stripe.com (with real Authorization: Bearer <key>)
```

For domains **without** secrets, the proxy acts as a transparent TCP tunnel (no interception, no certificate).

Containers receive:
- `HTTPS_PROXY` / `HTTP_PROXY` pointing to the proxy (e.g. `http://<host-lan-ip>:6001`)
- `NO_PROXY=localhost,127.0.0.1,0.0.0.0` so local traffic skips the proxy
- Custom CA certificate installed in the system trust store (`update-ca-certificates`)
- `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE` for per-runtime CA trust
- Placeholder env vars for each secret (e.g. `STRIPE_KEY=sk-proxy-placeholder`) so SDKs initialize without error

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
4. Per-domain certificates are generated on-the-fly by the proxy and cached in memory

### Key Files

| File | Role |
|---|---|
| `apps/api/src/modules/secrets/secrets.service.ts` | CRUD + domain lookup for secrets (SQLite) |
| `apps/api/src/modules/secrets/secrets.routes.ts` | Elysia REST API under `/api/secrets` |
| `apps/api/src/modules/secrets-proxy/secrets-proxy.ts` | MITM proxy server — CONNECT handler, selective TLS interception, auth injection, transparent tunnel fallback |
| `apps/api/src/modules/secrets-proxy/ca-manager.ts` | CA keypair generation, persistence, per-domain certificate generation + caching |
| `apps/api/src/database/schema.ts` | `secrets` table definition |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | CA cert upload, `HTTPS_PROXY` env injection, secret placeholder env vars |
| `libs/orchestrator/src/lib/mcp-terminal-script.ts` | `list_secrets` MCP tool |
| `libs/orchestrator/src/lib/bridge-script.ts` | `/internal/list-secrets` bridge endpoint |
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

`apps/api/src/modules/preview/port-forwarder.ts` provides on-demand TCP tunnels for Docker and Apple Container sandboxes. The `forward_port` socket event creates a local TCP server that pipes connections to the container IP. This is used by the Electron desktop app where `localhost` URLs are required. Forwards are cleaned up via `unforward_port` or when the sandbox is deleted.

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

## File Editor (Monaco)
The central panel toggles between `AgentThread` and `CodeViewer` based on `useEditorStore.activeView`.

- Clicking a file in the explorer calls `useEditorStore.openFile()` (switches to `editor` view) and emits `file_read` via socket to fetch content.
- `CodeViewer` renders `@monaco-editor/react` with a custom "apex-dark" theme (`apex-theme.ts`) and auto-detected language (`lang-map.ts`).
- **Save flow**: Ctrl/Cmd+S → `editor.save` command → `writeFile(path, content)` → socket `file_write` → gateway → `SandboxManager.writeFile()` → `sandbox.fs.uploadFile()`. On success, gateway emits `file_write_result { ok: true }` → `useEditorStore.markClean()` clears the dirty indicator.
- **Snippet copy**: Ctrl/Cmd+C in the editor attaches `CodeSelection` metadata (file path, line/char range) to the clipboard alongside the plain text. This metadata is used by the prompt input for `@`-referenced code snippets.
- Dirty files are tracked in `useEditorStore.dirtyFiles` (a `Set<string>`). Unsaved changes show a dot in the file tab bar.

## Project Status Bar
A single-line bottom bar displays project info and git controls (VS Code-style).

**Left side** (left to right):
- **Project name** — truncated to 200px
- **Git branch button** — clickable, opens a `BranchPicker` dropdown with commands (create branch, create from, checkout detached) and a scrollable branch list sorted by last used. Branch name reads from `useGitStore.branch` (stable) → `info.gitBranch` → `project.gitRepo` fallback chain.
- **Sync status button** — refresh icon + ↓N ↑M (commits behind/ahead). Clicking triggers pull/push as needed. Refresh icon spins during git operations.

**Right side**: `SandboxStatus` indicator + "VS Code" browser IDE button (or "Open in IDE" for Electron).

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
- NOT called in `openProject()` or `ProjectPage` mount — those open new windows (Electron) or tabs (browser) with naturally fresh stores.

## Key Files
```
apps/api/src/modules/agent/agent.gateway.ts    – Socket.io gateway, bridges dashboard↔sandbox + local PTY fallback
apps/api/src/modules/tasks/tasks.service.ts     – ThreadsService (CRUD for threads + messages)
apps/api/src/modules/projects/projects.service.ts – Project CRUD + sandbox provisioning
libs/orchestrator/src/lib/sandbox-manager.ts    – Daytona sandbox lifecycle + bridge WS + terminal methods
libs/orchestrator/src/lib/bridge-script.ts      – JS code uploaded into sandbox (Claude CLI + PTY terminals + HTTP API)
libs/orchestrator/src/lib/mcp-terminal-script.ts – MCP server script for Claude-driven terminals
libs/orchestrator/src/lib/types.ts              – Bridge message types (Claude + terminal)
apps/dashboard/src/hooks/use-agent-socket.ts    – Socket.io hook for real-time streaming
apps/dashboard/src/hooks/use-terminal-socket.ts – Socket.io hook for terminal events + XtermRegistry
apps/dashboard/src/hooks/use-layout-socket.ts   – Socket.io hook for layout persistence (debounced save/restore + localStorage fallback)
apps/dashboard/src/lib/reset-project-stores.ts  – Centralized reset of all project-specific Zustand stores
apps/dashboard/src/lib/open-project.ts           – Opens project in new window (Electron) or tab (browser)
apps/dashboard/src/hooks/use-project-info-socket.ts – Socket.io hook for git branch polling
apps/dashboard/src/stores/tasks-store.ts        – Zustand store (useThreadsStore)
apps/dashboard/src/stores/terminal-store.ts     – Zustand store (useTerminalStore)
apps/dashboard/src/stores/editor-store.ts        – Zustand store (useEditorStore) — open files, dirty tracking, code selections
apps/dashboard/src/stores/file-tree-store.ts     – Zustand store (useFileTreeStore) — directory cache, root path
apps/dashboard/src/stores/plan-store.ts          – Zustand store (usePlanStore) — plan mode state + content extraction
apps/dashboard/src/stores/agent-settings-store.ts – Zustand store — agent mode/model selection
apps/dashboard/src/components/agent/agent-thread.tsx – Main thread panel (stats toggle, reasoning toggle)
apps/dashboard/src/components/agent/message-bubble.tsx – Message grouping + rendering (plan detection, markdown blocks)
apps/dashboard/src/components/agent/thread-stats-bar.tsx – Aggregated thread stats bar (cost, tokens, context %, MCPs)
apps/dashboard/src/lib/model-context.ts             – Model context window sizes + token formatting helpers
apps/dashboard/src/components/agent/plan-block.tsx     – Inline plan card (markdown + Build button)
apps/dashboard/src/components/agent/markdown-block.tsx  – Inline collapsible markdown card (summaries)
apps/dashboard/src/components/editor/code-viewer.tsx      – Monaco-based file editor (syntax highlighting, save, snippet copy)
apps/dashboard/src/components/editor/apex-theme.ts        – Custom Monaco dark theme
apps/dashboard/src/components/editor/lang-map.ts          – File extension → Monaco language ID mapping
apps/dashboard/src/components/terminal/terminal-panel.tsx  – Resizable bottom panel with tabs
apps/dashboard/src/components/terminal/terminal-tab.tsx    – Single xterm.js terminal renderer
apps/dashboard/src/components/terminal/terminal-tabs.tsx   – Tab bar (names, +, x)
apps/api/src/modules/preview/preview.routes.ts             – HTTP reverse proxy for Docker/Apple Container sandbox ports
apps/api/src/modules/preview/port-forwarder.ts             – TCP port forwarding for local sandboxes (Electron)
apps/api/src/modules/secrets/secrets.service.ts            – Secrets CRUD + domain lookup
apps/api/src/modules/secrets/secrets.routes.ts             – Secrets REST API (/api/secrets)
apps/api/src/modules/secrets-proxy/secrets-proxy.ts        – MITM HTTPS proxy (port 6001)
apps/api/src/modules/secrets-proxy/ca-manager.ts           – CA cert generation + per-domain cert caching
apps/dashboard/src/hooks/use-file-tree-socket.ts          – Socket.io hook for file explorer (list, CRUD, read, write)
apps/dashboard/src/components/layout/project-status-bar.tsx – Bottom status bar (project name, git branch picker, sync status)
apps/dashboard/src/components/layout/branch-picker.tsx     – Branch picker dropdown (create/checkout/list branches)
```
