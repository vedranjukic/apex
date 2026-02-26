# Apex — AI Coding Agents in Secure Cloud Sandboxes

Run AI coding agents like Claude Code and Codex inside secure Daytona cloud sandboxes. Two interfaces, one infrastructure: a full IDE for interactive development, and a CLI that makes remote agents feel local.

---

## Apex IDE

A desktop and web development environment for building applications interactively with AI agents. Think VS Code meets an AI pair programmer — with everything running safely in a cloud sandbox.

### Workspace Layout

A VS Code-inspired workspace with resizable panels and a familiar project-oriented structure:

- **Activity Bar** — narrow icon strip on the far left for switching between Explorer, Source Control, Search, and Settings
- **Side Panel** — wider content area next to the activity bar showing the active category (file tree, git status, search results, settings form)
- **Chat Panel** — central area where you interact with the AI agent, see streamed responses, and review tool calls and code edits
- **Terminal Panel** — resizable bottom panel with multiple terminal tabs, full PTY support, and Tokyo Night theme
- **Right Sidebar** — chat list with search, new chat button, and status indicators for each session
- **Status Bar** — project name, git branch picker, sync status, sandbox health indicator, and IDE launcher button

### AI Agent Chat

Send prompts and watch the agent work in real time:

- **Streamed responses** — every thought, tool call, code edit, and result from the agent appears live as it happens
- **Message grouping** — consecutive assistant messages are merged into coherent agent blocks with a "Thought for Xs" timing indicator
- **Multiple concurrent chats** — run several agent sessions in the same sandbox, each with its own conversation context
- **Session continuity** — follow-up prompts resume the agent's session with full conversational context preserved
- **AskUserQuestion flow** — when the agent needs input, a multiple-choice UI appears inline; select your answer and the agent continues
- **@ File References** — type `@` in the prompt to open an autocomplete file picker, inserting file/folder references as inline tags that are sent alongside your prompt
- **Suggestion chips** — empty-state welcome screen with quick-start prompt suggestions

### Plan Mode

A dedicated mode for designing before building:

- **Plan responses** render in a collapsible inline card with a generated filename, markdown body, and a READY badge on completion
- **Build button** — one click sends the plan to the agent in execution mode, turning the design into working code
- **Persistent** — plan cards reconstruct from message history after page refresh

### Agent Modes & Models

- **Agent mode** — full autonomous execution (default)
- **Plan mode** — agent produces a plan document instead of making changes
- **Ask mode** — agent answers questions without modifying files
- **Model selection** — switch between Sonnet, Opus, and Haiku on the fly

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
- **Click to open** — clicking a match opens the file in the editor

### Source Control (Git)

Full git integration built into the left sidebar and status bar:

- **Status view** — staged, unstaged, untracked, and conflicted file sections with per-file action buttons (stage, unstage, discard)
- **Commit** — textarea with contextual action button (Commit, Commit All, or Sync Changes) based on the current state
- **AI commit messages** — click the sparkle icon to generate a conventional commit message from staged changes and recent chat context
- **Push / Pull / Sync** — one-click sync from the status bar with ahead/behind counts
- **Branch management** — branch picker dropdown from the status bar with create, create from, checkout detached, and a scrollable branch list sorted by last used
- **Optimistic UI** — staging, unstaging, and discarding update instantly in the UI before the server confirms

### Port Forwarding

Automatic discovery of processes listening on TCP ports inside the sandbox:

- **Ports tab** — appears in the bottom panel alongside terminals, showing port number, process name, and an "Open Preview" button
- **Preview URLs** — clicking opens a proxied public URL for the port via the Daytona SDK
- **Status bar indicator** — shows the current port count with a broadcast icon; click to jump to the ports tab
- **Auto-scan** — the bridge scans ports every 3 seconds and pushes updates only when the list changes

### Command Palette

Every action is a registered command, accessible via `Ctrl+Shift+P`:

- **Searchable list** — type to filter all available commands by name
- **Customizable shortcuts** — user-editable `keybindings.json` for overriding defaults
- **Scoped commands** — global commands work everywhere; project-scoped commands (terminal, agent slash commands) are available when a project is open

### Desktop App (Electron)

The IDE is available as a native desktop application for macOS, Linux, and Windows:

- **Standalone packaging** — self-contained app that bundles the API server and dashboard; no browser tab required
- **Native window management** — multiple project windows, draggable title bar, macOS dock behavior
- **Open in IDE** — detects locally installed Cursor or VS Code and launches a native SSH remote connection to the sandbox
- **Settings UI** — configure API keys from a built-in settings page instead of `.env` files
- **Identical features** — everything that works in the web version works identically in the desktop app

### Layout Persistence

Your workspace layout saves automatically and restores across sessions and devices:

- Terminal panel state (open/closed, height)
- Active terminal tab
- Active chat session
- State is stored on the sandbox filesystem, so it follows you to any browser or device

---

## Apex CLI

A terminal-first interface that wraps AI coding agents running inside Daytona sandboxes. The agent executes remotely in an isolated environment, but the experience feels like it's running locally — you interact through your existing terminal workflow, and Apex handles provisioning, connection, and session management transparently.

### Quick Start

```bash
# First-time setup
apex configure

# Ephemeral one-shot task
apex run "write a Python script that parses CSV files"

# Create a project and start chatting
apex create my-app

# Open an existing project
apex open my-app
```

### Commands

#### `apex configure`

Interactive wizard to set up API keys and settings:

- Anthropic API Key (for Claude)
- Daytona API Key (for sandbox provisioning)
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
- Automatically provisions a sandbox and enters an interactive chat

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

#### `apex cmd <project> <chat-id> <prompt>`

Send a prompt or slash command to an existing chat session:

- Resume any previous conversation by chat ID (prefix match supported)
- Run slash commands: `/status`, `/diff`, `/cost`, `/mcp`, `/help`
- Start a new chat with `new` as the chat ID

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
- **Session commands** — `:new` (new chat), `:chats` (list chats), `:open <id>` (switch chat), `:quit`
- **Slash commands** — `/help`, `/diff`, `/undo`, `/commit`, `/status`, `/cost`, `/model`, `/history`, `/clear`, `/add <file>`, `/config`, `/mcp`
- **Session continuity** — follow-up prompts carry full conversation context

### Scriptable & Composable

The CLI is designed for automation:

- `run` and `cmd` output only the result by default — safe for piping and scripting
- Verbose mode (`-v`) sends progress to stderr, keeping stdout clean
- Environment variables override database settings for CI/CD integration
- Database path is configurable via `--db-path`, `APEX_DB_PATH`, or auto-detected

---

## Shared Infrastructure

Both the IDE and CLI are built on the same sandboxing layer:

| Component | Description |
|---|---|
| **Daytona SDK** | Sandbox lifecycle management — create, start, stop, destroy, SSH access, port preview URLs |
| **WebSocket Bridge** | Node.js server running inside each sandbox that spawns agents, manages PTY sessions, and streams structured JSON output |
| **MCP Terminal Server** | Gives agents the ability to open, read, write to, and close terminals inside the sandbox |
| **Session-per-Chat** | Each chat maintains a long-lived agent process; follow-ups pipe to stdin as JSONL, preserving full context |
| **Multi-chat Concurrency** | Multiple chats can have concurrent agent processes in the same sandbox |
| **Git-ready Sandboxes** | Every project starts version-controlled — either cloned from a provided repo or initialized with `git init` |
| **SQLite Database** | Projects, chats, and messages persisted locally (shared between CLI and desktop app) |

### How It Works

1. **Create a project** — optionally link a Git repository to clone into the sandbox
2. **Sandbox provisioned** — a Daytona sandbox spins up from a snapshot with the AI agent pre-installed; a Node.js bridge is uploaded and started
3. **Start a chat** — send a prompt; the bridge spawns the agent process and pipes structured JSON back over WebSocket
4. **Stream in real time** — every tool call, code edit, and thought streams back live
5. **Interactive terminals** — open terminals alongside the agent; the agent can create its own via MCP tools
6. **Session continuity** — follow-up prompts resume the agent's session with full context

---

## Getting Started

Download the latest release from the [Releases](https://github.com/daytonaio/apex/releases) page.

### Requirements

- A [Daytona](https://www.daytona.io/) account with API access
- An API key for your coding agent (Anthropic for Claude Code, OpenAI for Codex)

### IDE

Download the Electron app for your platform and launch it. Configure your API keys from the Settings page.

### CLI

Download the binary for your platform, add it to your `PATH`, and run:

```bash
apex configure
apex create my-first-project
```
