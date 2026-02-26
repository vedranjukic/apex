# Apex CLI

A command-line interface for Apex that provides a Claude Code-like experience running in Daytona cloud sandboxes.

## Installation

```bash
cd apps/cli

# Build for your current platform
go build -o bin/apex .

# Or use the build script for cross-compilation
./scripts/build.sh                # all platforms
./scripts/build.sh darwin-arm64   # macOS Apple Silicon only
./scripts/build.sh darwin-amd64   # macOS Intel only
./scripts/build.sh linux-amd64    # Linux x86_64 only
```

Binaries are output to `apps/cli/bin/`.

## Quick start

```bash
# First-time setup — configure API keys
apex configure

# Ephemeral — run a prompt, sandbox is destroyed after
apex run "write a Python script that parses CSV files"

# Create a project and start a chat session
apex create my-app

# Open an existing project
apex open my-app

# One-shot prompt on a project
apex open my-app -p "add user authentication"

# Send a command to an existing chat
apex cmd my-app 8d300c0a "implement todo item types"
```

## Global flags

| Flag | Description |
|---|---|
| `--db-path <path>` | Override the SQLite database path |
| `--version` | Print version |

## Commands

### `apex configure`

Interactive wizard to set or update API keys and settings. Values are stored in the shared Apex SQLite database.

Prompts for:

- **Anthropic API Key** — required for Claude
- **Daytona API Key** — required for sandbox provisioning
- **Daytona API URL** — API endpoint (default `https://app.daytona.io/api`)
- **Daytona Snapshot** — base sandbox snapshot

### `apex run "<prompt>"`

Run a prompt in an ephemeral sandbox. The sandbox is created automatically and destroyed once the task completes. No project name needed.

By default only the assistant's text result is printed to stdout. Progress (spinner, tool calls, cost) is hidden unless `--verbose` is passed.

**Flags:**

| Flag | Short | Description |
|---|---|---|
| `--verbose` | `-v` | Show progress (tool calls, cost) on stderr |
| `--git-repo <url>` | | Git repository URL to clone into the sandbox |

**Examples:**

```bash
# One-shot ephemeral task — only the result is printed
apex run "write a Python script that parses CSV files"

# Clone a repo and work on it
apex run "fix the failing tests" --git-repo https://github.com/user/repo

# See progress while running
apex run "build a REST API" -v

# Pipe the result to a file
apex run "generate a Dockerfile for Node.js" > Dockerfile
```

### `apex create [project-name]`

Create a new project, provision a sandbox, and open an interactive chat session.

When run without arguments, prompts interactively for project details. With a name argument, creates the project directly and enters the session.

**Flags:**

| Flag | Description |
|---|---|
| `--description <text>` | Project description |
| `--git-repo <url>` | Git repository URL to clone into the sandbox |
| `--non-interactive` | Create the project and exit without opening a session |

**Examples:**

```bash
# Interactive — prompts for name, description, git repo, then opens session
apex create

# Create and open session directly
apex create my-app

# Create from a git repo
apex create my-app --git-repo https://github.com/user/repo

# Just create, don't open session
apex create my-app --non-interactive
```

### `apex open <project>`

Open an existing project and start an interactive chat session, or run a single prompt.

The `<project>` argument accepts a project ID, exact name, or unambiguous name prefix. If the project doesn't exist and `--prompt` is provided, it is created automatically.

**Flags:**

| Flag | Short | Description |
|---|---|---|
| `--prompt <text>` | `-p` | Send a prompt to the agent and exit when done |
| `--stream` | `-s` | Stream task progress to stderr; keeps stdout clean for piping the result |
| `--git-repo <url>` | | Git repository URL to clone into the sandbox (used when creating a new project) |

**Behavior:**

- **Interactive mode** (no flags) — opens a REPL where you type prompts and receive streamed responses. Supports session commands (`:new`, `:chats`, `:open <id>`, `:quit`) and Claude-style slash commands (`/help`, `/diff`, `/undo`, `/commit`, `/status`, `/cost`, `/model`, `/history`, `/clear`, `/add <file>`, `/config`, `/mcp`).
- **Prompt mode** (`-p`) — creates a new chat session, sends the prompt, streams the full response, and exits. If the named project doesn't exist, it is created and a sandbox is provisioned automatically.
- **Stream mode** (`-s`) — sends progress output (spinner, tool calls, cost summary) to stderr so that stdout contains only the assistant's text. Useful for piping results into other commands or capturing clean output.

**Examples:**

```bash
# Interactive session on an existing project
apex open my-app

# One-shot prompt on an existing project
apex open my-app -p "add user authentication with JWT"

# Auto-create project + sandbox, run prompt
apex open new-app -p "scaffold a Go REST API with Chi router"

# Auto-create from a git repo
apex open my-fork -p "fix the failing tests" --git-repo https://github.com/user/repo

# Pipe-friendly — only the assistant's text hits stdout
apex open my-app -p "generate a Dockerfile for Node.js" -s > Dockerfile
```

### `apex cmd <project> <chat-id> <command-or-prompt>`

Run a slash command or send a prompt to an existing chat in a project. The chat ID can be a prefix (e.g. first 8 characters). Use `new` to start a fresh chat.

By default only the result is printed. Use `--verbose` to see progress on stderr.

**Flags:**

| Flag | Short | Description |
|---|---|---|
| `--verbose` | `-v` | Show progress (tool calls, cost) on stderr |

**Examples:**

```bash
# Slash commands against an existing chat
apex cmd my-app 8d300c0a /status
apex cmd my-app 8d300c0a /diff
apex cmd my-app 8d300c0a /cost
apex cmd my-app 8d300c0a /mcp

# Send a prompt to an existing chat (resumes session context)
apex cmd my-app 8d300c0a "implement todo item types"

# Start a new chat in the project
apex cmd my-app new "start a new feature"

# With progress output
apex cmd my-app 8d300c0a "add tests" -v
```

### `apex project list`

List all projects. Alias: `apex project ls`.

```bash
apex project list
```

### `apex project delete <project>`

Delete a project and its sandbox. Prompts for confirmation unless `--force` is set.

**Flags:**

| Flag | Short | Description |
|---|---|---|
| `--force` | `-f` | Skip confirmation prompt |

**Example:**

```bash
apex project delete my-app
apex project delete my-app -f
```

## Environment variables

These override database settings when set:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `DAYTONA_API_KEY` | Daytona API key |
| `DAYTONA_API_URL` | Daytona API endpoint |
| `DAYTONA_SNAPSHOT` | Base sandbox snapshot |
| `APEX_DB_PATH` | SQLite database path |

## Database path resolution

The CLI resolves the database location in this order:

1. `--db-path` flag
2. `APEX_DB_PATH` environment variable
3. Development workspace (`data/apex.sqlite` walking up from CWD)
4. Electron-compatible user data directory (`~/.config/Apex/apex.sqlite` on Linux, `~/Library/Application Support/Apex/apex.sqlite` on macOS)
