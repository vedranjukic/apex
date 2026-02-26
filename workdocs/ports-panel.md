# Ports Panel

> Periodic port scanning inside Daytona sandboxes with forwarded-port preview URLs, displayed in a bottom-panel tab and status bar indicator.

## Overview

The ports panel automatically discovers processes listening on TCP ports inside the sandbox, displays them in a dedicated tab in the bottom panel (alongside terminals), and lets users open preview URLs via the Daytona SDK. A status bar indicator shows the live port count.

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
      → SandboxManager.getPortPreviewUrl() calls Daytona SDK
    ← emits `port_preview_url_result { port, url }` back to client
  → Dashboard opens URL in new browser tab
```

## File Map

| File | Purpose |
|------|---------|
| `libs/orchestrator/src/lib/bridge-script.ts` | Port scanner: `parseNetstatOutput()`, 3-second `setInterval`, change detection via JSON comparison |
| `libs/orchestrator/src/lib/types.ts` | `PortInfo` and `BridgePortsUpdate` interfaces, included in `BridgeMessage` union |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | `ports_update` event in `SandboxManagerEvents`, handler in WS message block, `getPortPreviewUrl()` method |
| `apps/api/src/modules/agent/agent.gateway.ts` | `ports_update` forwarding in `attachTerminalListeners()`, `@SubscribeMessage('port_preview_url')` handler |
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

### Preview URL Request (frontend → orchestrator → Daytona SDK)

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

The server calls `sandbox.getPreviewLink(port)` from the Daytona SDK, which returns a proxied public URL for the port.

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
