# Secrets Management

User-defined API key secrets (Stripe, Twilio, etc.) are stored server-side and **never enter sandbox containers as plaintext**. A transparent MITM HTTPS proxy intercepts outbound traffic from containers and injects real credentials at the HTTP level.

## UI

The secrets management page is accessible at `/secrets` from the dashboard. A shield icon button in the project list header navigates to it.

### Secrets Page (`apps/dashboard/src/pages/secrets-page.tsx`)

- **List view**: Displays all secrets for the default user with name, domain, auth type, and masked value
- **Add / Edit form**: Fields for name, value, domain, auth type (bearer / x-api-key / basic / custom header), and description
- **Delete**: Removes a secret with confirmation
- **Info banner**: Explains that secret values never enter sandbox containers
- **Project scoping**: The data model supports per-project secrets (`projectId` column), but the UI currently creates global secrets only (no project selector in the form)

### API Client

`apps/dashboard/src/api/client.ts` exports `secretsApi`:

| Method | Endpoint | Description |
|---|---|---|
| `list(projectId?)` | `GET /api/secrets` | Lists secrets (optionally filtered by project) |
| `create(input)` | `POST /api/secrets` | Creates a secret, returns masked value |
| `update(id, input)` | `PUT /api/secrets/:id` | Updates a secret (masks `••••` in value field are stripped) |
| `delete(id)` | `DELETE /api/secrets/:id` | Deletes a secret |

## Backend

### REST API (`apps/api/src/modules/secrets/secrets.routes.ts`)

Mounted at `/api/secrets`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/secrets` | GET | Lists secrets. Optional `?projectId=` query. Returns secrets without values. |
| `/api/secrets` | POST | Creates a secret. Body: `name`, `value`, `domain`, optional `authType`, `description`, `projectId`. Returns masked value via `maskValue()`. |
| `/api/secrets/:id` | PUT | Updates a secret. If `value` contains `••••`, it is stripped so stored value is preserved. Returns masked value. |
| `/api/secrets/:id` | DELETE | Deletes a secret. 404 if not found. |

Create and delete trigger `projectsService.reinitSandboxManager()` to refresh proxy and placeholder env vars in running sandboxes.

### Service (`apps/api/src/modules/secrets/secrets.service.ts`)

| Method | Description |
|---|---|
| `list(userId, projectId?)` | Returns secrets where `userId` matches AND (`projectId` equals the given project OR `projectId` is null for global secrets). Values are never included in list responses. |
| `create(data)` | Creates a new secret |
| `update(id, userId, data)` | Updates fields on an existing secret |
| `remove(id, userId)` | Deletes a secret |
| `resolveForProject(userId, projectId)` | Merges global + project-scoped secrets by name (project-scoped wins). Returns full records including values (internal use only — for proxy/bridge callers). |
| `findByDomain(domain)` | Returns all secrets matching a domain (used by MITM proxy, not user-scoped). |
| `getSecretDomains()` | Returns distinct domains that have any secret configured. |

### Database Schema

`apps/api/src/database/schema.ts` — `secrets` table:

| Column | Type | Description |
|---|---|---|
| `id` | text (UUID) | Primary key |
| `userId` | text (FK users) | Owner |
| `projectId` | text (FK projects, nullable) | Null = global secret, set = project-scoped |
| `name` | text | Display name and env var key (e.g. `STRIPE_KEY`) |
| `value` | text | Actual secret value (never exposed to clients or containers) |
| `domain` | text | Target domain for MITM interception (e.g. `api.stripe.com`) |
| `authType` | text (default `'bearer'`) | How the proxy injects the credential |
| `description` | text (nullable) | Optional human description |
| `createdAt` | text | ISO timestamp |
| `updatedAt` | text | ISO timestamp |

## MITM Proxy

### Architecture

The MITM proxy architecture varies by sandbox provider:

#### Local/Container Providers (Docker, Apple Container)

```
Container app → CONNECT api.stripe.com:443 via HTTPS_PROXY
                            ↓
               MITM Proxy (secrets-proxy.ts, port 3001)
                            ↓
              Looks up domain in secrets DB → match found
                            ↓
              TLS termination with dynamic cert (signed by Apex CA)
                            ↓
              Reads decrypted HTTP request, injects auth header
                            ↓
              https://api.stripe.com (with real Authorization: Bearer <key>)
```

#### Daytona Provider (WebSocket TCP Tunnel)

Since Daytona preview URLs only support HTTP/HTTPS with WebSocket upgrades (no raw TCP), a TCP-over-WebSocket tunnel enables MITM proxy functionality:

```
Regular Sandbox (Daytona)                    Proxy Sandbox (Daytona)
┌─────────────────────────────┐              ┌──────────────────────────────┐
│ gh / curl / SDK             │              │ MITM Secrets Proxy (:9340)  │
│   ↓                         │              │   ▲                          │
│ HTTPS_PROXY=localhost:9339  │  WebSocket   │   │ TCP                      │
│   ↓                         │  /tunnel     │   │                          │
│ TCP-to-WS Client (:9339)    │ ──────────── │ WS-to-TCP Bridge (:3000)    │
│ (bridge script)             │              │ + LLM Proxy                  │
└─────────────────────────────┘              └──────────────────────────────┘
```

**Port Assignments for Daytona:**

| Port | Role | Location |
|------|------|----------|
| `9339` | Tunnel client (local proxy endpoint) | Regular sandbox — bridge script |
| `9340` | MITM secrets proxy | Proxy sandbox — internal only |
| `3000` | LLM proxy + WebSocket tunnel bridge | Proxy sandbox — shared HTTP server |

**Flow for Daytona GitHub API call:**
1. `gh` reads `HTTPS_PROXY=http://localhost:9339`, connects to localhost:9339
2. `gh` sends `CONNECT api.github.com:443 HTTP/1.1` over TCP connection
3. **TCP-to-WS client** (bridge script) accepts connection, opens WebSocket to `wss://<proxy-sandbox>/tunnel`
4. All bytes flow bidirectionally: TCP socket ↔ binary WebSocket frames
5. **WS-to-TCP bridge** (proxy sandbox) accepts WebSocket, connects to MITM proxy (localhost:9340)
6. **MITM proxy** handles CONNECT, performs TLS termination, injects auth, forwards to upstream

For domains **without** secrets, the proxy acts as a transparent TCP tunnel (no interception, no certificate).

### Proxy Server

#### Local/Container Implementation (`apps/api/src/modules/secrets-proxy/secrets-proxy.ts`)

- **Port**: 3001 (default, override with `SECRETS_PROXY_PORT`)
- **CONNECT handling (HTTPS)**: Parses host from CONNECT request. If `findByDomain(host)` returns no rows → transparent TCP tunnel. If rows exist → MITM path with dynamic TLS cert.
- **Plain HTTP proxy**: Same domain lookup for `http://` / `https://` absolute URLs.

#### Daytona Implementation

**Combined Proxy Service** (`libs/orchestrator/src/lib/combined-proxy-service-script.ts`):
- **LLM Proxy** (port 3000) - existing API key proxying functionality
- **MITM Proxy** (port 9340, internal) - secrets injection with TLS termination
- **WebSocket Tunnel Bridge** (`/tunnel` endpoint) - converts WebSocket frames to TCP

**Bridge Script Enhancement** (`libs/orchestrator/src/lib/bridge-script.ts`):
- **TCP-to-WebSocket client** on port 9339 accepting proxy connections
- **Environment variable**: `TUNNEL_ENDPOINT_URL` - WebSocket endpoint for tunnel
- **Bidirectional data flow** with backpressure management

**Sandbox Manager Configuration** (`libs/orchestrator/src/lib/sandbox-manager.ts`):
- **Daytona**: Sets `HTTPS_PROXY=http://localhost:9339` (tunnel client)
- **Other providers**: Uses direct proxy URLs (unchanged)
- **Environment**: Passes `TUNNEL_ENDPOINT_URL=${proxyBase}/tunnel` to bridge

**Auth injection** (`buildAuthHeader`) - same for both implementations:

| `authType` | Injected Header |
|---|---|
| `bearer` | `Authorization: Bearer <value>` |
| `x-api-key` | `x-api-key: <value>` |
| `basic` | `Authorization: Basic base64(<value>)` |
| `header:<name>` | Custom header (lowercased name): `<value>` |

Client `authorization` / `x-api-key` headers are stripped before injection.

### CA Manager (`apps/api/src/modules/secrets-proxy/ca-manager.ts`)

1. On first API server startup, generates RSA 2048-bit CA keypair + self-signed "Apex Secrets Proxy CA" certificate
2. CA cert + key persisted in `settings` table (`PROXY_CA_CERT`, `PROXY_CA_KEY`)
3. During `installBridge()` / `restartBridge()`, CA cert is uploaded to container and `update-ca-certificates` is run
4. Per-domain certificates generated on-the-fly and cached in memory

## Container Environment

Container environment varies by provider:

### Local/Container Providers
- `HTTPS_PROXY` / `HTTP_PROXY` → proxy URL (e.g. `http://<host-lan-ip>:3001`)
- `NO_PROXY=localhost,127.0.0.1,0.0.0.0` so local traffic skips the proxy
- Custom CA certificate installed in the system trust store
- `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE` for per-runtime CA trust
- Placeholder env vars for each secret (e.g. `STRIPE_KEY=sk-proxy-placeholder`) so SDKs can initialize

### Daytona Provider
- `HTTPS_PROXY=http://localhost:9339` → points to tunnel client in bridge script
- `HTTP_PROXY=http://localhost:9339` → same tunnel client for HTTP traffic
- `TUNNEL_ENDPOINT_URL` → WebSocket endpoint URL (e.g. `wss://proxy-sandbox/tunnel`)
- `NO_PROXY=localhost,127.0.0.1,0.0.0.0` so local traffic skips the proxy
- Custom CA certificate installed in the system trust store (same as other providers)
- `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, etc. for CA trust
- Placeholder env vars for each secret (same as other providers)

## Agent Awareness

Agents can discover configured secrets via the `list_secrets` MCP tool (`mcp__terminal-server__list_secrets`). It returns secret names, domains, and auth types — **never values**.

Flow: Agent calls `list_secrets` → MCP server calls bridge `/internal/list-secrets` → bridge calls API `GET /api/secrets?projectId=<id>` → returns safe objects (name, domain, authType, description only).

## Key Files

### Core Secrets Management
| File | Role |
|---|---|
| `apps/api/src/modules/secrets/secrets.service.ts` | CRUD + domain lookup for secrets (SQLite) |
| `apps/api/src/modules/secrets/secrets.routes.ts` | REST API under `/api/secrets` |
| `apps/api/src/database/schema.ts` | `secrets` table definition |
| `apps/dashboard/src/pages/secrets-page.tsx` | Secrets management UI at `/secrets` |
| `apps/dashboard/src/api/client.ts` | `secretsApi` client |
| `apps/api/src/modules/projects/projects.service.ts` | `reinitSandboxManager()` on secret create/delete; placeholder env var generation |

### MITM Proxy - Local/Container Providers
| File | Role |
|---|---|
| `apps/api/src/modules/secrets-proxy/secrets-proxy.ts` | MITM proxy server — CONNECT handler, selective TLS interception, auth injection, transparent tunnel fallback |
| `apps/api/src/modules/secrets-proxy/ca-manager.ts` | CA keypair generation, persistence, per-domain certificate generation + caching |

### MITM Proxy - Daytona Provider (TCP-over-WebSocket Tunnel)
| File | Role |
|---|---|
| `libs/orchestrator/src/lib/combined-proxy-service-script.ts` | **NEW** - Combined LLM proxy + MITM proxy + WebSocket tunnel bridge for Daytona |
| `apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts` | Updated to deploy combined proxy service with secrets and CA certificates |
| `libs/orchestrator/src/lib/bridge-script.ts` | Enhanced with TCP-to-WebSocket tunnel client on port 9339 |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Updated for Daytona: HTTPS_PROXY=localhost:9339, tunnel URL passing |
| `libs/orchestrator/src/index.ts` | Exports combined proxy service script |

### Agent Integration
| File | Role |
|---|---|
| `libs/orchestrator/src/lib/mcp-terminal-script.ts` | `list_secrets` MCP tool |
| `libs/orchestrator/src/lib/bridge-script.ts` | `/internal/list-secrets` bridge endpoint |

## Known Behaviors

- `findByDomain` is not user-scoped — any row matching the domain triggers MITM
- Multiple secrets for the same domain: proxy uses the first matching row
- Placeholder env var map in `projects.service` uses `secretsService.list(userId)` without `projectId`, so all user secret names get placeholders globally (not per-project subset)
- Update does not trigger `reinitSandboxManager()` (only create and delete do)
