# Apex – Architecture Overview

## Stack
- **API**: NestJS + TypeORM + SQLite (`apps/api`) on port 6000
- **Dashboard**: React + Zustand + Tailwind (`apps/dashboard`) on port 4200 (Vite)
- **Orchestrator lib**: `libs/orchestrator` – manages Daytona sandboxes + WebSocket bridge to Claude CLI
- **Sandbox bridge**: Node.js script uploaded into each Daytona sandbox, manages a long-lived `claude --output-format stream-json --input-format stream-json` process with bidirectional stdin/stdout pipes over WebSocket + manages PTY terminal sessions

## Data Model
- **Project** → has a Daytona sandbox (provisioned async on creation). Optional `gitRepo` URL for cloning a repository.
- **Chat** (DB table: `tasks`) → belongs to a project, has messages. Title auto-generated from first prompt. Stores `claudeSessionId` to maintain a persistent Claude Code session across follow-up prompts.
- **Message** → belongs to a chat. Roles: `user`, `assistant`, `system`. Content is JSON array of blocks (text, tool_use, tool_result).

## Key Flows

### Project Creation
1. `POST /api/projects` → creates project with `status: creating`. Accepts optional `gitRepo` URL.
2. `ProjectsService.provisionSandbox()` runs async → creates Daytona sandbox via `SandboxManager`, installs bridge + MCP terminal server, connects via WSS preview URL → sets `status: running` + stores `sandboxId`
3. During sandbox provisioning: if `gitRepo` is set, clones the repo into the project directory (`git clone <url> .`); otherwise runs `git init` so every project starts version-controlled
4. Dashboard polls project status while `creating`, shows sandbox status indicator (green/yellow/red) in top bar

### Chat + Agent Execution (Session-per-Chat)
Each chat maintains a long-lived Claude Code process. The first prompt spawns the process; follow-ups are piped to stdin as JSONL messages, keeping full conversational context within a single process.

1. User clicks "New Chat" → composing mode (prompt input, no dialog)
2. User types prompt → `POST /api/projects/:id/chats` creates chat + stores first user message
3. Dashboard emits `execute_chat { chatId }` via Socket.io → gateway reads first message, sends to sandbox
4. `SandboxManager.sendPrompt(sandboxId, prompt, chatId, sessionId)` → auto-reconnects if server restarted
5. Bridge spawns `claude --dangerously-skip-permissions --output-format stream-json --input-format stream-json -p <prompt>` (first prompt), or pipes a JSONL user message to the existing process's stdin (follow-ups). If the process has exited (crash/reload), `--resume <sessionId>` restores context.
6. Claude's `system` init message contains `session_id` → gateway captures it → stored on the chat entity as `claudeSessionId`
7. Claude output streams: bridge → WS (tagged with `chatId`) → SandboxManager → gateway filters by `chatId` → forwards via Socket.io `agent_message` → dashboard renders in real-time
8. Multiple chats can have concurrent Claude processes in the same sandbox (bridge tracks processes per chatId in a Map)

### Follow-up Prompts
1. User sends another message → dashboard emits `send_prompt { chatId, prompt }`
2. Gateway stores user message in DB, sends `start_claude` to bridge → bridge detects an existing process for that chatId and pipes the prompt to stdin as `{"type":"user","message":{"role":"user","content":"..."}}`

### AskUserQuestion
When Claude calls the `AskUserQuestion` tool, the bridge forwards the `tool_use` block to the dashboard via `agent_message`. The dashboard renders a multiple-choice UI (`AskQuestionBlock`). When the user selects options and clicks Continue:
1. Dashboard emits `user_answer { chatId, toolUseId, answer }` via Socket.io
2. Gateway resolves chat → project → sandbox → `SandboxManager.sendUserAnswer()`
3. Bridge pipes a JSONL `tool_result` message to Claude's stdin, referencing the `tool_use_id`
4. Claude receives the answer and continues execution

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

The MCP server communicates with the bridge via local HTTP endpoints (`/internal/terminal-create`, `/internal/terminal-read`, etc.). Claude discovers the tools via `~/.claude/mcp.json` written during sandbox provisioning.

Example: user asks *"start the dev server so I can watch it"* → Claude calls `open_terminal({ name: "Dev Server", command: "npm run dev" })` → a new tab appears in the dashboard terminal panel with live output.

## Socket.io Setup
- Server: NestJS `@WebSocketGateway` at namespace `/ws/agent`, path `/ws/socket.io`
- Client: `socket.io-client` connects with same path
- Vite proxy: `/ws` → `http://localhost:6000` with `ws: true`
- Chat events: `subscribe_project`, `execute_chat`, `send_prompt`, `user_answer` (client→server); `agent_message`, `agent_status`, `agent_error` (server→client)
- Terminal events: `terminal_create`, `terminal_input`, `terminal_resize`, `terminal_close`, `terminal_list` (client→server); `terminal_created`, `terminal_output`, `terminal_exit`, `terminal_error`, `terminal_list` (server→client)
- File events: `file_list`, `file_create`, `file_rename`, `file_delete`, `file_move`, `file_read`, `file_write` (client→server); `file_list_result`, `file_op_result`, `file_changed`, `file_read_result`, `file_write_result` (server→client)
- Project info events: `project_info` (client→server + server→client) – returns `{ gitBranch, projectDir }` for the status bar and file tree root
- Git branch events: `git_branches`, `git_create_branch`, `git_checkout` (client→server); `git_branches_result` (server→client) – branch list and switching
- Payload uses `chatId` (maps to internal `taskId` in DB)

## Message Rendering
- Consecutive assistant messages are **grouped** into a single agent block (no repeated headers)
- "Thought for Xs" label shows time between user prompt and first agent response
- `result` messages stored with empty content (metadata only: cost, duration, turns) to avoid duplicating the last assistant text
- Tool use/result blocks rendered inline within the agent group
- Text blocks with markdown headings (≥200 chars) auto-render in collapsible `MarkdownBlock` cards

### Plan Mode Rendering
When the user sends a prompt in **Plan** mode, the response renders in a special `PlanBlock` inline card:
1. `use-agent-socket.ts` marks the chat as a plan chat and accumulates text blocks into `usePlanStore`
2. Plan content is extracted from the first `#` heading onward (conversational preamble stays as regular text)
3. Plan card shows: filename (slug + timestamp `.md`), READY badge on completion, rendered markdown body, and a **Build** button
4. Clicking **Build** sends the plan as a prompt in `agent` mode via `sendSilentPrompt` (adds a hidden user message for group separation, hidden by `UserBubble` via `BUILD_PROMPT_PREFIX` detection)
5. Build execution renders normally (tool cards, text, `MarkdownBlock` for summaries) — separate from the plan card
6. After Build, the button grays out and shows "Built" (detected by checking for `BUILD_PROMPT_PREFIX` in user messages)
7. After page refresh, plans reconstruct from message content: `AgentGroup` scans text blocks for headings, and the build-prompt message proves plan-mode history

## Terminal UI
- Bottom resizable panel (VS Code style) with drag handle
- Tab bar with terminal names + "+" to create, "x" to close
- Each tab renders an xterm.js `Terminal` with Tokyo Night theme
- `FitAddon` + `ResizeObserver` for automatic sizing
- `XtermRegistry` class buffers events that arrive before xterm mounts (race condition fix)
- Panel toggle bar always visible; panel hidden by default
- Zustand store (`useTerminalStore`) tracks terminals, active tab, panel open/closed state

## File Editor (Monaco)
The central panel toggles between `AgentChat` and `CodeViewer` based on `useEditorStore.activeView`.

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

**Right side**: `SandboxStatus` indicator + "VS Code" browser IDE button.

- **Branch resolution**: Primary source is `useGitStore.branch` (updated every 5s from `git_status` polling, never resets mid-session). Falls back to `useProjectInfoSocket` (polls `project_info` every 10s) and `project.gitRepo`.
- **Branch management**: `listBranches`, `createBranch`, `checkout` actions in `useGitSocket` emit `git_branches` / `git_create_branch` / `git_checkout` events to the gateway.
- Component: `ProjectStatusBar` + `BranchPicker` rendered at the very bottom of `AppShell`

## Layout Persistence
Layout state (terminal panel, sidebars, active chat, editor tabs) is stored in two places:

1. **Server-side** (sandbox filesystem `~/.apex-layout.json`) — persists across machines and browser sessions.
2. **Client-side** (`localStorage` key `apex-layout:{projectId}`) — instant restore on page refresh even when the sandbox is unavailable.

- **Save**: Any Zustand store change (terminals, chats, panels, editor) → `useLayoutSocket` debounces (500ms) → Socket.io `layout_save` to server + immediate `localStorage` write.
- **Load**: On mount, `localStorage` data is applied instantly (no blank UI). Then `layout_load` is emitted to the server. If the server responds with `layout_data`, it overrides the local backup (server is source of truth). If the server times out (3s), the `localStorage` layout is already active.
- The `LayoutData` shape: `{ terminalPanelOpen, terminalPanelHeight, activeTerminalId, activeChatId, leftSidebarOpen, rightSidebarOpen, chatScrollOffsets, openFiles, activeFilePath, activeView, fileScrollOffsets }`

## Project Navigation & Store Reset
When switching projects, all project-specific Zustand stores must be reset to avoid stale content from the previous project leaking into the new one.

- **`resetProjectStores()`** (`lib/reset-project-stores.ts`) clears: terminal, chats, editor, file tree, ports, and panels stores.
- Called on **`HomePage` mount** — when the user navigates back to the projects list, stale state from the previous project is wiped.
- NOT called in `openProject()` or `ProjectPage` mount — those open new windows (Electron) or tabs (browser) with naturally fresh stores.

## Key Files
```
apps/api/src/modules/agent/agent.gateway.ts    – Socket.io gateway, bridges dashboard↔sandbox + local PTY fallback
apps/api/src/modules/tasks/tasks.service.ts     – ChatsService (CRUD for chats + messages)
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
apps/dashboard/src/stores/tasks-store.ts        – Zustand store (useChatsStore)
apps/dashboard/src/stores/terminal-store.ts     – Zustand store (useTerminalStore)
apps/dashboard/src/stores/editor-store.ts        – Zustand store (useEditorStore) — open files, dirty tracking, code selections
apps/dashboard/src/stores/file-tree-store.ts     – Zustand store (useFileTreeStore) — directory cache, root path
apps/dashboard/src/stores/plan-store.ts          – Zustand store (usePlanStore) — plan mode state + content extraction
apps/dashboard/src/stores/agent-settings-store.ts – Zustand store — agent mode/model selection
apps/dashboard/src/components/agent/agent-chat.tsx – Main chat panel
apps/dashboard/src/components/agent/message-bubble.tsx – Message grouping + rendering (plan detection, markdown blocks)
apps/dashboard/src/components/agent/plan-block.tsx     – Inline plan card (markdown + Build button)
apps/dashboard/src/components/agent/markdown-block.tsx  – Inline collapsible markdown card (summaries)
apps/dashboard/src/components/editor/code-viewer.tsx      – Monaco-based file editor (syntax highlighting, save, snippet copy)
apps/dashboard/src/components/editor/apex-theme.ts        – Custom Monaco dark theme
apps/dashboard/src/components/editor/lang-map.ts          – File extension → Monaco language ID mapping
apps/dashboard/src/components/terminal/terminal-panel.tsx  – Resizable bottom panel with tabs
apps/dashboard/src/components/terminal/terminal-tab.tsx    – Single xterm.js terminal renderer
apps/dashboard/src/components/terminal/terminal-tabs.tsx   – Tab bar (names, +, x)
apps/dashboard/src/hooks/use-file-tree-socket.ts          – Socket.io hook for file explorer (list, CRUD, read, write)
apps/dashboard/src/components/layout/project-status-bar.tsx – Bottom status bar (project name, git branch picker, sync status)
apps/dashboard/src/components/layout/branch-picker.tsx     – Branch picker dropdown (create/checkout/list branches)
```
