<p align="center">
  <h1 align="center">Daytona Apex</h1>
  <p align="center">Agentic development environment — manage and multitask across parallel AI coding agents from your terminal or a full web IDE</p>
</p>

<p align="center">
  <a href="#apex-cli">CLI</a> &middot;
  <a href="#apex-ide">IDE</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#getting-started">Getting Started</a> &middot;
  <a href="#development-guide">Development Guide</a> &middot;
  <a href="#project-structure">Project Structure</a> &middot;
  <a href="#tech-stack">Tech Stack</a>
</p>

---

**Apex** is an agentic development environment and task manager. It runs AI coding agents inside secure sandboxes — cloud or local — and lets you effortlessly multitask across a large number of agentic tasks running in parallel. Powered by [OpenCode](https://opencode.ai) with three specialized agents (Build, Plan, Orchestrate) and models from Anthropic, OpenAI, Google, and free OpenCode Zen.

### Apex CLI

A terminal tool that wraps coding agents running inside sandboxes. The agent executes remotely in an isolated environment, but the experience feels like it's running on your local machine — you interact through your existing terminal workflow, and Apex handles provisioning, connection, and session management transparently.

### Apex IDE

A desktop and web development environment for interactively building applications with coding agents. It provides a full IDE experience — file explorer, terminals, source control, search, code editor — all running against a secure sandbox, with the agent's work streaming back to you in real time. The home page serves as a task dashboard where you can see all projects and threads at a glance, interact with any thread inline, and manage secrets.

## Architecture

```mermaid
graph TB
    subgraph Client["Client Layer"]
        IDE["Apex IDE"]
        CLI["Apex CLI"]
    end

    subgraph Sandbox["Sandbox (Daytona / Docker / Apple Container / Local)"]
        Bridge["Bridge Server"]
        Agent["OpenCode Agent"]
        MCP["MCP Server"]
        PTY["PTY Sessions"]

        Bridge <--> Agent
        Bridge <--> PTY
        MCP --> Bridge
        Agent --> MCP
    end

    subgraph Security["Security Layer"]
        LLM["LLM Key Proxy"]
        Secrets["Secrets MITM Proxy"]
    end

    IDE <-->|"WebSocket"| Bridge
    CLI <-->|"WebSocket"| Bridge
    Agent -.->|"API calls"| LLM
    Agent -.->|"HTTPS"| Secrets

    style Client fill:#1e1b4b,stroke:#6366f1,color:#e0e7ff
    style Sandbox fill:#052e16,stroke:#10b981,color:#d1fae5
    style Security fill:#3b0764,stroke:#a855f7,color:#f3e8ff
```

### How It Works

Both the CLI and IDE follow the same core flow — provision a sandbox, connect to the agent, stream results:

1. **Create a project** — choose a sandbox provider (Daytona cloud, Docker local, Apple Container, or Local host) and optionally link a Git repository.
2. **Sandbox provisioned** — a sandbox spins up from a snapshot with OpenCode pre-installed. A Node.js bridge is uploaded and started inside it.
3. **Start a thread** — choose an agent (Build, Plan, or Sisyphus) and send a prompt. The bridge spawns the agent process, streams structured JSON output back over WebSocket.
4. **Stream in real time** — every tool call, code edit, and thought from the agent streams back live. Multiple threads can run concurrently in the same sandbox.
5. **Interactive terminals** — open terminals alongside the agent. The agent itself can create terminals via MCP tools (e.g., to start a dev server).
6. **Session continuity** — follow-up prompts resume the agent's session.

The **CLI** connects directly to the sandbox bridge via WebSocket — no API server needed. The **IDE** routes through the API server, which manages projects, persists state, and relays the connection.

## Apex CLI

A CLI binary that makes remote sandboxed agents feel local. See the full [CLI documentation](apps/cli/README.md) for all commands, flags, and usage examples.

- **Transparent wrapping** — run AI agents inside sandboxes while interacting through your terminal as if the agent were local
- **Direct connection** — connects straight to the sandbox bridge via WebSocket, no API server in the middle
- **Project management** — `create`, `open`, `project list`, `project delete`
- **Session persistence** — follow-up prompts carry full conversation context; `cmd` resumes existing threads
- **REPL-style thread** — rich terminal rendering of agent output (thoughts, tool calls, code edits)
- **Automatic provisioning** — sandbox creation, bridge setup, and Git repo cloning happen behind the scenes
- **Ephemeral sandboxes** — `apex run "prompt"` spins up a throwaway sandbox, runs the task, and tears it down
- **Scriptable** — `run` and `cmd` output only the result by default, making them safe to pipe

## Apex IDE

A desktop (Electrobun) and web development environment for building applications interactively with AI agents.

- **Full IDE experience** — VS Code–inspired layout with resizable panels, file explorer, Monaco code editor, search, and Git source control
- **Task dashboard** — home page shows all projects with inline thread lists; click any thread to interact with it in a side panel without leaving the overview
- **Three agents** — Build (autonomous coding), Plan (read-only analysis), Sisyphus (orchestration) — selectable per-thread with models from multiple providers
- **Live agent thread** — send prompts and watch the agent work in real time with grouped message rendering, image attachments, and code snippet references
- **Integrated terminals** — multiple terminal tabs with full PTY support (xterm.js); the agent can also create its own terminals via MCP tools
- **Multiple concurrent threads** — run several agent sessions in the same sandbox, each with its own context
- **Secrets management** — manage API secrets that are injected into outbound requests without ever entering containers
- **Command palette** — every action is a registered command with customizable keyboard shortcuts
- **Three themes** — Midnight Blue, Dark, and Light
- **Session continuity** — layout state, thread history, and agent sessions persist across reloads and devices

## Shared Infrastructure

Both applications are built on top of the same sandboxing layer:

- **Sandbox providers** — pluggable interface supporting Daytona (cloud), Docker (local), Apple Container (macOS VM), and Local (host folder)
- **OpenCode runtime** — single agent runtime with three named agents (Build, Plan, Sisyphus) and models from any configured provider
- **WebSocket bridge** protocol — a Node.js server inside each sandbox that spawns agents, manages PTY sessions, and streams structured output
- **MCP Terminal Server** — gives agents the ability to open, read, write to, and close terminals, discover preview URLs, list secrets, and ask users questions
- **LLM API Key Proxy** — streaming reverse proxy that injects real LLM keys server-side; containers never see credentials
- **Secrets Proxy** — MITM HTTPS proxy for user-defined API secrets; values never enter containers
- **SQLite** database for projects, threads, and messages (shared between IDE and CLI)

## Getting Started

Download the latest release from the [Releases](https://github.com/daytonaio/apex/releases) page.

### Apex CLI

Download the binary for your platform and add it to your `PATH`:

```bash
apex --help
```

### Apex IDE

Download the desktop app for your platform (macOS, Linux, or Windows) and launch it.

Alternatively, the IDE can be accessed as a web app — see the [Development Guide](#development-guide) for running it locally.

### Configuration

Both the CLI and IDE require an API key for your preferred model provider:

- **Anthropic API key** — for Claude models
- **OpenAI API key** — for GPT models
- OpenCode Zen offers free models (no key required)

For cloud sandboxes:
- **Daytona API key** — get one from [app.daytona.io](https://app.daytona.io) → Settings → API Keys

For local sandboxes: Docker installed, or macOS 26+ for Apple Container.

## Development Guide

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Go** >= 1.21 (for the CLI)
- An API key for your model provider (Anthropic, OpenAI, or use free OpenCode Zen models)
- For cloud sandboxes: a [Daytona](https://www.daytona.io/) account with API access
- For local sandboxes: Docker installed

### Installation

```bash
git clone https://github.com/daytonaio/apex.git
cd apex
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
DAYTONA_API_KEY=your-daytona-api-key
DAYTONA_SERVER_URL=https://your-daytona-instance.com
DAYTONA_TARGET=your-target
ANTHROPIC_API_KEY=sk-ant-...
```

### Running the IDE

```bash
# Start both API server and dashboard in dev mode
npm run serve

# Or start them individually
npm run serve:api        # API on http://localhost:6000
npm run serve:dashboard  # Dashboard on http://localhost:4200
```

### Building the CLI

```bash
cd apps/cli
./scripts/build.sh              # all platforms → bin/
./scripts/build.sh darwin-arm64 # single target
./bin/apex-darwin-arm64 --help
```

## Project Structure

```
apex/
├── apps/
│   ├── api/              # IDE backend — NestJS (REST + WebSocket)
│   ├── dashboard/        # IDE frontend — React (Vite + Tailwind CSS 4 + Zustand)
│   ├── desktop/          # Desktop app — Electrobun (Bun + system WebKit)
│   └── cli/              # Apex CLI — Go (Cobra + Gorilla WebSocket)
├── libs/
│   ├── orchestrator/     # Shared sandbox management, bridge scripts, provider interface
│   └── shared/           # Shared TypeScript types and enums
├── workdocs/             # Internal architecture documentation
├── keybindings.json      # User-editable keyboard shortcuts (IDE)
└── package.json          # Nx monorepo root
```

| Package | Description |
|---|---|
| `apps/api` | IDE backend — REST API, WebSocket gateway, sandbox orchestration, LLM proxy, secrets proxy, SQLite database |
| `apps/dashboard` | IDE frontend — thread UI, terminal panel, file explorer, source control, Monaco editor, command palette, secrets page |
| `apps/desktop` | Desktop app — Electrobun packaging, native window management, RPC bridge, settings UI |
| `apps/cli` | Apex CLI — wraps remote agents for a local terminal experience, direct sandbox connection ([README](apps/cli/README.md)) |
| `libs/orchestrator` | Sandbox lifecycle (Daytona/Docker/Apple Container/Local providers), bridge script generation, WebSocket protocol types |
| `libs/shared` | TypeScript types and enums shared between API and dashboard |

## Tech Stack

| Layer | Technology |
|---|---|
| **IDE Frontend** | React 19, Vite 7, Tailwind CSS 4, Zustand, xterm.js, Monaco Editor, Lucide Icons |
| **IDE Backend** | NestJS 11, TypeORM, SQLite (better-sqlite3), WebSocket, Elysia (LLM + secrets proxies) |
| **Desktop App** | Electrobun (Bun + system WebKit) |
| **CLI** | Go, Cobra, Gorilla WebSocket, Daytona Go SDK |
| **Sandbox** | Daytona / Docker / Apple Container / Local, Node.js bridge, OpenCode, node-pty, MCP Terminal Server |
| **Build** | Nx monorepo, Webpack (API), Vite (Dashboard), Go toolchain (CLI) |

## License

This software is source-available under a custom license that permits free personal, non-commercial use. Commercial use and redistribution are not permitted. See [LICENSE](LICENSE) for details.
