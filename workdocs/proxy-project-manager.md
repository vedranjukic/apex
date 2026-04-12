# Proxy Project Manager & Mobile Dashboard

## Overview

The Daytona proxy sandbox hosts a **project registry API** and a **mobile dashboard** alongside the Rust `apex-proxy` binary. This enables:

- Listing Daytona-based projects from any device
- Monitoring thread status and reading agent conversations remotely
- A mobile-optimized web interface served directly from the proxy sandbox

## Architecture

The proxy sandbox runs two processes:

| Port | Process | Purpose |
|------|---------|---------|
| 3000 | `apex-proxy` (Rust) | LLM proxy, MITM secrets, tunnel, port relay |
| 3001 | `projects-api.js` (Node) | Project/thread/message registry + mobile dashboard SPA |

Sync is **bidirectional**: the desktop pushes data on every lifecycle event and message, while also pulling missing messages/threads from the proxy when loading data. The mobile dashboard is a static React SPA served from `/app` on the same port.

## Data Flow

Sync is **bidirectional** — both the desktop and mobile can create prompts, and each sees the other's activity.

### Desktop → Proxy (push)

On project create/update/delete, thread create/status-change/delete, and every `addMessage` call, the desktop API pushes data to the proxy registry via `ProxyProjectsService`. This happens for all message roles (user, assistant, system), so the webapp sees desktop-initiated agent runs in near real-time.

### Proxy → Desktop (pull)

When the desktop loads thread data (`getMessages`, `findByProject`, `findById`), it imports missing messages and threads from the proxy into the host SQLite DB via `importProxyMessages` / `importProxyThreads` / `syncThreadStatusFromProxy`. A **proxy poller** (5s interval, `startProxyPoller` in `agent.ws.ts`) runs for subscribed Daytona projects and emits `proxy_sync` WebSocket events to desktop clients when new messages appear, enabling live updates without page refresh.

### Mobile → Proxy (direct)

The mobile dashboard sends prompts via `POST /prompts` on the proxy, which connects directly to the project sandbox's bridge WebSocket to run the agent. A 5s background poll on the mobile dashboard detects new messages and agent runs from either source.

### Bridge multi-client

The in-sandbox bridge supports multiple concurrent WebSocket clients (`wsClients` Set + `broadcastWs` helper). Both the desktop orchestrator and the proxy can be connected simultaneously without displacing each other.

### Other flows

- **Proxy → Disk**: The Node script persists to JSON files (`projects.json`, `threads.json`, `messages.json`)
- **Startup sync**: On API startup, all existing Daytona projects and threads are bulk-synced to the proxy

## Key Files

| File | Role |
|------|------|
| `libs/orchestrator/src/lib/proxy-projects-script.ts` | Self-contained Node script (generated as a string, uploaded to sandbox) |
| `apps/api/src/modules/llm-proxy/proxy-projects.service.ts` | HTTP client for bidirectional sync (push: syncProject/Thread/Messages, pull: fetchThread/Messages/ProjectThreads) |
| `apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts` | Proxy sandbox lifecycle, dashboard upload, URL management |
| `apps/api/src/modules/tasks/tasks.service.ts` | Thread sync hooks, proxy import (importProxyMessages, importProxyThreads, syncThreadStatusFromProxy) |
| `apps/api/src/modules/agent/agent.ws.ts` | Proxy poller (startProxyPoller) emits proxy_sync events to desktop clients |
| `apps/api/src/modules/projects/projects.service.ts` | Project sync hooks + initial bulk sync |
| `apps/mobile-dashboard/` | React + Vite + Tailwind mobile SPA |
| `apps/desktop/src/bun/index.ts` | Passes `MOBILE_DASHBOARD_DIR` env to the API |

## API Endpoints (Port 3001)

All endpoints except `/health` and `/app/*` require `Authorization: Bearer <PROXY_AUTH_TOKEN>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| GET | `/app`, `/app/*` | Mobile dashboard SPA (no auth) |
| GET | `/projects` | List all projects |
| POST | `/projects` | Upsert a project |
| GET | `/projects/:id` | Get single project |
| PUT | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |
| GET | `/projects/:id/threads` | List threads for a project |
| POST | `/threads` | Upsert a thread |
| GET | `/threads/:id` | Get single thread |
| DELETE | `/threads/:id` | Delete thread + messages |
| POST | `/threads/:id/messages` | Batch replace messages |
| GET | `/threads/:id/messages` | Get messages for a thread |

## Mobile Dashboard

A minimal React SPA (`apps/mobile-dashboard/`) with four views:

- **Auth screen** — token input, validates against `/health`
- **Project list** — status dots, names, inline thread previews, git repo
- **Thread list** — per-project, status, title, agent type
- **Thread view** — message bubbles (user/assistant/tool/system)

Built with Vite, output uploaded to `/home/daytona/mobile-dashboard/` during proxy sandbox creation. The build is wired as an Nx dependency of `@apex/api`.

## Desktop Settings Integration

The mobile dashboard URL and auth token are visible in **Settings > Mobile View** in the desktop app. The URL is stable (public sandbox, non-expiring preview URL).

## E2E Tests

`apps/api-e2e/src/proxy-projects-daytona.spec.ts` covers:
- Health check, auth (reject no/wrong token)
- Direct CRUD against the proxy API
- Automatic sync on project create/update/stop/delete
- Provider isolation (non-Daytona projects don't sync)

Run: `yarn test:proxy-projects-e2e`
