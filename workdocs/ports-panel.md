# Ports Panel

> Periodic port scanning inside sandboxes with preview URLs, displayed in a bottom-panel tab and status bar indicator.

## Overview

The ports panel automatically discovers processes listening on TCP ports inside the sandbox, displays them in a dedicated tab in the bottom panel (alongside terminals), and lets users open preview URLs. For Daytona (cloud) sandboxes, preview URLs come from the Daytona SDK. For Docker and Apple Container (local) sandboxes, the API's built-in preview proxy serves requests via `/preview/:projectId/:port/`. A status bar indicator shows the live port count.

## Architecture

```
Bridge (sandbox)
  → runs `netstat -tlnp` every 3 seconds
  → parses output, deduplicates, filters internal ports
  → sends `ports_update` via WebSocket (only when list changes)
    → SandboxManager emits `ports_update` event
      → AgentGateway forwards to Socket.io subscribers
        → Dashboard updates ports store → UI re-renders

Preview URL (lazy, on user click):
  Dashboard emits `port_preview_url { projectId, port }`
    → AgentGateway resolves sandbox
      → Daytona: SandboxManager.getPortPreviewUrl() calls SDK → public URL
      → Docker/Apple Container: returns `/preview/<projectId>/<port>` proxy path
    ← emits `port_preview_url_result { port, url }` back to client
  → Dashboard opens URL in new browser tab

Preview Proxy (Docker / Apple Container only):
  Browser requests `/preview/<projectId>/<port>/...`
    → Elysia onRequest handler (preview.routes.ts)
      → Resolves project → sandbox IP via manager.getPortPreviewUrl()
      → Proxies HTTP request to http://<container-ip>:<port>/...
    ← Returns upstream response to browser
```

## File Map

| File | Purpose |
|------|---------|
| `libs/orchestrator/src/lib/bridge-script.ts` | Port scanner: `parseNetstatOutput()`, 3-second `setInterval`, change detection via JSON comparison. Also `get_preview_url` MCP endpoint that returns proxy URLs for local providers or Daytona signed URLs for cloud. |
| `libs/orchestrator/src/lib/types.ts` | `PortInfo` and `BridgePortsUpdate` interfaces, included in `BridgeMessage` union |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | `ports_update` event in `SandboxManagerEvents`, handler in WS message block, `getPortPreviewUrl()` method, `registerProjectId()` for proxy URL generation |
| `apps/api/src/modules/agent/agent.ws.ts` | `ports_update` forwarding, `port_preview_url` handler (returns proxy path for local providers), `forward_port`/`unforward_port` TCP forwarding |
| `apps/api/src/modules/preview/preview.routes.ts` | HTTP reverse proxy: `/preview/:projectId/:port/*` → container IP |
| `apps/api/src/modules/preview/port-forwarder.ts` | TCP port forwarding for Docker/Apple Container sandboxes (used by the desktop app) |
| `apps/dashboard/src/stores/ports-store.ts` | Zustand store: `ports` array, `setPorts`, `reset` |
| `apps/dashboard/src/hooks/use-ports-socket.ts` | Socket hook: listens for `ports_update`, exposes `requestPreviewUrl(port)` with promise-based one-shot listener |
| `apps/dashboard/src/stores/terminal-store.ts` | Extended with `activeBottomTab: 'terminals' \| 'ports'` and `setActiveBottomTab` action |
| `apps/dashboard/src/components/terminal/terminal-tabs.tsx` | "Ports" tab button with port count badge, right-aligned in tab bar |
| `apps/dashboard/src/components/terminal/terminal-panel.tsx` | Switches viewport between terminal tabs and `PortsPanel` based on `activeBottomTab` |
| `apps/dashboard/src/components/ports/ports-panel.tsx` | Port list table: port number, process name, "Open Preview" button |
| `apps/dashboard/src/components/layout/project-status-bar.tsx` | Ports indicator (Radio icon + count) in the right-aligned section of the status bar |
| `apps/dashboard/src/pages/project-page.tsx` | Wires `usePortsSocket` hook and passes `requestPreviewUrl` to `TerminalPanel` |

## Bridge Protocol

### Port Scanning (sandbox → orchestrator → frontend)

The bridge runs `netstat -tlnp` every 3 seconds and sends updates only when the port list changes:

**Bridge → SandboxManager**: `ports_update`
```json
{
  "type": "ports_update",
  "ports": [
    { "port": 3000, "protocol": "tcp", "process": "python3" },
    { "port": 5173, "protocol": "tcp", "process": "node" }
  ]
}
```

**Filtered ports** (never included in results):
- Bridge port (8080) and VS Code port (9090)
- SSH (22)
- Localhost-only listeners (127.x.x.x, ::1)
- `daytona-daemon` processes

### Preview URL Request (frontend → orchestrator → provider-specific)

**Client → Server**: `port_preview_url`
```typescript
{ projectId: string; port: number }
```

**Server → Client**: `port_preview_url_result`
```typescript
{ port: number; url: string; token: string }
// or on error:
{ port: number; error: string }
```

The URL returned depends on the project's provider:
- **Daytona**: calls `sandbox.getPreviewLink(port)` which returns a Daytona platform proxied URL with a token
- **Docker / Apple Container**: returns `/preview/<projectId>/<port>` — a local reverse proxy path handled by `preview.routes.ts`

### TCP Port Forwarding (Docker / Apple Container only)

For local sandboxes, the frontend can request a TCP tunnel via the `forward_port` event. The API binds a local port and pipes TCP connections to the container IP. This is primarily used by the desktop app where `localhost` URLs are needed.

**Client → Server**: `forward_port`
```typescript
{ projectId: string; port: number }
```

**Server → Client**: `forward_port_result`
```typescript
{ port: number; localPort: number; url: string }
// or on error:
{ port: number; error: string }
```

### Bridge `get_preview_url` MCP Tool

Agents inside the sandbox use the `get_preview_url` MCP tool to obtain preview URLs for ports they start. The bridge checks env vars to decide the URL strategy:

1. If `APEX_PROXY_BASE_URL` and `APEX_PROJECT_ID` are set (Docker/Apple Container): returns `<proxyBaseUrl>/preview/<projectId>/<port>`
2. If `DAYTONA_API_KEY` and `DAYTONA_SANDBOX_ID` are set (Daytona): calls the Daytona API for a signed preview URL
3. Otherwise: returns an error

## UI Components

### Bottom Panel Integration

The ports tab is integrated into the existing terminal panel's tab bar. The `activeBottomTab` state in the terminal store controls which view is shown:

- **`'terminals'`** (default): shows terminal tabs and xterm viewports as before
- **`'ports'`**: shows the `PortsPanel` component with the port list table

Clicking any terminal tab automatically switches back to `'terminals'`. Clicking the "Ports" tab switches to `'ports'`.

### Status Bar Indicator

A button in the right-aligned section of the project status bar shows a Radio (broadcast tower) icon and the current port count. Clicking it opens the bottom panel and switches to the ports tab.

## Bridge Script Details

The port scanner in the bridge uses `netstat -tlnp` (not `ss`) since `net-tools` is reliably available in Daytona sandboxes. Key implementation details:

- **Change detection**: compares `JSON.stringify(ports)` against the last sent value; only sends when different
- **Deduplication**: uses a `Set` to ensure each port appears only once (tcp4 and tcp6 may both listen on the same port)
- **Error handling**: `spawn` is wrapped in try/catch with an `error` event handler so a missing `netstat` binary doesn't crash the interval
- **Internal port filtering**: the bridge port, VS Code port, SSH, and `daytona-daemon` processes are excluded from results

## How to Add / Remove Filtered Ports

To filter additional ports, edit the `INTERNAL_PORTS` set in `bridge-script.ts`:
```typescript
const INTERNAL_PORTS = new Set([${port}, 9090, 22]);
```

To filter additional process names, add conditions in the `parseNetstatOutput` function:
```typescript
if (proc === "daytona-daemon") continue;
```

After changes, the bridge script must be re-uploaded to the sandbox. This happens automatically on sandbox creation, bridge restart, or reconnect (the script file is re-uploaded on every `reconnectSandbox` call).
