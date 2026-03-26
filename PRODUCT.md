# Apex — Agentic Development Environment

An agentic development environment and task manager that allows effortless multitasking across a large number of agentic coding tasks running in parallel. Each task runs in its own secure sandbox — cloud or local — while you oversee, steer, and interact with them all from a single interface. Two clients, one infrastructure: a full IDE for interactive development, and a CLI that makes remote agents feel local.

---

## Apex IDE

A next-generation, agent-centric IDE optimized for managing parallel agent sessions without compromising the developer experience. Available as a desktop app and web interface.

### Project List (Home)

The home page serves as a project dashboard with inline thread management:

- **Project cards** — each project shows name, status badge, description, repo info (owner/repo link with issue/PR context when available), agent type, creation date, and a collapsible thread list
- **Inline thread list** — per-project collapsible section showing all threads with status icons (running/waiting/completed/error), agent type badges, ID prefix, title, and timestamps
- **Thread preview panel** — clicking any thread opens a 480px right panel with a full agent thread (prompt input, streamed responses, tool calls) — interact with agents without leaving the project list
- **Fork groups** — projects forked from the same parent are grouped together with expandable fork rows
- **GitHub auth indicator** — shows the connected GitHub user (avatar + login) in the header when a token is configured, or a "GitHub not connected" link to settings when no token is set
- **Quick access** — Secrets (shield icon) and Settings buttons in the header; "New Thread" button on each project card
- **New Project** dialog with sandbox provider selection (Daytona, Docker, Apple Container, Local), folder browser for local provider, git repo URL (supports GitHub issue, PR, branch, and commit URLs with auto-detection and smart project name generation from issue/PR titles), and description

### Workspace Layout

An agent-centric workspace that puts threads and agent interaction front and center, while maintaining a full IDE experience with resizable panels and familiar project-oriented structure:

- **Activity Bar** — narrow icon strip on the far left for switching between Explorer, Source Control, Search, and Settings
- **Side Panel** — wider content area next to the activity bar showing the active category (file tree, git status, search results, settings form)
- **Thread Panel** — central area where you interact with the AI agent, see streamed responses, and review tool calls and code edits
- **Editor Panel** — Monaco-based code editor with tabs, save, and dirty-state indicators; toggle between thread and editor views from the top bar
- **Terminal Panel** — resizable bottom panel with multiple terminal tabs, a ports tab, full PTY support, and Tokyo Night theme
- **Right Sidebar** — thread list with search, new thread button, and status indicators for each session
- **Status Bar** — project name, git branch picker, sync status, sandbox health indicator, port count, and IDE launcher button

### Agents

Three primary AI agents powered by OpenCode, selectable per-project or per-thread:

- **Build** — full autonomous coding agent with all tools enabled (default)
- **Plan** — read-only analysis and planning, produces plan documents
- **Sisyphus** — orchestration agent that breaks complex tasks into subtasks and delegates to specialized sub-agents

Each agent supports models from multiple providers (Anthropic, OpenAI, Google, OpenCode Zen free). The project-level default can be overridden on any individual thread via the agent dropdown in the prompt toolbar.

The default sandbox runtime bundles **oh-my-openagent**, an OpenCode plugin that extends all agents with a library of specialized sub-agents, composable skills, and workflow commands.

#### Task Delegation Agents

Sisyphus and Build can delegate work to category-based sub-agents, each tuned for a specific kind of task:

- **visual-engineering** — frontend, UI/UX, design, styling, and animation
- **ultrabrain** — complex logic-heavy tasks requiring deep reasoning
- **deep** — goal-oriented autonomous problem-solving for difficult issues
- **artistry** — creative problem-solving with unconventional approaches
- **quick** — simple tasks like single-file changes or typo fixes
- **writing** — documentation, prose, and technical writing

Additional direct sub-agents are available for targeted work: **explore** (codebase discovery), **librarian** (information retrieval), **oracle** (knowledge and best practices), **hephaestus** (building and creation), **metis** (strategic planning), **momus** (critical analysis), and **multimodal-looker** (visual analysis).

#### Skills

Agents can load specialized skills that provide domain-specific knowledge and tools:

- **playwright** — browser automation: navigate pages, fill forms, take screenshots, intercept network requests, execute JavaScript
- **frontend-ui-ux** — designer-turned-developer skill for creating visually polished interfaces with distinctive typography, color, and animation
- **git-master** — advanced git operations: atomic commit ordering, rebase surgery, history archaeology, automatic commit-style matching
- **dev-browser** — persistent browser automation with ARIA snapshots, screenshot capture, and network interception across script executions

Skills are composable — multiple skills can be loaded together when spawning sub-agents.

#### Workflow Commands

Agents support slash commands for workflow control: `/init-deep` (start a deep work session), `/ralph-loop` (continuous autonomous work mode), `/ulw-loop` (ultra-long work sessions), `/refactor`, `/handoff`, and more.

### AI Agent Thread

Send prompts and watch the agent work in real time:

- **Streamed responses** — every thought, tool call, code edit, and result from the agent appears live as it happens
- **Message grouping** — consecutive assistant messages are merged into coherent agent blocks with a "Thought for Xs" timing indicator
- **Stop button** — while the agent is running the Send button becomes a Stop button (same size, same position); click it to abort the current agent execution immediately
- **Prompt queue** — type and submit prompts while the agent is working; queued prompts appear above the input with Play (stop current and send this) and Delete buttons; when the agent finishes, the first queued prompt auto-sends
- **Thread stats bar** — live display of cost, tokens used, context window percentage, active MCP servers, and current model
- **Multiple concurrent threads** — run several agent sessions in the same sandbox, each with its own conversation context
- **Conversation context** — follow-up prompts include a summary of prior messages so the agent has full conversational awareness
- **AskUserQuestion flow** — when the agent needs input, a multiple-choice UI appears inline; select your answer and the agent continues (unified via MCP across all agents)
- **@ References** — type `@` in the prompt to open a category picker: **Files** (browse project files), **Issue** (attach GitHub issue context), or **PR** (attach pull request context). File/folder references insert as inline tags; issue/PR tags inject the full GitHub content (title, body, labels) into the prompt when submitted. When no GitHub context exists, `@` opens the file browser directly.
- **Code snippet references** — copy code from the editor and paste into the prompt to attach line-precise snippet references (coordinates only, no duplicated code)
- **Image attachments** — attach PNG, JPEG, GIF, or WebP images (up to 20 MB) via the toolbar button or paste; thumbnails appear in the prompt and images render in message bubbles
- **Markdown blocks** — long structured responses render in collapsible markdown cards
- **Suggestion chips** — empty-state welcome screen with quick-start prompt suggestions

### Plan Mode

When using the **Plan** agent, responses render in a dedicated plan format:

- **Plan cards** render in a collapsible inline card with a generated filename, markdown body, and a READY badge on completion
- **Build button** — one click sends the plan to the Build agent in execution mode, turning the design into working code
- **Persistent** — plan cards reconstruct from message history after page refresh

### Integrated Editor

A Monaco-based code editor built into the workspace:

- **Tabbed interface** — open multiple files with tab management, dirty-state dot indicators, and save support
- **Thread ↔ Editor toggle** — switch the center panel between the AI thread and the code editor from the top bar
- **Snippet copy** — copying code from the editor puts structured snippet data on the clipboard for pasting into prompts as precise references

### Integrated Terminals

Multiple terminal sessions with full PTY support, running inside the sandbox:

- **Tab management** — create, rename, switch, and close terminal tabs
- **Auto-resize** — terminals automatically fit their container via ResizeObserver
- **Reconnection** — terminals survive page reloads; scrollback is replayed from the sandbox on reconnect
- **Agent-driven terminals** — the AI agent can create its own terminals via MCP tools (e.g., to start a dev server or run tests), and those terminals appear as new tabs in your panel

### File Explorer

Browse and navigate the sandbox filesystem directly from the left sidebar. The file tree loads on demand via WebSocket and caches directory listings for fast navigation.

### Search in Files

VS Code-style full-text search across the entire project workspace:

- **Search options** — toggle match case, whole word, and regex from inline icons
- **Include / Exclude filters** — comma-separated glob patterns to narrow results
- **Grouped results** — matches grouped by file, each showing line number and highlighted content
- **Smart defaults** — common directories (`node_modules`, `dist`, `.git`, `__pycache__`, etc.) are excluded automatically
- **Result limits** — results capped at 2000 lines with a 35-second timeout for large codebases
- **Click to open** — clicking a match opens the file in the editor

### Source Control (Git)

Full git integration built into the left sidebar and status bar:

- **Status view** — staged, unstaged, untracked, and conflicted file sections with per-file action buttons (stage, unstage, discard)
- **Diff view** — click any changed file to open a side-by-side diff in the central panel using Monaco's diff editor, showing original vs modified content with syntax highlighting
- **Commit** — textarea with contextual action button (Commit, Commit All, or Sync Changes) based on the current state
- **AI commit messages** — click the sparkle icon to generate a conventional commit message from staged changes and recent thread context
- **Push / Pull / Sync** — one-click sync from the status bar with ahead/behind counts
- **Branch management** — branch picker dropdown from the status bar with create, create from, checkout detached, and a scrollable branch list sorted by last used
- **Optimistic UI** — staging, unstaging, and discarding update instantly in the UI before the server confirms
- **Conflict awareness** — conflicted files appear in a dedicated section for resolution
- **Large changeset guard** — warns when more than 100 files have changed (configurable), with an option to analyze `.gitignore` with the AI agent

### Port Forwarding

Automatic discovery of processes listening on TCP ports inside the sandbox:

- **Ports tab** — appears in the bottom panel alongside terminals, showing port number, process name, and an "Open Preview" button with a badge for active port count
- **Preview URLs** — for Daytona sandboxes, opens a signed public URL; for local providers (Docker/Apple Container), routes through a built-in HTTP preview proxy
- **Desktop TCP forwarding** — in the desktop app, ports can be forwarded to localhost for direct browser access
- **Agent access** — agents can discover preview URLs via the `get_preview_url` MCP tool
- **Status bar indicator** — shows the current port count with a broadcast icon; click to jump to the ports tab
- **Auto-scan** — the bridge scans ports every 3 seconds and pushes updates only when the list changes

### Secrets Management

Manage API secrets (Stripe, Twilio, etc.) that are injected into outbound requests without ever entering sandbox containers:

- **Secrets page** — accessible from the project list header (shield icon) at `/secrets`
- **CRUD interface** — add, edit, and delete secrets with name, value, target domain, and auth type
- **Auth types** — Bearer token, API key header, HTTP Basic, or custom header
- **Values never exposed** — secret values are stored server-side and masked in the UI; agents can discover secret names via the `list_secrets` MCP tool but never see values
- **Transparent proxy** — a MITM HTTPS proxy intercepts outbound traffic from containers and injects credentials for matching domains; non-secret domains pass through as transparent tunnels

### Command Palette

Every action is a registered command, accessible via `Ctrl+Shift+P`:

- **Searchable list** — type to filter all available commands by name
- **Customizable shortcuts** — user-editable `keybindings.json` for overriding defaults
- **Scoped commands** — global commands work everywhere; project-scoped commands (terminal, agent slash commands) are available when a project is open
- **Theme commands** — cycle through themes or jump directly to Midnight Blue, Dark, or Light
- **Agent commands** — slash commands like `/compact`, `/cost`, `/plan`, `/diff`, and more are accessible from the palette

### Themes

Three built-in color themes, switchable from the command palette or settings:

- **Midnight Blue** — deep blue tones (default)
- **Dark** — standard dark theme
- **Light** — light theme for bright environments

### Desktop App

The IDE is available as a native desktop application for macOS, Linux, and Windows:

- **Lightweight packaging** — built on Electrobun (Bun + system WebKit) with a ~12 MB bundle; no Chromium overhead
- **Native window management** — multiple project windows, draggable title bar, macOS dock behavior
- **Open in IDE** — detects locally installed Cursor or VS Code and launches a native SSH remote connection to the sandbox (managed SSH config with 24-hour tokens)
- **Code-server fallback** — in the web version, "Open in IDE" launches a code-server URL instead
- **Settings UI** — configure API keys from a built-in settings page (grouped by context: Agent API Keys, GitHub, Sandbox) instead of `.env` files
- **Delta updates** — binary diff (bsdiff) updates for small download sizes
- **Identical features** — everything that works in the web version works identically in the desktop app

### Layout Persistence

Your workspace layout saves automatically and restores across sessions:

- Terminal panel state (open/closed, height)
- Active terminal tab
- Active thread session
- Sidebar states (left/right, open/closed)
- Editor tabs and scroll offsets
- Dual persistence — instant restore from localStorage, canonical state synced to the sandbox filesystem
- Full-screen loading overlay during restore to prevent layout flicker

---

## Apex CLI

A terminal-first interface that wraps AI coding agents running inside sandboxes. The agent executes remotely in an isolated environment, but the experience feels like it's running locally — you interact through your existing terminal workflow, and Apex handles provisioning, connection, and session management transparently.

The CLI shares the same WebSocket bridge and SQLite database as the IDE — projects and threads are accessible from either interface.

### Quick Start

```bash
# First-time setup
apex configure

# Ephemeral one-shot task
apex run "write a Python script that parses CSV files"

# Create a project and start working
apex create my-app

# Open an existing project
apex open my-app
```

### Commands

#### `apex configure`

Interactive wizard to set up API keys and settings:

- Anthropic API Key (for Claude models)
- OpenAI API Key (for GPT models)
- Daytona API Key (for cloud sandbox provisioning)
- Daytona API URL and snapshot configuration
- Values stored in a shared SQLite database

#### `apex run "<prompt>"`

Ephemeral mode — spin up a throwaway sandbox, run the task, tear it down:

- **Clean output** — only the assistant's text result is printed to stdout by default
- **Pipe-friendly** — safe to pipe results into files or other commands
- **Git support** — clone a repository into the sandbox with `--git-repo`
- **Verbose mode** — pass `-v` to see progress (spinner, tool calls, cost) on stderr

```bash
apex run "generate a Dockerfile for Node.js" > Dockerfile
apex run "fix the failing tests" --git-repo https://github.com/user/repo
```

#### `apex create [project-name]`

Create a new project with a persistent sandbox:

- Interactive mode prompts for name, description, and optional git repo
- Non-interactive mode (`--non-interactive`) creates and exits without opening a session
- Automatically provisions a sandbox and enters an interactive thread

#### `apex open <project>`

Open an existing project for interactive development or one-shot prompts:

- **Interactive mode** — REPL with streamed responses, session commands, and slash commands
- **Prompt mode** (`-p`) — send a single prompt, stream the response, and exit
- **Stream mode** (`-s`) — progress on stderr, clean output on stdout for piping
- **Auto-create** — if the project doesn't exist and `--prompt` is provided, creates it on the fly

```bash
apex open my-app                                        # interactive REPL
apex open my-app -p "add user authentication with JWT"  # one-shot prompt
apex open my-app -p "generate a Dockerfile" -s > Dockerfile  # pipe-friendly
```

#### `apex cmd <project> <thread-id> <prompt>`

Send a prompt or slash command to an existing thread session:

- Resume any previous conversation by thread ID (prefix match supported)
- Run slash commands: `/status`, `/diff`, `/cost`, `/mcp`, `/help`
- Start a new thread with `new` as the thread ID

```bash
apex cmd my-app 8d300c0a "implement todo item types"
apex cmd my-app 8d300c0a /diff
apex cmd my-app new "start a new feature"
```

#### `apex project list` / `apex project delete`

Manage your projects:

- `project list` — list all projects
- `project delete <project>` — remove a project and its sandbox (with confirmation)

### Interactive REPL

When you `apex open` or `apex create` a project, you enter a rich terminal REPL:

- **Streamed rendering** — agent thoughts, tool calls, and code edits render in real time
- **Session commands** — `:new` (new thread), `:threads` (list threads), `:open <id>` (switch thread), `:quit`
- **Slash commands** — `/help`, `/diff`, `/undo`, `/commit`, `/status`, `/cost`, `/model`, `/history`, `/clear`, `/add <file>`, `/config`, `/mcp`
- **Multi-thread support** — switch between threads while streaming continues
- **AskUserQuestion** — agent questions appear inline with a `?` indicator; respond directly in the REPL
- **Session continuity** — follow-up prompts carry full conversation context

### Scriptable & Composable

The CLI is designed for automation:

- `run` and `cmd` output only the result by default — safe for piping and scripting
- Verbose mode (`-v`) sends progress to stderr, keeping stdout clean
- Environment variables override database settings for CI/CD integration
- Database path is configurable via `--db-path`, `APEX_DB_PATH`, or auto-detected

---

## Sandbox Providers

Apex supports multiple sandbox providers, selectable per-project at creation time:

| Provider | Environment | Use Case |
|---|---|---|
| **Daytona** | Cloud VM | Production use, team collaboration, project forking |
| **Docker** | Local container | Local development, offline work, fast iteration |
| **Apple Container** | macOS VM (macOS 26+) | Native macOS sandbox with hardware isolation |
| **Local** | Host folder | Direct host filesystem access, no container overhead |

All container-based providers use the same default sandbox image with OpenCode and the toolchain pre-installed. The WebSocket bridge is uploaded and started automatically on first connection.

- **Daytona** supports project forking (snapshot and clone a sandbox)
- **Docker** requires Docker socket access or Docker-in-Docker
- **Apple Container** requires macOS 26+ and the `container` CLI
- **Local** provider uses a host folder directly with a local PTY on the API server

---

## Security

### LLM API Key Proxy

LLM provider keys (Anthropic, OpenAI) never enter sandbox containers. The API server runs a streaming reverse proxy that injects real API keys server-side. Containers receive placeholder keys and base URLs pointing at the proxy, so the agent operates normally without ever seeing actual credentials.

### Secrets Proxy (MITM)

User-defined API key secrets (Stripe, Twilio, etc.) are managed via a transparent MITM HTTPS proxy:

- Secret values are stored server-side and never enter containers
- A forward proxy intercepts outbound HTTPS traffic from containers
- For domains with configured secrets, TLS is terminated with a dynamic certificate, the real auth header is injected, and the request is forwarded upstream
- Non-secret domains pass through as transparent tunnels
- Containers get proxy environment variables, the CA cert in the system trust store, and placeholder env vars so SDKs can initialize
- Agents can discover secret names (never values) via the `list_secrets` MCP tool
- Manage secrets from the `/secrets` page in the IDE

---

## Shared Infrastructure

Both the IDE and CLI are built on the same sandboxing layer:

| Component | Description |
|---|---|
| **Sandbox Providers** | Pluggable provider interface — Daytona (cloud), Docker (local), Apple Container (macOS VM), Local (host folder) |
| **OpenCode Runtime** | Single agent runtime with three named agents (Build, Plan, Sisyphus) and models from any configured provider |
| **WebSocket Bridge** | Node.js server running inside each sandbox that spawns agents, manages PTY sessions, and streams structured JSON output |
| **MCP Terminal Server** | Gives agents the ability to open, read, write to, and close terminals, discover preview URLs, list secrets, and ask users questions |
| **LLM API Key Proxy** | Streaming reverse proxy injecting real LLM keys server-side; containers never see credentials |
| **Secrets Proxy** | MITM HTTPS proxy for user-defined API secrets; values never enter containers |
| **Session-per-Thread** | Each thread maintains conversational context; follow-up prompts include a conversation history summary built from stored messages |
| **Multi-thread Concurrency** | Multiple threads can have concurrent agent processes in the same sandbox |
| **Git-ready Sandboxes** | Every project starts version-controlled — either cloned from a provided repo or initialized with `git init`. Git author identity (name/email) is auto-configured from the linked GitHub account or manual overrides in settings |
| **SQLite Database** | Projects, threads, and messages persisted locally (shared between CLI and desktop app) |
| **Preview Proxy** | HTTP reverse proxy for local providers; signed URLs for Daytona; TCP forwarding for desktop |

### How It Works

1. **Create a project** — choose a sandbox provider (Daytona, Docker, Apple Container, or Local) and optionally link a Git repository. Paste a GitHub issue, PR, branch, or commit URL — the repo is cloned automatically (with the correct branch for PRs/branches), and issue/PR content is stored for use as `@issue`/`@pr` context in prompts
2. **Sandbox provisioned** — a sandbox spins up from a snapshot with OpenCode pre-installed; the Node.js bridge is uploaded and started
3. **Start a thread** — choose an agent (Build, Plan, or Sisyphus) and a model, send a prompt; the bridge spawns the agent process and streams structured JSON back over WebSocket
4. **Stream in real time** — every tool call, code edit, and thought streams back live
5. **Interactive terminals** — open terminals alongside the agent; the agent can create its own via MCP tools
6. **Session continuity** — follow-up prompts resume the agent's session with full context

---

## Getting Started

Download the latest release from the [Releases](https://github.com/daytonaio/apex/releases) page.

### Requirements

- An API key for your preferred model provider:
  - **Anthropic** API key for Claude models
  - **OpenAI** API key for GPT models
  - OpenCode Zen offers free models (no key required)
- For cloud sandboxes: a [Daytona](https://www.daytona.io/) account with API access
- For local sandboxes: Docker installed, or macOS 26+ for Apple Container

### IDE

Download the desktop app for your platform and launch it. Configure your API keys from the Settings page.

### CLI

Download the binary for your platform, add it to your `PATH`, and run:

```bash
apex configure
apex create my-first-project
```
