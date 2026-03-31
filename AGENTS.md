# Apex Development Guide

## Project Structure

Nx monorepo with these packages:

- `apps/dashboard` -- React 19 + Vite frontend (Zustand, Tailwind CSS 4, Lucide icons)
- `apps/api` -- NestJS backend (TypeORM, SQLite, Socket.io)
- `apps/cli` -- TypeScript/Bun CLI (Commander.js, native SQLite, shared orchestrator)
- `libs/orchestrator` -- Sandbox/orchestration logic
- `libs/shared` -- Shared TypeScript types

## Command Registry & Keybindings

Every user-facing action is a registered command, accessible via the command palette (Ctrl+Shift+P) and optionally bound to a keyboard shortcut. User-editable shortcuts live in `keybindings.json` at the workspace root.

When adding, modifying, or debugging commands or keybindings, read `workdocs/command-registry.md` for the full architecture, file map, how-to guide, shortcut format, and the complete command table.

## State Management

All UI state is in Zustand stores under `apps/dashboard/src/stores/`:

- `panels-store.ts` -- left/right sidebar open state
- `terminal-store.ts` -- terminal list, active terminal, panel height, terminal counter, active bottom tab (terminals/ports)
- `ports-store.ts` -- forwarded ports list from sandbox port scanning
- `tasks-store.ts` -- threads, messages, active thread, per-thread session info (MCP servers, model, tools) (exported as `useThreadsStore`)
- `command-store.ts` -- command registry, keybindings, palette state
- `file-tree-store.ts` -- directory cache for the file explorer
- `projects-store.ts` -- project list, `setThreadStatus()` keeps embedded thread statuses in sync with agent events
- `plan-store.ts` -- plan mode state: plan text accumulation, completion, content-based detection
- `agent-settings-store.ts` -- agent type (build/plan/sisyphus) and model selection
- `theme-store.ts` -- color theme selection (midnight-blue, dark, light), persisted to localStorage
- `lsp-store.ts` -- per-language LSP server status (starting/ready/error/stopped) from bridge
- `references-store.ts` -- Find All References/Implementations results for the sidebar panel
- `tour-store.ts` -- onboarding tour state: dismissed steps persisted to localStorage, sequential tooltip flow
Access store actions outside React components with `useXxxStore.getState().action()`.

## Conventions

- Use Tailwind CSS utility classes with the project's design tokens (defined in `apps/dashboard/src/styles.css`)
- Icons come from `lucide-react`
- Class name merging uses the `cn()` helper from `apps/dashboard/src/lib/cn.ts`
- API routes are prefixed with `/api` (set in NestJS `main.ts`)
- Real-time communication uses Socket.io (agent, terminal, file tree, layout sockets)

## CLI Architecture

The TypeScript CLI (`apps/cli`) uses the same `libs/orchestrator` and `libs/shared` libraries as the NestJS API, ensuring zero code duplication and type safety across the entire stack. Both CLI and API connect to the same in-sandbox bridge via WebSocket using shared protocols.

## Detailed Documentation

Additional docs live in `workdocs/`. Read these only when working on the relevant area:

- `workdocs/architecture-overview.md` -- full system architecture, data model, key flows
- `workdocs/command-registry.md` -- command system, keybindings, how to add commands

- `workdocs/dashboard-frontend.md` -- frontend component structure and patterns
- `workdocs/prompt-file-references.md` -- prompt input, @ references (files, GitHub issue/PR), code snippet references, image attachments, CategoryPicker, FilePicker, tag system
- `workdocs/claude-sandbox-installation.md` -- sandbox provisioning and bridge setup
- `workdocs/sandbox-providers.md` -- sandbox provider interface, Daytona/Docker implementations, per-project selection, how to add providers
- `workdocs/multi-agent-bridge.md` -- OpenCode bridge architecture, agent types (Build/Plan/Sisyphus), protocols, testing
- `workdocs/search-in-files.md` -- search panel, grep backend, socket protocol, default excludes
- `workdocs/source-control.md` -- git source control panel, staging, committing, optimistic UI, AI commit messages
- `workdocs/ports-panel.md` -- port scanning, preview URLs, bottom panel ports tab, status bar indicator
- `workdocs/electron-desktop.md` -- Electrobun desktop app, settings system, packaging
- `workdocs/secrets.md` -- secrets management UI, CRUD API, MITM proxy integration
- `workdocs/open-in-ide.md` -- Open in IDE button, SSH remote connection, IDE detection, SSH config management
- `workdocs/lsp-integration.md` -- LSP architecture, bridge LSP manager, MCP LSP server, dashboard language client, Monaco editor migration

## LLM API Key Proxy

LLM provider keys (Anthropic, OpenAI) never enter sandbox containers. For local providers (Docker, Apple Container), the Elysia API runs a streaming reverse proxy at `/llm-proxy/(anthropic|openai)/*` that injects real keys server-side. For Daytona cloud sandboxes, a dedicated **proxy sandbox** runs the same proxy logic on Daytona's infrastructure (since the host API is typically unreachable from cloud). Containers receive an auth token as their "API key" + `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` pointing at the proxy. Key files: `apps/api/src/modules/llm-proxy/`, `libs/orchestrator/src/lib/llm-proxy-service-script.ts`. See the "LLM API Key Proxy" section in `workdocs/architecture-overview.md` for the full design.

## Secrets Proxy (MITM)

User-defined API key secrets (Stripe, Twilio, etc.) are managed via a transparent MITM HTTPS proxy. Secret values are stored server-side and **never enter containers**. A forward proxy on port 3001 intercepts outbound HTTPS traffic from containers, and for domains with configured secrets, terminates TLS with a dynamic certificate (signed by an auto-generated CA), injects the real auth header, and forwards to the upstream. Non-secret domains pass through as transparent tunnels.

Containers get `HTTPS_PROXY`/`HTTP_PROXY` env vars pointing at the proxy, the CA cert in the system trust store, and placeholder env vars (e.g. `STRIPE_KEY=sk-proxy-placeholder`) so SDKs can initialize. The agent can discover secret names (never values) via the `list_secrets` MCP tool.

Key files: `apps/api/src/modules/secrets/`, `apps/api/src/modules/secrets-proxy/`, dashboard UI at `/secrets`. See the "Secrets Proxy (MITM)" section in `workdocs/architecture-overview.md` for the full design.
