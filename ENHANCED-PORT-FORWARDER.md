# Enhanced Port Forwarder

This document describes the enhanced port-forwarder module with automatic forwarding and conflict resolution capabilities.

## Overview

The enhanced port-forwarder extends the original `apps/api/src/modules/preview/port-forwarder.ts` with:

- **Automatic port forwarding** with range-based allocation
- **Enhanced conflict resolution** with 8000-9000 default range fallback
- **Batch forwarding methods** for multiple ports
- **Port discovery and availability checking** with exclusion support
- **Status tracking and health monitoring** for active forwards
- **Thread safety and proper cleanup** with interval management
- **Backward compatibility** with existing forwarding functionality

## Key Features

### 1. Enhanced Configuration

```typescript
interface PortForwarderConfig {
  portRange: {
    start: number;           // Default: 8000
    end: number;             // Default: 9000  
  };
  excludedPorts: number[];   // Ports to never allocate
  enableHealthChecks: boolean; // Monitor connection health
  healthCheckInterval: number; // Health check frequency (ms)
  maxRetries: number;        // Retry attempts for failed forwards
  retryDelay: number;        // Delay between retries (ms)
}
```

**Default Configuration:**
- Port range: 8000-9000 (1000 available ports)
- Excluded ports: [8080, 8443, 8888] (common dev ports)
- Health checks: Enabled with 30-second intervals
- Max retries: 3 attempts with 1-second delays

### 2. Smart Port Allocation

**forwardPortWithRange()** - Enhanced forwarding with intelligent allocation:

```typescript
// Try preferred port first, fall back to range
await forwardPortWithRange(sandboxId, remoteHost, remotePort, preferredLocalPort?)
```

**Allocation Strategy:**
1. **Preferred Port**: Use exact port if specified and available
2. **Range Search**: Find free port within configured range (8000-9000)
3. **Exclusion Filtering**: Skip ports marked as excluded
4. **Automatic Fallback**: Graceful handling when preferred port unavailable

### 3. Batch Auto-forwarding

**autoForwardPorts()** - Process multiple ports efficiently:

```typescript
const results = await autoForwardPorts(sandboxId, remoteHost, [
  { port: 3000, protocol: 'tcp' },
  { port: 3001, protocol: 'tcp' },
  { port: 5432, protocol: 'tcp' }
]);
```

**Features:**
- **Protocol filtering**: TCP ports only (UDP filtered out)
- **Deduplication**: Skips already-forwarded ports
- **Parallel processing**: Forwards multiple ports concurrently
- **Error isolation**: Individual port failures don't affect others
- **Detailed results**: Per-port success/failure information

### 4. Status Tracking & Monitoring

**Enhanced Status Information:**

```typescript
interface PortStatus {
  remotePort: number;
  localPort: number;
  sandboxId: string;
  status: 'active' | 'failed' | 'stopped';
  error?: string;
  createdAt: number;
  connectionCount: number;
  lastHealthCheck?: number;
}
```

**getPortStatus()** - Comprehensive forward status:

```typescript
// Get all forwards
const allStatus = getPortStatus();

// Get sandbox-specific forwards  
const sandboxStatus = getPortStatus('my-sandbox');
```

### 5. Health Monitoring

**Automatic Health Checks** (when enabled):
- **Connection testing**: Periodic TCP connection attempts to remote service
- **Status updates**: Failed health checks update forward status to 'failed'
- **Configurable intervals**: Default 30-second health check frequency
- **Error logging**: Health check failures logged with context

### 6. Improved Error Handling

**Robust Error Management:**
- **Graceful degradation**: Failed forwards don't affect others
- **Detailed error messages**: Specific failure reasons provided
- **Retry logic**: Configurable retry attempts for transient failures
- **Resource cleanup**: Proper interval clearing and connection cleanup

## API Reference

### Core Functions

```typescript
// Basic forwarding (backward compatible)
forwardPort(sandboxId: string, remoteHost: string, remotePort: number): Promise<number>

// Enhanced forwarding with range support
forwardPortWithRange(
  sandboxId: string, 
  remoteHost: string, 
  remotePort: number, 
  preferredLocalPort?: number
): Promise<number>

// Batch auto-forwarding
autoForwardPorts(
  sandboxId: string,
  remoteHost: string, 
  ports: PortInfo[]
): Promise<Array<{remotePort: number; localPort?: number; error?: string}>>
```

### Management Functions

```typescript
// Stop specific forward
unforwardPort(sandboxId: string, remotePort: number): boolean

// Stop all forwards for sandbox (returns count)
unforwardAll(sandboxId: string): number

// Get detailed status
getPortStatus(sandboxId?: string): PortStatus[]

// List simple forwards (backward compatible)  
listForwards(sandboxId: string): Array<{localPort: number; remotePort: number}>
```

### Configuration Functions

```typescript
// Update configuration
setConfig(config: Partial<PortForwarderConfig>): void

// Get current configuration
getConfig(): PortForwarderConfig

// Global cleanup
cleanup(): void
```

## Integration with PortRelayManager

The enhanced port-forwarder works seamlessly with the existing PortRelayManager:

### Shared Functionality
- **Port allocation logic**: Both use same range-based allocation
- **Conflict resolution**: Consistent behavior across modules  
- **Status tracking**: Compatible status interfaces
- **Configuration**: Aligned configuration patterns

### Integration Points

```typescript
// PortRelayManager can leverage enhanced forwarding
class PortRelayManager {
  async forwardPort(sandboxId, remoteHost, remotePort, localPort?) {
    // Use enhanced port-forwarder with range support
    return await forwardPortWithRange(sandboxId, remoteHost, remotePort, localPort);
  }

  async handleNewPorts(sandboxId, remoteHost, ports) {
    // Use batch auto-forwarding
    return await autoForwardPorts(sandboxId, remoteHost, ports);
  }
}
```

## Migration Guide

### For Existing Code

**No breaking changes** - existing code continues to work:

```typescript
// Existing code works unchanged
const localPort = await forwardPort('sandbox', 'host', 3000);
unforwardPort('sandbox', 3000);
const forwards = listForwards('sandbox');
```

### To Use Enhanced Features

**Upgrade to enhanced functions:**

```typescript
// Old: Basic forwarding
const port1 = await forwardPort(sandboxId, remoteHost, 3000);

// New: Range-based forwarding with preferred port
const port2 = await forwardPortWithRange(sandboxId, remoteHost, 3000, 8080);

// Old: Individual port forwarding
await forwardPort(sandboxId, remoteHost, 3001);
await forwardPort(sandboxId, remoteHost, 3002);

// New: Batch forwarding  
await autoForwardPorts(sandboxId, remoteHost, [
  { port: 3001, protocol: 'tcp' },
  { port: 3002, protocol: 'tcp' }
]);
```

## Error Handling

### Common Scenarios

```typescript
try {
  const localPort = await forwardPortWithRange(sandboxId, host, remotePort, preferredPort);
  console.log(`Forwarded to localhost:${localPort}`);
} catch (error) {
  if (error.message.includes('No free port found')) {
    // Port range exhausted
    console.log('Consider expanding port range or stopping unused forwards');
  } else if (error.message.includes('EADDRINUSE')) {
    // Preferred port in use
    console.log('Preferred port unavailable, trying range allocation...');
  }
}
```

### Batch Error Handling

```typescript
const results = await autoForwardPorts(sandboxId, remoteHost, ports);

for (const result of results) {
  if (result.error) {
    console.warn(`Failed to forward port ${result.remotePort}: ${result.error}`);
  } else {
    console.log(`Port ${result.remotePort} → localhost:${result.localPort}`);
  }
}
```

## Performance Considerations

### Optimizations
- **Parallel processing**: Batch operations use Promise.allSettled()
- **Efficient port scanning**: Smart range searching with exclusions
- **Connection reuse**: Existing forwards returned immediately  
- **Memory management**: Proper cleanup of intervals and connections

### Scaling Limits
- **Port range size**: Default 1000 ports (8000-9000) supports extensive usage
- **Health check overhead**: ~5ms per check, configurable intervals
- **Memory usage**: Minimal overhead per forward (~1KB)

## Testing

Run the comprehensive test suite:

```bash
node test-enhanced-port-forwarder.js
```

**Test Coverage:**
- ✅ Configuration management
- ✅ Basic port forwarding
- ✅ Range-based allocation
- ✅ Conflict resolution
- ✅ Auto-forwarding batch operations
- ✅ Status tracking
- ✅ Health monitoring
- ✅ Cleanup operations

## Security Notes

- **Localhost binding**: All forwards bound to 127.0.0.1 only
- **Input validation**: Port numbers and configuration values validated
- **Resource limits**: Configurable port ranges prevent resource exhaustion
- **Clean shutdown**: Proper cleanup prevents connection leaks

## Future Enhancements

1. **Load balancing**: Multiple local ports for high-availability services  
2. **Protocol support**: UDP forwarding capability
3. **SSL termination**: TLS proxy support
4. **Bandwidth monitoring**: Traffic usage tracking
5. **Custom routing**: Hostname-based routing rules
6. **Persistence**: Forward configuration persistence across restarts