# Port Relay Developer Guide

This guide covers the technical implementation details, architecture, and APIs for the Port Relay system. It's intended for developers who need to understand, modify, or extend the port forwarding functionality. The system implements a sophisticated multi-layered architecture with automatic port detection, intelligent conflict resolution, health monitoring, and cross-provider compatibility.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Components](#core-components)
- [API Reference](#api-reference)
- [RPC Communication](#rpc-communication)
- [Event System](#event-system)
- [Extension Points](#extension-points)
- [Testing](#testing)
- [Development Setup](#development-setup)

## Architecture Overview

### System Components

The Port Relay system consists of several layered components:

```
┌─────────────────────────────────────────────────────┐
│                   Frontend                          │
│  - Ports Panel UI (React)                          │
│  - Zustand Store (ports-store.ts)                  │
│  - WebSocket Event Handlers                        │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│                  API Layer                          │
│  - PortRelayService (port-relay.service.ts)        │
│  - WebSocket Events (ports updates)                │
│  - HTTP Endpoints (/api/port-relay/*)              │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│              Core Engine                            │
│  - PortForwarder (port-forwarder.ts)               │
│  - TCP Server Management                           │
│  - Health Monitoring                               │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│             Desktop Layer                           │
│  - PortRelayManager (port-relay-manager.ts)        │
│  - RPC Bridge (Electrobun)                         │
│  - Native TCP Forwarding                           │
└─────────────────────────────────────────────────────┘
```

### Data Flow

1. **Port Detection**: Bridge scans sandbox ports and sends updates via WebSocket
2. **Event Processing**: PortRelayService processes port updates and manages state  
3. **Auto-forwarding**: New ports trigger automatic forwarding if enabled
4. **User Actions**: Manual forward/unforward requests from UI
5. **Desktop Integration**: RPC calls to PortRelayManager for native forwarding
6. **Health Monitoring**: Background health checks and status updates

### Communication Patterns

#### Web Interface
```
UI → HTTP API → PortRelayService → PortForwarder → TCP Tunnel → Sandbox
```

#### Desktop App
```
UI → RPC → PortRelayManager → TCP Server → WebSocket Tunnel → Sandbox
```

## Core Components

### PortRelayService

The central orchestration service that coordinates port relay operations across the entire system.

**Location**: `apps/api/src/modules/preview/port-relay.service.ts`

**Key Responsibilities**:
- **Project State Management**: Maintains per-project relay state including auto-forwarding settings, active forwards, and last known ports
- **Event Processing**: Handles WebSocket `ports_update` events from the sandbox bridge and processes them for auto-forwarding
- **Service Coordination**: Coordinates with PortForwarder for low-level TCP forwarding operations
- **Real-time Events**: Emits `port_forwards_updated` and `auto_forward_status_changed` events to connected WebSocket clients
- **Policy Enforcement**: Enforces configuration policies including excluded ports, maximum forwards, and provider restrictions
- **Health Integration**: Integrates with health monitoring system for forward status tracking
- **Cleanup Management**: Handles project lifecycle events including initialization and cleanup

**State Management**:
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

### PortForwarder

The enhanced low-level port forwarding engine that creates and manages TCP tunnels with advanced automation capabilities.

**Location**: `apps/api/src/modules/preview/port-forwarder.ts`

**Core Features**:
- **TCP Server Management**: Creates and manages local TCP servers for port binding with proper cleanup
- **Advanced Conflict Resolution**: Intelligent port allocation using configurable ranges (default 8000-9000) with excluded ports support
- **Batch Processing**: `autoForwardPorts()` method for efficiently forwarding multiple ports in parallel
- **Health Monitoring**: Optional periodic health checks with configurable intervals and automatic failure detection
- **Connection Pooling**: Manages multiple simultaneous connections per forward with proper resource tracking
- **Range-Based Allocation**: `forwardPortWithRange()` provides smart port allocation with preferred port support and fallback
- **Status Tracking**: Comprehensive status reporting with connection counts, timestamps, and error details
- **Thread Safety**: Proper cleanup of timers, connections, and resources to prevent memory leaks

**Enhanced Methods**:
```typescript
// Smart port allocation with range support
forwardPortWithRange(sandboxId: string, remoteHost: string, remotePort: number, preferredLocalPort?: number): Promise<number>

// Batch forwarding with individual error handling  
autoForwardPorts(sandboxId: string, remoteHost: string, ports: PortInfo[]): Promise<Array<{remotePort: number; localPort?: number; error?: string}>>

// Enhanced status reporting
getPortStatus(sandboxId?: string): PortStatus[]

// Runtime configuration management
setConfig(config: Partial<PortForwarderConfig>): void
getConfig(): PortForwarderConfig
```

**Forward Entry Structure**:
```typescript
interface ForwardEntry {
  server: Server;                    // Local TCP server instance
  localPort: number;                 // Bound local port number
  remoteHost: string;                // Target host in sandbox (e.g., 'localhost', container IP)
  remotePort: number;                // Target port in sandbox
  sandboxId: string;                 // Associated sandbox identifier
  connections: Set<Socket>;          // Set of active client connections
  createdAt: number;                 // Unix timestamp of creation
  status: 'active' | 'failed' | 'stopped';  // Current forward status
  error?: string;                    // Error message if failed
  healthCheckInterval?: NodeJS.Timeout;     // Health monitoring timer
  connectionCount: number;           // Current number of connections
  totalConnections: number;          // Total connections since creation
  bytesTransferred: number;          // Total bytes transferred
  lastActivity: number;              // Timestamp of last activity
}

// Configuration interface
interface PortForwarderConfig {
  portRange: { start: number; end: number };    // Local port allocation range
  excludedPorts: number[];                      // Ports to never allocate
  enableHealthChecks: boolean;                  // Enable periodic health monitoring
  healthCheckInterval: number;                  // Health check interval in ms
  connectionTimeout: number;                    // TCP connection timeout
  maxConcurrentForwards: number;                // Maximum simultaneous forwards
  retryAttempts: number;                        // Retry attempts for failed forwards
}
```

### PortRelayManager (Desktop)

Desktop-specific port relay manager that handles native forwarding via Electrobun RPC.

**Location**: `apps/desktop/src/bun/port-relay-manager.ts`

**Desktop-Specific Features**:
- Native TCP server creation
- Persistent configuration storage
- Operating system integration
- Event emission to frontend
- Multi-sandbox management

### Frontend Integration

The frontend uses Zustand for state management and Socket.io for real-time updates.

**Store**: `apps/dashboard/src/stores/ports-store.ts`

**Key State**:
```typescript
interface PortsState {
  projectId: string | null;
  ports: PortInfo[];              // Auto-detected ports
  userPorts: number[];            // Manually added ports
  previewUrls: Record<number, string>;
  closedPorts: number[];          // User-suppressed ports
  portRelays: Record<number, PortRelay>; // Desktop forwarding info
}
```

## API Reference

### PortRelayService API

#### Core Methods

##### `initializeProject(projectId: string): Promise<void>`
Initialize port relay state for a project.

```typescript
// Usage
await portRelayService.initializeProject('project-123');
```

##### `setAutoForward(projectId: string, enabled: boolean): Promise<{success: boolean; error?: string}>`
Enable or disable automatic port forwarding.

```typescript
// Enable auto-forwarding
const result = await portRelayService.setAutoForward('project-123', true);
if (!result.success) {
  console.error('Failed to enable auto-forward:', result.error);
}
```

##### `forwardPort(projectId: string, remotePort: number, preferredLocalPort?: number): Promise<{success: boolean; localPort?: number; error?: string}>`
Manually forward a specific port.

```typescript
// Forward port 3000 to a preferred local port 8001
const result = await portRelayService.forwardPort('project-123', 3000, 8001);
if (result.success) {
  console.log(`Port forwarded to localhost:${result.localPort}`);
}
```

##### `unforwardPort(projectId: string, remotePort: number): Promise<{success: boolean; error?: string}>`
Stop forwarding a specific port.

```typescript
const result = await portRelayService.unforwardPort('project-123', 3000);
```

##### `getRelayStatus(projectId: string): PortRelayStatus | null`
Get current relay status for a project.

```typescript
const status = portRelayService.getRelayStatus('project-123');
if (status) {
  console.log('Auto-forward enabled:', status.autoForwardEnabled);
  console.log('Active forwards:', status.forwards.length);
}
```

#### Event System

##### `onEvent(callback: (event: PortRelayEvent) => void): () => void`
Subscribe to port relay events.

```typescript
const unsubscribe = portRelayService.onEvent((event) => {
  switch (event.type) {
    case 'port_forwards_updated':
      console.log('Forwards updated:', event.payload.forwards);
      break;
    case 'auto_forward_status_changed':
      console.log('Auto-forward changed:', event.payload.autoForwardEnabled);
      break;
  }
});

// Later...
unsubscribe();
```

#### Configuration Management

##### `getConfig(): PortRelayConfig`
Get current configuration.

##### `updateConfig(newConfig: Partial<PortRelayConfig>): void`
Update configuration.

```typescript
portRelayService.updateConfig({
  maxAutoForwards: 15,
  excludedPorts: [8080, 8443, 9000]
});
```

### PortForwarder API

#### Port Management

##### `forwardPortWithRange(sandboxId: string, remoteHost: string, remotePort: number, preferredLocalPort?: number): Promise<number>`
Forward a port with automatic conflict resolution.

```typescript
const localPort = await forwardPortWithRange(
  'sandbox-456',
  'container-host',
  3000,
  8001  // preferred local port
);
console.log(`Service accessible at localhost:${localPort}`);
```

##### `autoForwardPorts(sandboxId: string, remoteHost: string, ports: PortInfo[]): Promise<Array<{remotePort: number; localPort?: number; error?: string}>>`
Bulk forward multiple ports with error handling.

```typescript
const results = await autoForwardPorts('sandbox-456', 'host', [
  { port: 3000, protocol: 'tcp' },
  { port: 8080, protocol: 'tcp' },
]);

results.forEach(result => {
  if (result.localPort) {
    console.log(`${result.remotePort} → localhost:${result.localPort}`);
  } else {
    console.error(`Failed to forward ${result.remotePort}: ${result.error}`);
  }
});
```

##### `getPortStatus(sandboxId?: string): PortStatus[]`
Get detailed status of all forwards.

```typescript
const statuses = getPortStatus('sandbox-456');
statuses.forEach(status => {
  console.log(`Port ${status.remotePort}: ${status.status} (${status.connectionCount} connections)`);
});
```

#### Configuration

##### `setConfig(newConfig: Partial<PortForwarderConfig>): void`
Update port forwarder configuration.

```typescript
setConfig({
  portRange: { start: 8000, end: 9000 },
  excludedPorts: [8080, 8443],
  enableHealthChecks: true,
  healthCheckInterval: 30000
});
```

### RPC API (Desktop)

The desktop app exposes RPC methods for port relay operations.

#### Available RPC Methods

##### `getPortRelayConfig(): PortRelayConfig`
Get current desktop port relay configuration.

##### `setPortRelayConfig(config: PortRelayConfig): {ok: boolean; error?: string}`
Update desktop configuration.

##### `forwardPort(params: {sandboxId: string; remotePort: number; localPort?: number}): {ok: boolean; localPort?: number; error?: string}`
Forward a port via desktop manager.

##### `unforwardPort(params: {sandboxId: string; remotePort: number}): {ok: boolean; error?: string}`
Stop port forwarding.

##### `getRelayedPorts(params: {sandboxId?: string}): {ports: RelayedPort[]}`
Get list of currently forwarded ports.

## RPC Communication

### Desktop RPC Integration

The desktop app uses Electrobun's RPC system to communicate between the frontend and Bun backend.

**RPC Schema**: `apps/desktop/src/shared/rpc-types.ts`

**Usage Example**:
```typescript
// Frontend code
const result = await rpc.bun.forwardPort({
  sandboxId: 'sandbox-123',
  remotePort: 3000,
  localPort: 8001  // optional
});

if (result.ok) {
  console.log(`Port forwarded to localhost:${result.localPort}`);
} else {
  console.error('Forward failed:', result.error);
}
```

### Message Types

#### Request Messages
```typescript
interface ForwardPortRequest {
  sandboxId: string;
  remotePort: number;
  localPort?: number;
}
```

#### Response Messages
```typescript
interface ForwardPortResponse {
  ok: boolean;
  localPort?: number;
  error?: string;
}
```

#### Event Messages
```typescript
interface PortRelayStatusUpdate {
  sandboxId: string;
  ports: RelayedPort[];
}
```

## Event System

### Event Types

The port relay system emits various events for real-time updates:

```typescript
interface PortRelayEvent {
  type: 'port_forwards_updated' | 'auto_forward_status_changed';
  projectId: string;
  payload: {
    forwards?: Array<{remotePort: number; localPort: number; status: string}>;
    autoForwardEnabled?: boolean;
    error?: string;
  };
}
```

### WebSocket Events

Port updates are communicated via WebSocket:

#### `ports-update` Event
```typescript
// Received from bridge when ports change
{
  projectId: 'project-123',
  ports: [
    { port: 3000, protocol: 'tcp', process: 'npm run dev', command: 'node server.js' }
  ]
}
```

#### `port-relay-status` Event  
```typescript
// Emitted when forwarding status changes
{
  projectId: 'project-123',
  forwards: [
    { remotePort: 3000, localPort: 8001, status: 'active' }
  ]
}
```

### Frontend Event Handling

```typescript
// In React component
useEffect(() => {
  const unsubscribe = socket.on('port-relay-status', (data) => {
    portsStore.updatePortRelays(data.forwards);
  });
  
  return unsubscribe;
}, []);
```

## Extension Points

### Custom Port Providers

You can extend the system to support additional sandbox providers:

```typescript
interface PortProvider {
  name: string;
  getPortPreviewUrl(sandboxId: string, port: number): Promise<{url: string}>;
  isSupported(): boolean;
}

// Register a custom provider
portRelayService.registerProvider(new CustomProvider());
```

### Health Check Strategies

Implement custom health checking:

```typescript
interface HealthChecker {
  check(entry: ForwardEntry): Promise<boolean>;
  interval: number;
}

// Register custom health checker
setHealthChecker(new CustomHealthChecker());
```

### Port Allocation Strategies

Customize port allocation logic:

```typescript
interface PortAllocator {
  allocatePort(preferredPort?: number): Promise<number>;
  releasePort(port: number): void;
}

// Use custom allocator
setPortAllocator(new CustomPortAllocator());
```

## Testing

### Unit Tests

#### Testing PortRelayService

```typescript
import { PortRelayService } from './port-relay.service';

describe('PortRelayService', () => {
  let service: PortRelayService;
  
  beforeEach(() => {
    service = new PortRelayService({
      enableAutoForward: true,
      excludedPorts: [8080],
      maxAutoForwards: 5
    });
  });
  
  test('should initialize project', async () => {
    await service.initializeProject('test-project');
    const state = service.getAllStates().get('test-project');
    expect(state).toBeDefined();
    expect(state.autoForwardEnabled).toBe(false); // Default disabled
  });
});
```

#### Testing PortForwarder

```typescript
import { forwardPortWithRange, unforwardPort } from './port-forwarder';

describe('PortForwarder', () => {
  test('should forward port with conflict resolution', async () => {
    const localPort = await forwardPortWithRange(
      'sandbox-123',
      'localhost',
      3000
    );
    
    expect(localPort).toBeGreaterThan(0);
    expect(localPort).toBeLessThan(65536);
    
    // Clean up
    unforwardPort('sandbox-123', 3000);
  });
});
```

### Integration Tests

#### E2E Port Relay Test

```typescript
describe('Port Relay E2E', () => {
  test('should auto-forward new ports', async () => {
    // Start test server in sandbox
    const testServer = await startTestServer(3000);
    
    // Enable auto-forwarding
    await portRelayService.setAutoForward('test-project', true);
    
    // Simulate port update
    await portRelayService.handlePortsUpdate('test-project', {
      ports: [{ port: 3000, protocol: 'tcp' }]
    });
    
    // Verify forwarding
    const status = portRelayService.getRelayStatus('test-project');
    expect(status.forwards).toHaveLength(1);
    expect(status.forwards[0].remotePort).toBe(3000);
    
    // Test connectivity
    const response = await fetch(`http://localhost:${status.forwards[0].localPort}`);
    expect(response.ok).toBe(true);
    
    // Cleanup
    await testServer.close();
  });
});
```

### Mock Utilities

```typescript
// Mock sandbox manager
export class MockSandboxManager {
  async getPortPreviewUrl(sandboxId: string, port: number) {
    return { url: `http://mock-${sandboxId}.example.com:${port}` };
  }
}

// Mock WebSocket events
export function mockPortsUpdate(projectId: string, ports: PortInfo[]) {
  return {
    type: 'ports-update',
    projectId,
    ports
  };
}
```

## Development Setup

### Prerequisites

- Node.js 18+
- Bun (for desktop app)
- Docker (for testing with containers)

### Running the Development Environment

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the API server**:
   ```bash
   npx nx serve api
   ```

3. **Start the dashboard**:
   ```bash
   npx nx serve dashboard
   ```

4. **Run desktop app** (optional):
   ```bash
   npx nx run desktop:dev
   ```

### Development Commands

```bash
# Run port relay tests
npm run test:port-relay

# Run comprehensive E2E tests
npx nx e2e api-e2e --testPathPattern=port-relay-comprehensive

# Start with port relay debugging enabled
DEBUG=port-relay* npx nx serve api

# Build desktop app with port relay
npx nx build desktop
```

### Debugging

#### Enabling Debug Logs

Set environment variables for detailed logging:

```bash
export DEBUG=port-relay*
export PORT_RELAY_LOG_LEVEL=debug
```

#### Desktop DevTools

In the desktop app, open DevTools and check:
- Console for port relay logs
- Network tab for RPC communication
- Application → Local Storage for persisted settings

#### API Debug Endpoints

Development-only endpoints for debugging:

```bash
# Get all port relay states
GET /api/debug/port-relay/states

# Force port scan
POST /api/debug/port-relay/scan/:projectId

# Get forwarding statistics
GET /api/debug/port-relay/stats
```

### Contributing

When contributing to the port relay system:

1. **Add tests** for new functionality
2. **Update documentation** if APIs change
3. **Test across providers** (Docker, Apple Container, Daytona)
4. **Consider both desktop and web experiences**
5. **Follow the existing error handling patterns**
6. **Add appropriate logging** for debugging

### Code Style

Follow these patterns when working with the port relay system:

- **Error handling**: Always return structured error objects
- **Logging**: Use consistent prefixes (`[port-relay]`, `[port-forward]`)
- **Async/await**: Prefer async/await over promises
- **Type safety**: Use TypeScript interfaces for all data structures
- **Resource cleanup**: Always clean up servers, intervals, and connections