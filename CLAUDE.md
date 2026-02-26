# Apex Development Guide

## Project Structure

Nx monorepo with these packages:

- `apps/dashboard` -- React 19 + Vite frontend (Zustand, Tailwind CSS 4, Lucide icons)
- `apps/api` -- NestJS backend (TypeORM, SQLite, Socket.io)
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
- `tasks-store.ts` -- chats, messages, active chat (exported as `useChatsStore`)
- `command-store.ts` -- command registry, keybindings, palette state
- `file-tree-store.ts` -- directory cache for the file explorer
- `projects-store.ts` -- project list
- `plan-store.ts` -- plan mode state: plan text accumulation, completion, content-based detection
- `agent-settings-store.ts` -- agent mode (agent/plan/ask) and model selection
- `theme-store.ts` -- color theme selection (midnight-blue, dark, light), persisted to localStorage
- `plan-store.ts` -- plan mode state: plan text accumulation, completion, content-based detection

Access store actions outside React components with `useXxxStore.getState().action()`.

## Conventions

- Use Tailwind CSS utility classes with the project's design tokens (defined in `apps/dashboard/src/styles.css`)
- Icons come from `lucide-react`
- Class name merging uses the `cn()` helper from `apps/dashboard/src/lib/cn.ts`
- API routes are prefixed with `/api` (set in NestJS `main.ts`)
- Real-time communication uses Socket.io (agent, terminal, file tree, layout sockets)

## Go CLI ↔ Node.js App Cross-Mode

The Go CLI (`apps/cli`) and NestJS API (`apps/api`) are independent clients that both connect to a shared bridge inside Daytona sandboxes via WebSocket. Types and bridge scripts must stay in sync across Go and TypeScript.

When adding, modifying, or debugging the bridge protocol, sandbox interaction, or cross-language types, read `workdocs/go-cli-cross-mode.md` for the full protocol spec, file map, build commands, and sync checklist.

## Detailed Documentation

Additional docs live in `workdocs/`. Read these only when working on the relevant area:

- `workdocs/architecture-overview.md` -- full system architecture, data model, key flows
- `workdocs/command-registry.md` -- command system, keybindings, how to add commands
- `workdocs/go-cli-cross-mode.md` -- Go CLI ↔ Node.js bridge protocol, types sync, build commands
- `workdocs/dashboard-frontend.md` -- frontend component structure and patterns
- `workdocs/prompt-file-references.md` -- prompt input, @ file references, code snippet references, FilePicker, tag system
- `workdocs/claude-sandbox-installation.md` -- sandbox provisioning and bridge setup
- `workdocs/search-in-files.md` -- search panel, grep backend, socket protocol, default excludes
- `workdocs/source-control.md` -- git source control panel, staging, committing, optimistic UI, AI commit messages
- `workdocs/ports-panel.md` -- port scanning, preview URLs, bottom panel ports tab, status bar indicator
- `workdocs/electron-desktop.md` -- Electron desktop app, settings system, native modules, packaging
- `workdocs/open-in-ide.md` -- Open in IDE button, SSH remote connection, IDE detection, SSH config management
