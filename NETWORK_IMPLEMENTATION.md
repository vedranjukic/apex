# Network State Store Implementation

This document describes the network connectivity detection system implemented for the Apex dashboard.

## Overview

The implementation provides a comprehensive network state management system that tracks both browser connectivity (`navigator.onLine`) and WebSocket connection status, following the existing Zustand patterns used throughout the application.

## Files Created

### 1. Network State Store (`apps/dashboard/src/stores/network-store.ts`)

A Zustand store that manages network connectivity state:

**State Properties:**
- `isOnline: boolean` - Browser's navigator.onLine status
- `connectionType: 'online' | 'offline' | 'reconnecting'` - Current connection state
- `lastOnlineAt: number | null` - Timestamp of last online state
- `socketConnected: boolean` - WebSocket connection status
- `connectionFailures: number` - Count of consecutive connection failures
- `isReconnecting: boolean` - Whether actively reconnecting

**Actions:**
- `setOnlineStatus(isOnline)` - Update browser online status
- `setSocketConnected(connected)` - Update WebSocket status
- `setReconnecting(reconnecting)` - Mark as reconnecting
- `incrementFailures()` - Increment failure count
- `resetFailures()` - Reset failure count
- `updateConnectionType()` - Recalculate connection type
- `reset()` - Reset all state

### 2. Network Detection Hook (`apps/dashboard/src/hooks/use-network-status.ts`)

A React hook that provides network monitoring and integration helpers:

**Features:**
- Monitors `navigator.onLine` API and 'online'/'offline' events
- Periodic connectivity health checks via `/api/health`
- Provides helper functions for socket integration
- Returns computed properties for UI components

**Usage:**
```typescript
const {
  isOnline,
  connectionType,
  socketConnected,
  isFullyConnected,
  hasConnectivityIssues,
  handleSocketConnected,
  handleSocketDisconnected,
} = useNetworkStatus();
```

### 3. Network Integration Helper (`apps/dashboard/src/hooks/use-network-integration.ts`)

Demonstrates how to integrate the network status with existing WebSocket connections:

```typescript
export function useNetworkIntegration(socketRef: { current: ReconnectingWebSocket | null }) {
  const networkStatus = useNetworkStatus();
  
  // Integrates with socket status changes
  useEffect(() => {
    const ws = socketRef.current;
    if (!ws) return;

    ws.onStatus((status) => {
      switch (status) {
        case 'connected': networkStatus.handleSocketConnected(); break;
        case 'connecting': networkStatus.handleSocketReconnecting(); break;
        case 'disconnected': networkStatus.handleSocketDisconnected(); break;
      }
    });
  }, [socketRef, networkStatus]);

  return networkStatus;
}
```

### 4. UI Components (`apps/dashboard/src/components/layout/network-status-indicator.tsx`)

React components for displaying network status:

**NetworkStatusIndicator:**
- Shows connection status icon (Wifi/WifiOff/RotateCw)
- Optional status text
- Tooltip with detailed information
- Visual indicator for connection failures

**NetworkStatusBanner:**
- Full-width banner for connectivity warnings
- Shows offline/reconnecting/issues states
- Automatically hides when connection is stable

### 5. Usage Examples (`apps/dashboard/src/examples/network-usage-example.tsx`)

Comprehensive examples showing:
- Basic network status display
- Network-aware component behavior
- Direct store access patterns
- Socket integration examples

## Integration Patterns

### With Existing Socket Hooks

To integrate with existing socket hooks like `useAgentSocket`, `useTerminalSocket`, etc.:

1. Import the network status hook
2. Use the helper functions to update network state on socket events
3. Access computed properties for UI behavior

```typescript
export function useAgentSocket(projectId: string | undefined) {
  const networkStatus = useNetworkStatus();
  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  useEffect(() => {
    const ws = new ReconnectingWebSocket('/ws/agent');
    wsRef.current = ws;

    ws.onStatus((status) => {
      switch (status) {
        case 'connected': 
          networkStatus.handleSocketConnected(); 
          break;
        case 'connecting': 
          networkStatus.handleSocketReconnecting(); 
          break;
        case 'disconnected': 
          networkStatus.handleSocketDisconnected(); 
          break;
      }
    });

    return () => ws.destroy();
  }, [projectId, networkStatus]);

  return { /* ... existing returns */, networkStatus };
}
```

### In UI Components

Components can use the network status for:
- Disabling online-only actions
- Showing connectivity warnings
- Adapting behavior based on connection quality

```typescript
function MyComponent() {
  const { isFullyConnected, shouldShowNetworkWarning } = useNetworkStatus();

  return (
    <div>
      {shouldShowNetworkWarning && <NetworkStatusBanner />}
      
      <button 
        disabled={!isFullyConnected}
        onClick={onlineAction}
      >
        Sync Data
      </button>
    </div>
  );
}
```

## Design Decisions

### Following Existing Patterns
- Uses Zustand for state management like other stores
- Follows naming conventions (`useXxxStore`, actions pattern)
- Matches TypeScript interfaces and export patterns
- Integrates with existing socket architecture

### Connection Type Logic
The `connectionType` is computed based on multiple factors:
- `offline`: Browser reports offline
- `reconnecting`: Online but socket disconnected or actively reconnecting  
- `online`: Browser online AND socket connected

### Failure Tracking
- Tracks consecutive connection failures
- Resets count on successful connection
- Used for `hasConnectivityIssues` computed property

### Health Check Strategy
- Periodic `/api/health` requests to verify real connectivity
- Different intervals for online (30s) vs offline (10s) states
- Handles false positives from `navigator.onLine`

## Store Integration

The network store is exported in `apps/dashboard/src/stores/index.ts` alongside other stores for consistent imports:

```typescript
export * from './network-store';
```

## Future Enhancements

Potential additions to consider:
1. **Connection Quality Metrics** - Track latency, bandwidth
2. **Offline Queue** - Queue actions when offline, replay when online
3. **Data Synchronization** - Sync state when connection restored
4. **User Preferences** - Allow users to configure connectivity behavior
5. **Advanced Health Checks** - More sophisticated connectivity testing

## Testing

The implementation can be tested by:
1. Toggling browser connectivity (DevTools > Network > Offline)
2. Disconnecting/reconnecting WebSocket connections
3. Monitoring console logs for network state changes
4. Using the example components to verify UI behavior

## Dependencies

- Uses existing `ReconnectingWebSocket` class
- Follows Zustand patterns like other stores
- Uses Lucide React icons for UI components
- Integrates with existing CSS utility classes