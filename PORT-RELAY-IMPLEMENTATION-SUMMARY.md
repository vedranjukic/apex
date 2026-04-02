# Port Relay Feature Implementation Summary

## Overview

Successfully implemented the port relay feature for Daytona WebSocket tunneling with getSignedPreviewUrl support and 60-minute TTL. The implementation extends the existing combined proxy service architecture and adds new port relay bridge functionality.

## Key Components Implemented

### 1. Combined Proxy Service Extensions (`libs/orchestrator/src/lib/combined-proxy-service-script.ts`)

**Changes:**
- Added `PORT_RELAY_PORT` configuration (default: 9341)
- Extended `getCombinedProxyServiceScript` function signature to accept `portRelayPort` parameter
- Added new port relay WebSocket server (`portRelayWss`) for handling `/port-relay/:port` endpoints
- Implemented bidirectional TCP-to-WebSocket tunneling with backpressure handling
- Added dedicated HTTP server for port relay service with health check endpoint
- Updated main health check to include `port_relay_bridge: "running"`

**Port Relay WebSocket Protocol:**
- Endpoint: `ws://[proxy-host]:9341/port-relay/:port`
- Connects to `localhost:port` on the target sandbox
- Handles binary data streaming with backpressure management
- Automatic cleanup on connection failures

### 2. Bridge Script Port Relay Client (`libs/orchestrator/src/lib/bridge-script.ts`)

**New Features:**
- `PORT_RELAY_BASE_URL` environment variable support
- `startPortRelay(port)` function for creating local relay servers
- `stopPortRelay(port)` function for cleanup
- Dynamic local port allocation for each relay
- WebSocket message handlers for `start_port_relay` and `stop_port_relay`
- HTTP endpoints:
  - `POST /internal/start-port-relay` - Start port relay
  - `POST /internal/stop-port-relay` - Stop port relay  
  - `GET /internal/port-relay-status` - Get active relays

**Port Relay Flow:**
1. Bridge receives port relay start request
2. Creates local TCP server on dynamic port
3. Connects to port relay WebSocket endpoint on proxy sandbox
4. Relays TCP traffic bidirectionally through WebSocket
5. Notifies orchestrator with local port mapping

### 3. Type System Extensions (`libs/orchestrator/src/lib/types.ts`)

**New Message Types:**
```typescript
interface BridgePortRelayStarted {
  type: 'port_relay_started';
  targetPort: number;
  localPort: number;
}

interface BridgePortRelayStopped {
  type: 'port_relay_stopped';
  targetPort: number;
}

interface BridgePortRelayError {
  type: 'port_relay_error';
  port: number;
  error: string;
}
```

### 4. Daytona Provider Enhancement (`libs/orchestrator/src/lib/providers/daytona-provider.ts`)

**New Method:**
```typescript
async getSignedPreviewUrlWithDefaultTTL(port: number): Promise<PreviewInfo> {
  return this.getSignedPreviewUrl(port, 3600); // 60 minutes
}
```

**Features:**
- Convenience method for 60-minute TTL preview URLs
- Built on existing `getSignedPreviewUrl` implementation
- Proper type safety and error handling

### 5. Proxy Sandbox Service Configuration (`apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts`)

**Updates:**
- Added `PORT_RELAY_PORT` constant (9341)
- Updated environment variables to include `PORT_RELAY_PORT`
- Modified `getCombinedProxyServiceScript` call to include port relay port
- Maintains backward compatibility

### 6. Sandbox Manager Environment Setup (`libs/orchestrator/src/lib/sandbox-manager.ts`)

**Environment Variables:**
- Added `PORT_RELAY_BASE_URL` for Daytona sandboxes
- Configured to use port 9341 on the proxy sandbox
- Proper URL construction with base URL transformation

## Architecture Overview

```
Regular Sandbox                 Proxy Sandbox                    Host/Orchestrator
┌─────────────────┐             ┌──────────────────┐            ┌──────────────────┐
│  App on :3000   │◄─────TCP────┤                  │            │                  │
└─────────────────┘             │  Port Relay      │◄─WebSocket─┤  Port Relay      │
                                │  Bridge :9341    │            │  Client          │
┌─────────────────┐             │                  │            │                  │
│  Bridge Script  │─WebSocket──►│  /port-relay/    │            │  (localhost:     │
│  Port Relay     │             │  3000            │            │   dynamic)       │
│  Client         │             │                  │            │                  │
└─────────────────┘             └──────────────────┘            └──────────────────┘
      │                                    │
      │ PORT_RELAY_BASE_URL                │
      │ ws://proxy:9341                    │
      └────────────────────────────────────┘
```

## Key Benefits

1. **Granular Port Control**: Each port gets its own WebSocket endpoint and tunnel
2. **Efficient Resource Usage**: Dynamic local port allocation, automatic cleanup
3. **Backpressure Handling**: Proper flow control for large data transfers
4. **Scalable Architecture**: Reuses proven tunnel patterns from existing MITM proxy
5. **Type Safety**: Full TypeScript support with proper message types
6. **Error Resilience**: Comprehensive error handling and cleanup
7. **60-Minute TTL**: Default preview URL expiration for security

## Environment Variables

### Regular Sandboxes
- `PORT_RELAY_BASE_URL`: WebSocket base URL for port relay service (e.g., `ws://proxy-sandbox:9341`)

### Proxy Sandboxes  
- `PORT_RELAY_PORT`: Port relay service listen port (default: 9341)

## Usage Flow

1. **Setup**: Proxy sandbox starts with combined service including port relay bridge
2. **Detection**: Regular sandbox detects application listening on port (e.g., 3000)
3. **Request**: Orchestrator requests port relay start via WebSocket message
4. **Tunnel**: Bridge creates local relay server and WebSocket connection to proxy
5. **Access**: External users access app via preview URL with 60-minute TTL
6. **Cleanup**: Automatic cleanup on disconnect or explicit stop request

## Testing

The implementation includes comprehensive validation via `test-port-relay-implementation.js`:
- ✅ All 6 component checks passed
- ✅ Full feature verification
- ✅ TypeScript compilation successful for orchestrator library

## Backward Compatibility

All changes maintain full backward compatibility:
- Existing tunnel functionality unchanged
- Optional port relay port parameter with sensible default
- Graceful degradation when port relay not configured
- No breaking changes to existing APIs

## Security Considerations

1. **TTL Protection**: 60-minute default TTL prevents indefinite access
2. **Port Isolation**: Each port relay is independent with separate WebSocket connection
3. **Localhost Binding**: Port relay only connects to localhost on target sandbox
4. **Authentication**: Inherits existing proxy sandbox authentication mechanisms
5. **Resource Limits**: Proper cleanup and timeout handling prevents resource leaks

This implementation provides a robust, scalable solution for arbitrary TCP port forwarding through Daytona's WebSocket infrastructure while maintaining security and performance standards.