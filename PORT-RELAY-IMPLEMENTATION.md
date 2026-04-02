# Port Relay Implementation for Electron Desktop App

This document describes the implementation of the port relay functionality for the Electron desktop application, allowing automatic and manual forwarding of sandbox ports to localhost.

## Overview

The port relay system provides:
- **Automatic port forwarding** when new ports are detected in sandboxes
- **Manual port control** for users to forward/unforward specific ports
- **Configurable port ranges** and exclusions
- **Real-time status updates** via WebSocket events
- **Persistent configuration** stored in user data directory

## Architecture

### Components

1. **PortRelayManager** (`apps/desktop/src/bun/port-relay-manager.ts`)
   - Core logic for TCP port forwarding
   - Configuration management and persistence
   - Event system for status updates

2. **RPC Extensions** (`apps/desktop/src/shared/rpc-types.ts`)
   - Type definitions for port relay configuration
   - Request/response interfaces for main-renderer communication

3. **Main Process Integration** (`apps/desktop/src/bun/index.ts`)
   - WebSocket connection to API for port events
   - RPC handlers for renderer requests
   - Event forwarding to all windows

4. **Preload Script** (`apps/desktop/src/preload/index.ts`)
   - Exposed API functions on `window.apex`
   - Event callback system for UI updates

## Key Features

### 1. Configuration Management

```typescript
interface PortRelayConfig {
  enabled: boolean;                    // Master enable/disable
  autoForwardNewPorts: boolean;        // Auto-forward new detected ports
  portRange: {                         // Local port allocation range
    start: number;                     // Default: 8000
    end: number;                       // Default: 9000
  };
  excludedPorts: number[];             // Ports to never forward
}
```

**Configuration Storage:**
- Stored as JSON in user data directory (`port-relay-config.json`)
- Loaded on startup with fallback to sensible defaults
- Changes are persisted immediately and broadcast to all windows

### 2. Port Forwarding Logic

**Automatic Forwarding:**
```typescript
// Triggered by WebSocket 'ports_update' events from API
async handleNewPorts(sandboxId: string, remoteHost: string, ports: PortInfo[]): Promise<void>
```

- Filters for TCP ports only
- Excludes already forwarded ports
- Respects excluded ports configuration
- Creates forwards in parallel with error handling

**Manual Forwarding:**
```typescript
// Exposed via RPC for renderer control
async forwardPort(sandboxId: string, remoteHost: string, remotePort: number, localPort?: number): Promise<number>
```

- Supports preferred local port selection
- Falls back to port range allocation if preferred port unavailable
- Returns existing forward if port already forwarded

### 3. Port Allocation Strategy

1. **Preferred Port**: If specified, attempt to use the exact port
2. **Range Allocation**: Search within configured range (8000-9000 by default)
3. **Exclusion Filtering**: Skip ports marked as excluded
4. **Conflict Resolution**: Automatic fallback to next available port

### 4. WebSocket Integration

**Event Listening:**
- Connects to API WebSocket endpoint (`/socket.io/`)
- Listens for `ports_update` events with new port discoveries
- Handles Socket.io protocol parsing for event extraction

**Event Format:**
```javascript
// Incoming from API
{
  type: 'ports_update',
  data: {
    projectId: 'project-id',
    ports: [{ port: 3000, protocol: 'tcp' }, ...]
  }
}
```

### 5. Status Tracking

**RelayedPort Interface:**
```typescript
interface RelayedPort {
  remotePort: number;      // Original sandbox port
  localPort: number;       // Assigned localhost port  
  sandboxId: string;       // Associated sandbox
  status: 'active' | 'failed' | 'stopped';
  error?: string;          // Error message if failed
  createdAt: number;       // Timestamp of creation
}
```

**Real-time Updates:**
- Status changes broadcast to all renderer windows
- Per-sandbox port lists maintained
- Connection monitoring and error reporting

## API Surface

### Renderer API (window.apex)

```typescript
// Configuration
getPortRelayConfig(): Promise<PortRelayConfig>
setPortRelayConfig(config: PortRelayConfig): Promise<{ok: boolean, error?: string}>

// Port Control
forwardPort(params: {
  sandboxId: string, 
  remotePort: number, 
  localPort?: number
}): Promise<{ok: boolean, localPort?: number, error?: string}>

unforwardPort(params: {
  sandboxId: string, 
  remotePort: number
}): Promise<{ok: boolean, error?: string}>

// Status Query
getRelayedPorts(params?: {sandboxId?: string}): Promise<{ports: RelayedPort[]}>

// Event Callbacks
onPortRelayConfigUpdate: (config: PortRelayConfig) => void
onPortRelayStatusUpdate: (sandboxId: string, ports: RelayedPort[]) => void
```

### Example Usage

```typescript
// Enable port relay with custom configuration
await window.apex.setPortRelayConfig({
  enabled: true,
  autoForwardNewPorts: true,
  portRange: { start: 8000, end: 9000 },
  excludedPorts: [8080, 8443]
});

// Manually forward a specific port
const result = await window.apex.forwardPort({
  sandboxId: 'my-sandbox',
  remotePort: 3000,
  localPort: 8080  // Optional preferred port
});

if (result.ok) {
  console.log(`Port forwarded to localhost:${result.localPort}`);
}

// Listen for status updates
window.apex.onPortRelayStatusUpdate = (sandboxId, ports) => {
  console.log(`Sandbox ${sandboxId} ports:`, ports);
};
```

## Error Handling

### Common Error Scenarios

1. **Port Unavailable**: Graceful fallback to alternative ports in range
2. **Connection Failures**: Logged with retry mechanisms for auto-forwarding
3. **Configuration Errors**: Validation with sensible defaults
4. **WebSocket Disconnections**: Automatic reconnection with exponential backoff

### Error Reporting

- All errors logged to console with `[port-relay]` prefix
- User-facing errors returned in API responses
- Status updates include error information for failed forwards

## File Structure

```
apps/desktop/src/
├── bun/
│   ├── index.ts                    # Main process integration
│   └── port-relay-manager.ts      # Core port relay logic
├── preload/
│   └── index.ts                   # Renderer API exposure
└── shared/
    └── rpc-types.ts              # Type definitions
```

## Testing

A test suite is provided in `test-port-relay.js` that validates:
- Port allocation logic
- Configuration management
- Event handling and filtering
- Error scenarios and edge cases

Run with: `node test-port-relay.js`

## Integration Points

### With Existing Systems

1. **Port Scanner**: Receives port updates via WebSocket from API
2. **Sandbox Providers**: Uses existing port-forwarder.ts for TCP tunneling
3. **UI Components**: Can integrate with ports panel for relay status display
4. **Settings System**: Configuration persistence in user data directory

### Future Enhancements

1. **UI Integration**: Port relay controls in dashboard ports panel
2. **Advanced Routing**: Support for hostname-based routing rules  
3. **Protocol Support**: UDP forwarding and other protocols
4. **Load Balancing**: Multiple local ports for high-availability services
5. **Security**: SSL/TLS termination and authentication integration

## Security Considerations

- All forwards bound to `127.0.0.1` only (localhost)
- No external network access by default
- Configuration stored in user-only accessible directory
- TCP connections properly cleaned up on shutdown
- Input validation on all port numbers and configuration values

## Performance

- Minimal overhead for inactive functionality
- Efficient port scanning with caching
- Connection pooling for active forwards
- Graceful cleanup of stale connections
- Memory usage scales with number of active forwards only