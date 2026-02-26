# Dashboard Frontend — Layout & Component Reference

> **Package**: `@apex/dashboard` · **Path**: `apps/dashboard/`
> **Stack**: React 19, Vite, Tailwind CSS v4, Zustand, Socket.io, xterm.js, Monaco Editor
> **Dev server**: `http://localhost:4200` — proxies `/api` and `/ws` to the API at `localhost:6000`

---

## 1. Directory Structure

```
apps/dashboard/src/
├── main.tsx                        # ReactDOM entry point (StrictMode)
├── styles.css                      # Tailwind import + custom design tokens
├── app/
│   └── app.tsx                     # BrowserRouter with route definitions
├── api/
│   └── client.ts                   # REST API client (fetch wrapper)
├── pages/
│   ├── home-page.tsx               # "/" — project listing
│   └── project-page.tsx            # "/projects/:projectId" — workspace view
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx           # Top-level page shell (top-bar + left-sidebar + main + right-sidebar + terminal + status bar)
│   │   ├── top-bar.tsx             # Thin top bar with toggle icons for left sidebar, terminal panel, right sidebar
│   │   ├── left-sidebar.tsx        # Left sidebar wrapper — combines ActivityBar + SidePanel
│   │   ├── activity-bar.tsx        # Narrow icon strip (leftmost) — category selector (explorer, git, search, settings)
│   │   ├── side-panel.tsx          # Wider panel showing content for the active activity category
│   │   ├── sidebar.tsx             # Right sidebar — chat list, search, new-chat button
│   │   ├── sandbox-status.tsx      # Inline status indicator (creating/running/stopped/error)
│   │   ├── project-status-bar.tsx  # Bottom status bar (project name, git branch picker, sync status, sandbox status, VS Code button)
│   │   └── branch-picker.tsx      # Branch picker dropdown (create/checkout/list branches)
│   ├── agent/
│   │   ├── agent-chat.tsx          # Main chat area (header, message list, prompt input, welcome screen)
│   │   ├── message-bubble.tsx      # Message grouping + rendering (user / agent / result / system bubbles)
│   │   ├── plan-block.tsx          # Collapsible inline card for plan-mode responses (markdown + Build button)
│   │   ├── markdown-block.tsx      # Collapsible inline card for structured markdown (task overviews, summaries)
│   │   ├── chat-actions-context.ts # React context for chat actions (sendPrompt, sendSilentPrompt, sendUserAnswer)
│   │   └── prompt-input.tsx        # Reusable textarea + send-button form
│   ├── projects/
│   │   ├── project-list.tsx        # Card grid of projects with create/open/delete actions
│   │   └── create-project-dialog.tsx # Modal form for creating a new project
│   ├── editor/
│   │   ├── code-viewer.tsx         # Monaco-based file editor (syntax highlighting, save, snippet copy)
│   │   ├── apex-theme.ts           # Custom Monaco dark theme matching app design tokens
│   │   └── lang-map.ts             # Maps file extensions / filenames to Monaco language IDs
│   └── terminal/
│       ├── terminal-panel.tsx      # Resizable terminal panel with drag handle & auto-create logic
│       ├── terminal-tabs.tsx       # Tab bar for switching / creating / closing terminals
│       └── terminal-tab.tsx        # Single xterm.js instance (mount, fit, resize, theme)
├── hooks/
│   ├── use-agent-socket.ts         # Socket.io connection to /ws/agent — agent messages & status
│   ├── use-terminal-socket.ts      # Terminal CRUD & I/O over the shared socket
│   ├── use-layout-socket.ts        # Persist/restore UI layout via socket + localStorage fallback
│   ├── use-project-info-socket.ts  # Poll sandbox for project metadata (git branch, project dir)
│   ├── use-file-tree-socket.ts     # File explorer: listing, CRUD, read, write via socket
│   ├── use-search-socket.ts        # Grep-based file search via socket
│   ├── use-git-socket.ts           # Git operations (status, stage, commit, push/pull, branches, checkout)
│   └── use-ports-socket.ts         # Port scanning & preview URL requests
├── stores/
│   ├── projects-store.ts           # Zustand store — project CRUD
│   ├── tasks-store.ts              # Zustand store — chats, messages, active chat
│   ├── terminal-store.ts           # Zustand store — terminal list, panel visibility, height
│   ├── panels-store.ts             # Zustand store — left/right sidebar visibility toggles
│   ├── editor-store.ts             # Zustand store — open files, active file, dirty tracking, code selections
│   ├── file-tree-store.ts          # Zustand store — directory cache for the file explorer
│   ├── command-store.ts            # Zustand store — command registry, keybindings, palette state
│   ├── plan-store.ts               # Zustand store — plan mode state (plan text accumulation, completion)
│   ├── agent-settings-store.ts     # Zustand store — agent mode (agent/plan/ask) and model selection
│   ├── ports-store.ts              # Zustand store — forwarded ports list from sandbox port scanning
│   └── git-store.ts                # Zustand store — git status, branches, optimistic staging/unstaging
└── lib/
    ├── cn.ts                       # clsx + tailwind-merge helper
    ├── open-project.ts             # Opens project in new window (Electron) or tab (browser)
    └── reset-project-stores.ts     # Centralized reset of all project-specific Zustand stores
```

---

## 2. Routing

| Path                     | Page            | Description                                  |
| ------------------------ | --------------- | -------------------------------------------- |
| `/`                      | `HomePage`      | Lists all projects; each opens in a new tab  |
| `/projects/:projectId`   | `ProjectPage`   | Full workspace view for a single project     |

Routing is handled by **React Router v6** (`BrowserRouter` → `Routes` → `Route`).

---

## 3. Page Layouts

### 3.1 Home Page (`/`)

```
┌──────────────────────────────────────────────┐
│                                              │
│   ProjectList                                │
│   ┌────────────────────────────────────────┐ │
│   │  "Projects" heading  +  [New Project]  │ │
│   ├────────────────────────────────────────┤ │
│   │  ProjectCard  (name, status, actions)  │ │
│   │  ProjectCard                           │ │
│   │  …                                     │ │
│   └────────────────────────────────────────┘ │
│                                              │
└──────────────────────────────────────────────┘
```

- Wrapped in `AppShell` (no sidebar, no terminal panel, no status bar).
- No header — the page goes straight to content.
- `onOpenProject` calls `openProject()` (`lib/open-project.ts`) which opens a new Electron window via IPC or a new browser tab via `window.open`.
- Empty state: folder icon + "No projects yet" message.
- "New Project" button opens `CreateProjectDialog` (modal).

### 3.2 Project Page (`/projects/:projectId`)

```
┌─[◧]──────────────────────────────────────────────[⬓][◨]─┐
├────┬──────────┬──────────────────────────────────┬────────┤
│    │          │                                  │        │
│ A  │  Side    │  AgentChat or CodeViewer          │  Chat  │
│ c  │  Panel   │  ┌────────────────────────────┐  │  Side  │
│ t  │          │  │ Chat header / File tab bar  │  │  bar   │
│ i  │ (content │  ├────────────────────────────┤  │        │
│ v  │  for the │  │ Message list / Monaco      │  │──────  │
│ i  │  active  │  │ editor (syntax highlight,  │  │ Search │
│ t  │  cate-   │  │  line numbers, save)       │  │──────  │
│ y  │  gory)   │  ├────────────────────────────┤  │  +New  │
│    │          │  │ PromptInput                │  │──────  │
│ B  │ Explorer │  └────────────────────────────┘  │  chat  │
│ a  │ Git      ├──────────────────────────────────│  list  │
│ r  │ Search   │  TerminalPanel (drag-resizable)  │  with  │
│    │ Settings │  ┌────────────────────────────┐  │  status│
│ ■  │          │  │ TerminalTabs               │  │  dots  │
│ ■  │          │  ├────────────────────────────┤  │        │
│ ■  │          │  │ TerminalTab (xterm.js)     │  │        │
│ ⚙  │          │  └────────────────────────────┘  │        │
├────┴──────────┴──────────────────────────────────┴────────┤
│  StatusBar  (name · git branch  │  ● Running · VS Code ↗)│
└───────────────────────────────────────────────────────────┘
```

- **Top bar** (32px): thin strip with toggle icons — left sidebar (◧), terminal panel (⬓), right sidebar (◨). Left toggle on the left edge, bottom + right toggles on the right edge.
- **Left sidebar** (VS Code–style): narrow `ActivityBar` (48px icons) + wider `SidePanel` (240px content). Toggled via top bar or `usePanelsStore`.
- **Right sidebar**: chat list (288px). Toggled via top bar or `usePanelsStore`.
- **Terminal panel**: toggled via top bar or `useTerminalStore.togglePanel`.
- Full `AppShell` with all slots: `leftSidebar`, `sidebar`, `terminalPanel`, `statusBar`, `children`.
- The **status bar** combines project info (left) with sandbox status + VS Code button (right).
- While layout or terminals are restoring, a **full-screen loading overlay** is shown.
- **Central panel** switches between `AgentChat` (default) and `CodeViewer` based on `useEditorStore.activeView`. Clicking a file in the explorer opens it in the Monaco editor; the chat button returns to the chat view.
- Welcome/empty state: large prompt box with suggestion chips (if no chats exist).

---

## 4. Component Details

### 4.1 Layout Components (`components/layout/`)

| Component            | Purpose |
| -------------------- | ------- |
| **AppShell**         | Top-level flex layout: vertical `h-screen` with `TopBar`, then horizontal flex of optional `leftSidebar` + content area (main + optional `terminalPanel`) + optional right `sidebar`, optional `statusBar` at bottom. Reads `usePanelsStore` to conditionally show/hide left and right sidebars. |
| **TopBar**           | 32px thin header bar. **Left**: toggle icon for the left sidebar (PanelLeft). **Right**: toggle icons for terminal panel (PanelBottom) and right sidebar (PanelRight). Icons dim when the panel is closed. Uses `usePanelsStore` for sidebars and `useTerminalStore` for the terminal panel. |
| **LeftSidebar**      | Wrapper that composes `ActivityBar` + `SidePanel` side by side. Owns the `active` category state. |
| **ActivityBar**      | 48px (`w-12`) narrow dark strip on the far left. Top-aligned icons: Explorer, Git, Search. Bottom-aligned: Settings. Active item has a left accent bar + highlighted background. |
| **SidePanel**        | 240px (`w-60`) panel next to the activity bar. Displays content for the active category (Explorer, Source Control, Search, Settings). Currently placeholder panels. |
| **Sidebar**          | 288px (`w-72`) dark sidebar on the **right**. Contains a search input, "New Chat" button, and scrollable chat list. Each chat item shows a `MessageSquare` icon, truncated title, and a `StatusDot` (color-coded: yellow = running, green = completed, red = error, gray = idle). |
| **SandboxStatus**    | Compact inline indicator. States: **creating** (spinner + yellow), **running** (pulsing green dot), **stopped** (gray dot), **error** (red dot). Tooltip shows the sandbox ID. |
| **ProjectStatusBar** | 28px footer bar. **Left**: project name, clickable git branch button (opens `BranchPicker` dropdown), sync status button (refresh icon + ↓N ↑M ahead/behind counts). **Right**: `SandboxStatus` indicator + "VS Code" button (opens browser IDE via API, disabled when sandbox isn't ready). Branch name reads from `useGitStore.branch` (stable) with fallbacks to `info.gitBranch` and `project.gitRepo`. |
| **BranchPicker**     | Dropdown positioned above status bar. Top section: command items (Create new branch, Create new branch from, Checkout detached) that switch to inline input fields. Separator. Bottom section: scrollable branch list (max 10 visible, `max-h-[320px]`) sorted by last used timestamp. Current branch marked with green checkmark. Fetches fresh branch list on open via `gitActions.listBranches()`. |

### 4.2 Agent / Chat Components (`components/agent/`)

| Component            | Purpose |
| -------------------- | ------- |
| **AgentChat**        | Orchestrates the chat view. Three states: **(1)** No active chat & not composing → `WelcomePrompt` (centered hero with sparkle icon, textarea, suggestion chips). **(2)** Composing new → minimal prompt UI. **(3)** Active chat → header + scrollable message list + `PromptInput`. Input is disabled while chat status is `running`. Provides `ChatActionsContext` with `sendPrompt`, `sendSilentPrompt`, `sendUserAnswer`. |
| **MessageBubble**    | Message grouping logic (`groupMessages`) + rendering. Groups flat messages into: **user** (single message), **agent** (consecutive assistant messages merged, with thinking-time indicator), **result** (metadata-only: cost, duration, turns), **system** (errors/info). `AgentGroup` detects plan-mode chats and renders `PlanBlock` instead of raw text. `UserBubble` hides build-prompt messages. |
| **ContentBlockView** | Renders individual content blocks: `text` → `MarkdownBlock` card if the text has headings and is ≥200 chars, otherwise preformatted text with URL linking. `tool_use` → `ToolUseBlock` card. `tool_result` → bordered card with scrollable output. |
| **PlanBlock**        | Collapsible inline card for plan-mode responses. Header with filename (slug + timestamp, e.g. `todo-app-plan_20260224T0700.md`), spinner/READY badge. Body renders markdown via `react-markdown` + `remark-gfm`. Footer has collapse toggle + **Build** button (sends plan to agent in `agent` mode via `sendSilentPrompt`). Build button states: active → building (spinner) → built (grayed checkmark). |
| **MarkdownBlock**    | Collapsible inline card for structured text (task summaries, overviews). Same markdown rendering as PlanBlock but no Build button. Used automatically for text blocks with headings. |
| **PromptInput**      | Reusable form: auto-sizing textarea + purple send button. Submit on Enter (Shift+Enter for newline). Supports `disabled` and `autoFocus` props. |

### 4.3 Project Components (`components/projects/`)

| Component                | Purpose |
| ------------------------ | ------- |
| **ProjectList**          | Centered card list (max-width 768px). Fetches projects on mount via `useProjectsStore`. Shows loading spinner, empty state, or grid of `ProjectCard`s. "New Project" button toggles `CreateProjectDialog`. |
| **ProjectCard**          | Bordered card displaying: project name, color-coded status badge, description, agent type label ("Claude Code" or "OpenCode"), creation date, open (external link) and delete (with confirm) buttons. |
| **CreateProjectDialog**  | Modal overlay (`fixed inset-0 z-50`). Form fields: **Name** (required), **Description**, **Git Repository** (optional, cloned on create), **Agent** (select: Claude Code / OpenCode). Cancel + Create buttons. |

### 4.4 Editor Components (`components/editor/`)

| Component         | Purpose |
| ----------------- | ------- |
| **CodeViewer**    | Full-featured file editor powered by `@monaco-editor/react`. Renders a tab bar (file name + dirty indicator dot) and the Monaco editor below. Theme: custom "apex-dark" (defined in `apex-theme.ts`). Language detection via `getLanguageFromPath()`. Registers two Monaco actions: **Ctrl/Cmd+C** (copy with `CodeSelection` metadata for snippet references), **Ctrl/Cmd+S** (save file via `onSave` prop → socket `file_write`). Tracks unsaved changes in `useEditorStore.dirtyFiles`. |
| **apex-theme.ts** | `IStandaloneThemeData` for Monaco. `vs-dark` base with custom colors matching the app's dark palette (`#1e2132` editor background, `#6366f1` cursor/selection). |
| **lang-map.ts**   | `getLanguageFromPath(filePath)` — maps file extensions (`.ts`, `.py`, `.go`, etc.) and special filenames (`Dockerfile`, `Makefile`, `.env`) to Monaco language IDs. Falls back to `plaintext`. |

### 4.5 Terminal Components (`components/terminal/`)

| Component           | Purpose |
| ------------------- | ------- |
| **TerminalPanel**   | Resizable panel at the bottom of the content area. Features: drag-to-resize handle (min 120px), collapse/expand toggle, auto-creates a default shell terminal on project open (waits for `terminalsLoaded`). When collapsed, shows a thin "Terminal" bar. |
| **TerminalTabs**    | Horizontal tab strip. Each tab shows terminal icon + name + close button (visible on hover). "+" button to create a new terminal. |
| **TerminalTab**     | Wraps a single **xterm.js** `Terminal` instance. Uses `FitAddon` for auto-sizing. Tokyo Night color theme. Forwards keystrokes to server via `onInput`. Uses `ResizeObserver` to re-fit on container size changes. Hidden tabs use `display: none` to preserve scrollback. |

---

## 5. State Management (Zustand Stores)

### 5.1 `useProjectsStore` (`stores/projects-store.ts`)

| Field / Action     | Type / Description |
| ------------------ | ------------------ |
| `projects`         | `Project[]` — all projects for the current user |
| `loading`          | `boolean` |
| `error`            | `string \| null` |
| `fetchProjects()`  | GET `/api/projects` |
| `createProject(…)` | POST `/api/projects` — prepends to list |
| `deleteProject(id)`| DELETE `/api/projects/:id` — removes from list |

### 5.2 `useChatsStore` (`stores/tasks-store.ts`)

| Field / Action          | Type / Description |
| ----------------------- | ------------------ |
| `chats`                 | `Chat[]` — chats for the active project |
| `activeChatId`          | `string \| null` |
| `composingNew`          | `boolean` — true when "New Chat" is clicked |
| `messages`              | `Message[]` — messages for the active chat |
| `searchQuery`           | `string` — sidebar search filter |
| `fetchChats(projectId)` | GET `/api/projects/:id/chats` |
| `setActiveChat(chatId)` | Fetches messages, sets active |
| `startNewChat()`        | Clears active, enters compose mode |
| `createChat(…)`         | POST `/api/projects/:id/chats` |
| `addMessage(msg)`       | Appends message (if for active chat) |
| `updateChatStatus(…)`   | Updates a chat's status in the list |
| `deleteChat(id)`        | DELETE `/api/chats/:id` |
| `reset()`               | Clears all state (called by `resetProjectStores()` on HomePage mount) |

### 5.3 `useTerminalStore` (`stores/terminal-store.ts`)

| Field / Action              | Type / Description |
| --------------------------- | ------------------ |
| `terminals`                 | `TerminalInfo[]` — `{ id, name, status }` |
| `activeTerminalId`          | `string \| null` |
| `panelOpen`                 | `boolean` |
| `panelHeight`               | `number` (default 300px) |
| `terminalsLoaded`           | `boolean` — true after first `terminal_list` response |
| `addTerminal(info, opts?)`  | Adds terminal, auto-activates, optionally opens panel |
| `removeTerminal(id)`        | Removes terminal, selects fallback, closes panel if empty |
| `setTerminals(list)`        | Bulk-replace (on reconnect / `terminal_list` event) |
| `applyLayout(layout)`       | Restores saved panel/height/active-terminal state |
| `reset()`                   | Clears all state (called by `resetProjectStores()` on HomePage mount) |

### 5.4 `usePlanStore` (`stores/plan-store.ts`)

| Field / Action           | Type / Description |
| ------------------------ | ------------------ |
| `plans`                  | `Plan[]` — `{ id, chatId, title, filename, content, isComplete, createdAt }` |
| `planChatIds`            | `Set<string>` — chats that were started in plan mode |
| `markChatAsPlan(chatId)` | Flags a chat as plan-mode (called when sending with `mode='plan'`) |
| `isChatPlan(chatId)`     | Returns true if the chat was started in plan mode |
| `createPlan(chatId, rawContent)` | Extracts plan body from first heading onward, generates slug+timestamp filename. Returns `null` if no heading found yet. |
| `updatePlanContent(planId, rawContent)` | Updates plan content (re-extracts from heading). No-op if no heading found. |
| `completePlan(planId)`   | Marks plan as complete (enables Build button) |
| `getPlanByChatId(chatId)` | Lookup by chat ID |

**Content-based detection**: After page refresh the plan store is empty (in-memory only). `AgentGroup` derives plans from message content by scanning for markdown headings. The build-prompt message (`BUILD_PROMPT_PREFIX`) in user messages serves as proof that a chat was in plan mode, enabling plan card rendering from history.

### 5.5 `useAgentSettingsStore` (`stores/agent-settings-store.ts`)

| Field / Action   | Type / Description |
| ---------------- | ------------------ |
| `mode`           | `AgentMode` — `'agent' \| 'plan' \| 'ask'` (default `'agent'`) |
| `model`          | `AgentModel` — `'sonnet' \| 'opus' \| 'haiku'` (default `'sonnet'`) |
| `setMode(mode)`  | Change agent mode |
| `setModel(model)` | Change agent model |

### 5.6 `usePanelsStore` (`stores/panels-store.ts`)

| Field / Action              | Type / Description |
| --------------------------- | ------------------ |
| `leftSidebarOpen`           | `boolean` (default `false`) |
| `rightSidebarOpen`          | `boolean` (default `false`) |
| `activeCategory`            | `ActivityCategory` (default `'explorer'`) |
| `toggleLeftSidebar()`       | Toggles left sidebar visibility |
| `toggleRightSidebar()`      | Toggles right sidebar visibility |
| `setLeftSidebar(open)`      | Explicitly set left sidebar open/closed |
| `setRightSidebar(open)`     | Explicitly set right sidebar open/closed |
| `setActiveCategory(cat)`    | Change the active activity bar category |
| `openPanel(category)`       | Opens left sidebar and selects a category |
| `reset()`                   | Closes sidebars, resets category (called by `resetProjectStores()`) |

### 5.7 `useGitStore` (`stores/git-store.ts`)

| Field / Action              | Type / Description |
| --------------------------- | ------------------ |
| `branch`                    | `string \| null` — current branch name (from `git_status` polling) |
| `staged`                    | `GitFileEntry[]` — staged files |
| `unstaged`                  | `GitFileEntry[]` — unstaged tracked changes |
| `untracked`                 | `GitFileEntry[]` — untracked files |
| `conflicted`                | `GitFileEntry[]` — merge conflict files |
| `ahead`                     | `number` — commits ahead of remote |
| `behind`                    | `number` — commits behind remote |
| `branches`                  | `GitBranchEntry[]` — all branches (from `git_branches` request) |
| `loading`                   | `boolean` — true while a git operation is in flight |
| `commitMessage`             | `string` — commit message textarea value |
| `setStatus(data)`           | Updates branch, files, ahead/behind from server (suppressed during optimistic guard) |
| `setBranches(branches)`     | Replaces the branches array |
| `optimisticStage(paths)`    | Moves files to staged immediately (3s guard) |
| `optimisticUnstage(paths)`  | Moves files from staged immediately (3s guard) |
| `optimisticDiscard(paths)`  | Removes files from unstaged/untracked immediately (3s guard) |

### 5.8 `useEditorStore` (`stores/editor-store.ts`)

| Field / Action                | Type / Description |
| ----------------------------- | ------------------ |
| `openFiles`                   | `OpenFile[]` — `{ path, name }` ordered tab list |
| `activeFilePath`              | `string \| null` — currently viewed file |
| `fileContents`                | `Record<string, string>` — cached file content keyed by path |
| `fileScrollOffsets`           | `Record<string, number>` — scroll positions per file |
| `activeView`                  | `'chat' \| 'editor'` (default `'chat'`) — switches central panel |
| `codeSelection`               | `CodeSelection \| null` — last copied code snippet metadata |
| `dirtyFiles`                  | `Set<string>` — files with unsaved changes |
| `openFile(path, name)`        | Adds file to tabs (if not already open), activates it, switches to `editor` view |
| `closeFile(path)`             | Removes tab, falls back to previous tab or switches to `chat` view |
| `setFileContent(path, content)` | Updates cached content |
| `markDirty(path)`             | Marks file as having unsaved changes (shown as dot in tab) |
| `markClean(path)`             | Clears dirty flag (called on successful `file_write_result`) |
| `showChat()`                  | Switches `activeView` to `'chat'` |
| `applyLayout(data)`           | Restores open files, active file, and view from saved layout |
| `reset()`                     | Clears all editor state |

### 5.9 `useFileTreeStore` (`stores/file-tree-store.ts`)

| Field / Action                | Type / Description |
| ----------------------------- | ------------------ |
| `cache`                       | `Record<string, FileEntry[]>` — directory listings keyed by path |
| `rootPath`                    | `string \| null` — project root directory (set from `project_info`) |
| `changedDirs`                 | `string[]` — dirs invalidated by file watchers (consumed by tree component) |
| `setRootPath(path)`           | Sets the project root (triggers initial listing) |
| `setEntries(dirPath, entries)` | Caches directory listing, marks dir as changed if entries differ |
| `getAllCachedFiles()`         | Returns all non-directory entries across all cached dirs |
| `invalidate(dirPath)`        | Removes a dir from cache (forces re-fetch on next expand) |
| `reset()`                    | Clears all cache and root path |

---

## 6. Real-Time Communication (Socket.io Hooks)

All hooks share **one Socket.io connection** created by `useAgentSocket` (namespace `/ws/agent`, path `/ws/socket.io`, WebSocket transport only).

### 6.1 `useAgentSocket`

- **Emits**: `subscribe_project`, `send_prompt`, `execute_chat`
- **Listens**: `subscribed`, `prompt_accepted`, `agent_message` (assistant turns & result summaries), `agent_status`, `agent_error`
- Pushes received messages into `useChatsStore` and updates chat statuses.

### 6.2 `useTerminalSocket`

- **Emits**: `terminal_create`, `terminal_input`, `terminal_resize`, `terminal_close`, `terminal_list`
- **Listens**: `terminal_created`, `terminal_output`, `terminal_exit`, `terminal_error`, `terminal_list`
- Uses an internal **`XtermRegistry`** class that buffers output events arriving before the xterm.js instance is mounted, and replays them on register. Supports scrollback restore on reconnect.

### 6.3 `useLayoutSocket`

- **Emits**: `layout_load`, `layout_save`
- **Listens**: `layout_data`
- Persists & restores: terminal panel open/height, active terminal ID, active chat ID, sidebar open states, editor tabs, scroll offsets.
- **Dual persistence**: every save writes to both `localStorage` (immediate, keyed `apex-layout:{projectId}`) and the server (debounced 500ms via socket).
- **Load order**: `localStorage` is applied instantly on mount (zero-delay restore). Then `layout_load` is emitted to the server. Server response overrides local data. If the server times out (3s), the `localStorage` layout is already active.
- Auto-saves whenever relevant store state changes (terminals, chats, panels, editor).

### 6.4 `useProjectInfoSocket`

- **Emits**: `project_info` (polled every 10s)
- **Listens**: `project_info`
- Returns `{ gitBranch: string | null, projectDir: string | null }`. `projectDir` is used by `useFileTreeStore.setRootPath()` to initialize the file explorer.

### 6.5 `useFileTreeSocket`

- **Emits**: `file_list`, `file_create`, `file_rename`, `file_delete`, `file_move`, `file_read`, `file_write`
- **Listens**: `file_list_result`, `file_op_result`, `file_changed`, `file_read_result`, `file_write_result`
- Returns `FileTreeActions`: `requestListing`, `createFile`, `renameFile`, `deleteFile`, `moveFile`, `readFile`, `writeFile`
- `file_read_result` pushes content into `useEditorStore.setFileContent()`. `file_write_result` calls `markClean()` on success.
- `file_changed` events (from sandbox file watcher) invalidate affected directories and re-fetch listings.

### 6.6 `useGitSocket`

- **Emits**: `git_status` (polled every 5s), `git_stage`, `git_unstage`, `git_discard`, `git_commit`, `git_push`, `git_pull`, `git_branches`, `git_create_branch`, `git_checkout`
- **Listens**: `git_status_result`, `git_op_result`, `git_branches_result`
- Returns `GitActions`: `requestStatus`, `stage`, `unstage`, `discard`, `commit`, `push`, `pull`, `listBranches`, `createBranch`, `checkout`
- Updates `useGitStore` with status data, branch list, and loading state.

---

## 7. API Client (`api/client.ts`)

Thin `fetch` wrapper over `/api`. All requests send `Content-Type: application/json`.

| Namespace       | Endpoints |
| --------------- | --------- |
| `usersApi`      | `GET /users/me` |
| `projectsApi`   | `GET /projects`, `GET /projects/:id`, `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id`, `GET /projects/:id/vscode-url` |
| `chatsApi`      | `GET /projects/:id/chats(?search=)`, `GET /chats/:id`, `POST /projects/:id/chats`, `GET /chats/:id/messages`, `DELETE /chats/:id` |

### Key TypeScript Types

- **`Project`** — `id, userId, name, description, sandboxId, sandboxSnapshot, status, agentType, gitRepo, agentConfig, createdAt, updatedAt`
- **`Chat`** — `id, projectId, title, status, createdAt, updatedAt, messages?`
- **`Message`** — `id, taskId, role, content: ContentBlock[], metadata, createdAt`
- **`ContentBlock`** — `type` (`text` | `tool_use` | `tool_result`), plus type-specific fields (`text`, `name`, `input`, `content`, `tool_use_id`)

---

## 8. Design Tokens, Styling & Themes

### Color Themes

The app supports three color themes, selectable via the Settings panel, command palette, or `useThemeStore`:

| Theme ID         | Label          | Description |
| ---------------- | -------------- | ----------- |
| `midnight-blue`  | Midnight Blue  | Default dark theme with deep blue tones (Tokyo Night terminal) |
| `dark`           | Dark           | VS Code Dark+ inspired neutral dark theme |
| `light`          | Light          | VS Code Light+ inspired light theme |

**Key files:**
- `stores/theme-store.ts` — Zustand store: `themeId`, `setTheme(id)`, `cycleTheme()`. Persists to `localStorage` key `apex-theme`.
- `lib/themes.ts` — Theme registry: CSS token values, Monaco `IStandaloneThemeData`, xterm `ITheme` per theme.
- `styles.css` — CSS custom properties per `[data-theme]` attribute on `<html>`.

**How it works:** `styles.css` defines intermediate `--t-*` CSS custom properties that the Tailwind `@theme` block references. Theme switching sets a `data-theme` attribute on `<html>`, which overrides the `--t-*` properties. This makes all Tailwind utility classes (e.g. `bg-surface`, `text-text-primary`) theme-aware automatically. Monaco editor and xterm terminal themes are switched independently via their respective APIs in `code-viewer.tsx` and `terminal-tab.tsx`.

**Adding a new theme:** Add the theme definition to `lib/themes.ts` (CSS tokens, Monaco colors, terminal colors), add the CSS variable overrides in `styles.css` under `[data-theme="your-id"]`, and add the `ThemeId` union member.

### Design Tokens

Tailwind CSS v4 with custom tokens defined in `styles.css`. Values shown are for the default Midnight Blue theme:

| Token                        | Default Value | Usage |
| ---------------------------- | ------------- | ----- |
| `--color-sidebar`            | `#111827`     | Sidebar background |
| `--color-sidebar-hover`      | `#1f2937`     | Sidebar item hover |
| `--color-sidebar-active`     | `#374151`     | Active sidebar item |
| `--color-activity-bar`       | `#0a0f1a`     | Activity bar (stays dark in all themes) |
| `--color-surface`            | `#1e2132`     | Main content background |
| `--color-surface-secondary`  | `#171a2a`     | Secondary areas, code blocks |
| `--color-surface-chat`       | `#242840`     | Chat message background |
| `--color-border`             | `#2e3348`     | Borders |
| `--color-primary`            | `#6366f1`     | Indigo — buttons, focus rings, accents |
| `--color-primary-hover`      | `#4f46e5`     | Darker indigo on hover |
| `--color-accent`             | `#10b981`     | Emerald — agent icon, "running" status |
| `--color-danger`             | `#ef4444`     | Red — errors, delete actions |
| `--color-text-primary`       | `#e2e4eb`     | Primary text |
| `--color-text-secondary`     | `#9ca3b4`     | Secondary text |
| `--color-text-muted`         | `#6b7280`     | Muted/placeholder text |
| `--color-panel-text`         | `#e2e4eb`     | Sidebar/panel text |
| `--color-panel-text-muted`   | `#9ca3b4`     | Sidebar/panel secondary text |
| `--color-panel-icon`         | `#9ca3b4`     | Panel icons |
| `--color-panel-icon-active`  | `#e2e4eb`     | Active panel icons |
| `--color-panel-border`       | `rgba(…)`     | Panel internal borders |
| `--color-scrollbar-thumb`    | `#374151`     | Scrollbar thumb |
| `--color-terminal-bg`        | `#1a1b26`     | Terminal background |

**Important:** Use `text-panel-text`, `text-panel-icon`, `border-panel-border` etc. for sidebar/panel content instead of hardcoded `text-white` or `text-gray-*`. The activity bar stays dark across all themes, so it may use hardcoded gray classes.

Icon library: **Lucide React**.
Font: Inter (with system-ui fallback). Terminal font: JetBrains Mono / Fira Code / Cascadia Code.
