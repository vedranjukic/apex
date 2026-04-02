# Port Relay Service Implementation

## Overview

I have successfully implemented the PortRelayService to coordinate port relay operations between WebSocket events and port forwarding in the Apex platform. This service provides a centralized way to manage automatic port forwarding and manual port relay controls.

## Files Created/Modified

### 1. New Service: `apps/api/src/modules/preview/port-relay.service.ts`

**Key Features:**
- **State Management**: Tracks auto-forwarding settings, active forwards, and port information per project
- **Auto-forwarding**: Automatically forwards TCP ports when new ports are detected in sandboxes
- **Manual Control**: Provides API for manually forwarding/unforwarding specific ports
- **Event System**: Emits real-time events for UI updates
- **Configuration**: Configurable port ranges, exclusions, and limits
- **Provider Support**: Only supports local providers (Docker, Apple Container) for security

**Core Methods:**
- `initializeProject(projectId)` - Set up port relay for a project
- `setAutoForward(projectId, enabled)` - Enable/disable automatic forwarding
- `forwardPort(projectId, remotePort, preferredLocalPort?)` - Manual port forwarding
- `unforwardPort(projectId, remotePort)` - Stop forwarding a port
- `handlePortsUpdate(projectId, portsUpdate)` - Handle bridge ports_update events
- `getRelayStatus(projectId)` - Get current forwarding status
- `cleanupProject(projectId)` - Clean up when project stops

### 2. WebSocket Integration: `apps/api/src/modules/agent/agent.ws.ts`

**Message Handlers Added:**

#### `auto_forward_ports`
```typescript
{
  type: 'auto_forward_ports',
  payload: { projectId: string, enabled: boolean }
}
// Response: auto_forward_ports_result
```

#### `set_port_relay`
```typescript
{
  type: 'set_port_relay',
  payload: { 
    action: 'forward' | 'unforward',
    projectId: string, 
    remotePort: number,
    preferredLocalPort?: number
  }
}
// Response: set_port_relay_result
```

#### `get_relay_status`
```typescript
{
  type: 'get_relay_status',
  payload: { projectId: string }
}
// Response: get_relay_status_result
```

**Event Integration:**
- Connected to existing `ports_update` bridge messages for automatic triggering
- Emits `port_forwards_updated` and `auto_forward_status_changed` events to clients
- Initializes port relay service when projects are accessed
- Proper error handling and timeout management

## Service Architecture

### State Management
```typescript
interface PortRelayState {
  projectId: string;
  sandboxId: string;
  autoForwardEnabled: boolean;
  lastKnownPorts: PortInfo[];
  activeForwards: Map<number, number>; // remotePort -> localPort
  provider: string;
}
```

### Configuration
```typescript
interface PortRelayConfig {
  enableAutoForward: boolean;
  excludedPorts: number[];           // [8080, 8443, 8888, 3001]
  maxAutoForwards: number;           // 10
  supportedProviders: string[];      // ['docker', 'apple-container']
}
```

### Event System
```typescript
interface PortRelayEvent {
  type: 'port_forwards_updated' | 'auto_forward_status_changed';
  projectId: string;
  payload: {
    forwards?: Array<{ remotePort: number; localPort: number; status: string }>;
    autoForwardEnabled?: boolean;
    error?: string;
  };
}
```

## Integration Points

### 1. Enhanced Port Forwarder
- Uses existing `forwardPortWithRange()`, `unforwardPort()`, `autoForwardPorts()` functions
- Leverages enhanced conflict resolution and health monitoring
- Integrates with port status reporting

### 2. Bridge Message Flow
```
Sandbox → Bridge → SandboxManager → ports_update event → PortRelayService → WebSocket clients
```

### 3. Project Lifecycle
- Automatic initialization when projects are first accessed
- Cleanup when projects are disconnected
- Reactive setup (initializes on-demand rather than eagerly)

## Security Considerations

1. **Provider Restriction**: Only local providers (Docker, Apple Container) support port forwarding
2. **Port Exclusions**: Excludes system ports and proxy ports by default
3. **Rate Limiting**: Maximum number of auto-forwards per project
4. **Error Isolation**: Failed forwards don't affect other operations

## Usage Flow

### Automatic Port Forwarding
1. User enables auto-forwarding via WebSocket message
2. Bridge detects new ports in sandbox
3. PortRelayService receives ports_update event
4. Service automatically forwards TCP ports (excluding system ports)
5. Clients receive `port_forwards_updated` events with new forwards

### Manual Port Control
1. User requests specific port forward via WebSocket
2. PortRelayService creates forward using enhanced port forwarder
3. Service updates internal state and emits events
4. Client receives confirmation with local port assignment

### Status Monitoring
1. Clients can query current forwarding status
2. Real-time events keep UI synchronized
3. Health monitoring detects failed forwards
4. Automatic cleanup when projects disconnect

## Testing

Created `test-port-relay-service.js` to verify:
- Service instantiation and configuration
- Event handling and emission
- State management operations
- Error handling and cleanup

## Next Steps

The PortRelayService is now ready for frontend integration. The UI components can use the WebSocket messages to:

1. **Enable/disable auto-forwarding** per project
2. **Manually control specific port forwards**
3. **Monitor real-time forwarding status**
4. **Display forwarded ports with localhost URLs**
5. **Handle forwarding errors gracefully**

The service integrates seamlessly with the existing port forwarding infrastructure while providing the coordination layer needed for user-friendly port relay features.