# Offline Mode Testing Guide

This guide provides comprehensive instructions for testing the offline mode implementation, including manual testing scenarios, automated test execution, and validation procedures.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Manual Testing Scenarios](#manual-testing-scenarios)
3. [Automated Testing](#automated-testing)
4. [Performance Validation](#performance-validation)
5. [Integration Testing](#integration-testing)
6. [Troubleshooting](#troubleshooting)

## Quick Start

### Prerequisites
```bash
# Install dependencies
npm install

# Build the project
npm run build:dashboard
npm run build:api
```

### Running Tests
```bash
# Run all offline mode tests
npm test -- --testPathPattern="network|offline"

# Run specific test suites
npm test network-store.test.ts
npm test use-network-status.test.ts
npm test reconnecting-ws.test.ts
npm test offline-mode-integration.test.tsx
```

## Manual Testing Scenarios

### Scenario 1: Basic Offline/Online Detection

**Objective**: Verify that the application correctly detects browser offline/online states.

**Steps**:
1. Open the dashboard in your browser
2. Open Developer Tools (F12) → Application → Service Workers
3. Check "Offline" to simulate offline mode
4. **Expected**: 
   - Network status indicator shows offline state (red WiFi off icon)
   - Banner appears: "You are offline. Some features may not work properly."
   - Online action buttons become disabled
   - Connection type shows "offline"

5. Uncheck "Offline" to go back online
6. **Expected**:
   - Network status indicator shows reconnecting state (yellow spinning icon)
   - Banner shows: "Reconnecting to server..."
   - After WebSocket reconnects: status becomes green, banner disappears

**Alternative Method**:
```javascript
// In browser console
navigator.onLine = false;
window.dispatchEvent(new Event('offline'));

// Then back online
navigator.onLine = true;
window.dispatchEvent(new Event('online'));
```

### Scenario 2: WebSocket Disconnection

**Objective**: Test WebSocket disconnection while browser remains online.

**Steps**:
1. Open Network tab in Developer Tools
2. Start the application (should show connected state)
3. Block WebSocket connections:
   - Right-click on WebSocket connection in Network tab
   - Select "Block request domain" or "Block request URL"
4. **Expected**:
   - Status indicator shows reconnecting state
   - Banner appears with reconnection message
   - Application attempts to reconnect automatically

5. Unblock the WebSocket connection
6. **Expected**:
   - Connection re-establishes
   - Status returns to online (green)
   - Banner disappears

### Scenario 3: Intermittent Connectivity

**Objective**: Test behavior during unstable network conditions.

**Steps**:
1. Use Network tab to throttle connection to "Slow 3G"
2. Repeatedly toggle offline/online every 5-10 seconds
3. **Expected**:
   - Connection failures increment
   - When failures > 2, warning indicators appear
   - Application handles rapid state changes gracefully
   - No crashes or UI freezing

### Scenario 4: Long Offline Period

**Objective**: Test behavior after extended offline period.

**Steps**:
1. Go offline using Developer Tools
2. Wait for 5+ minutes (or modify `lastOnlineAt` in network store)
3. **Expected**:
   - Banner shows time since last connection
   - Status indicator tooltip shows "Last online 5m ago"

4. Go back online
5. **Expected**:
   - Immediate reconnection attempt
   - Failure count resets
   - All queued messages sent

### Scenario 5: UI Component Integration

**Objective**: Verify all UI components respond correctly to network changes.

**Steps**:
1. Navigate through different pages/components
2. For each page, test offline/online transitions
3. **Expected**:
   - All network-aware components update consistently
   - Buttons disable/enable appropriately
   - Status indicators show the same state everywhere
   - No visual glitches or layout shifts

## Automated Testing

### Running Test Suites

```bash
# Run all network-related tests
npm test -- --testNamePattern="network|offline|reconnecting"

# Run with coverage
npm test -- --testNamePattern="network" --coverage

# Run tests in watch mode during development
npm test -- --testNamePattern="network" --watch
```

### Test Categories

#### Unit Tests
- **Network Store** (`network-store.test.ts`)
  - State management
  - Action handling
  - Connection type logic
  
- **Network Status Hook** (`use-network-status.test.ts`)
  - Event listener setup
  - Periodic connectivity checks
  - Helper functions
  
- **Reconnecting WebSocket** (`reconnecting-ws.test.ts`)
  - Connection logic
  - Message handling
  - Reconnection behavior

#### Integration Tests
- **Offline Mode Integration** (`offline-mode-integration.test.tsx`)
  - Full offline/online flow
  - UI component integration
  - Real-time updates
  - Error handling

### Custom Test Utilities

Use the `NetworkTestUtils` class for comprehensive testing:

```javascript
import { NetworkTestUtils, NetworkTestScenarios, NetworkAssertions } from '../test-utils/network-testing-utils';

// Simulate specific network state
NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.BROWSER_OFFLINE);

// Trigger network events
NetworkTestUtils.triggerNetworkEvent('offline');

// Assert expected states
NetworkAssertions.expectConnectionType('offline');
NetworkAssertions.expectUIState({ canPerformOnlineActions: false });

// Clean up
NetworkTestUtils.cleanup();
```

### Test Scenarios Available

```javascript
// Pre-defined test scenarios
NetworkTestScenarios.FULLY_ONLINE
NetworkTestScenarios.BROWSER_OFFLINE
NetworkTestScenarios.SOCKET_DISCONNECTED
NetworkTestScenarios.RECONNECTING
NetworkTestScenarios.CONNECTIVITY_ISSUES
NetworkTestScenarios.LONG_OFFLINE
```

## Performance Validation

### Memory Usage Testing

1. **Open Chrome DevTools → Performance tab**
2. **Record performance while testing network transitions**
3. **Expected**: No significant memory leaks or spikes

### Cleanup Verification

```javascript
// Test cleanup in browser console
const { useNetworkStore } = window.__APEX_STORES__;
const initialListeners = document.addEventListener.callCount;

// Create and destroy components
// Check that listeners are properly removed
```

### Timer Management

```bash
# Check for timer leaks in tests
npm test -- --testNamePattern="cleanup|timer|memory"
```

## Integration Testing

### WebSocket Integration

Test with real WebSocket connections:

```javascript
// In browser console, test WebSocket integration
const ws = new ReconnectingWebSocket('/api/socket');

// Monitor network store changes
const unsubscribe = useNetworkStore.subscribe((state) => {
  console.log('Network state:', state);
});

// Test various scenarios
ws.send('test', { message: 'hello' });
```

### API Health Check Integration

Verify `/api/health` endpoint:

```bash
# Test health endpoint
curl -I http://localhost:3000/api/health

# Should return 200 OK for connectivity checks
```

### Cross-Component Testing

1. **Open multiple browser tabs**
2. **Test network transitions in one tab**
3. **Expected**: All tabs reflect the same network state

## Troubleshooting

### Common Issues

#### Tests Failing
```bash
# Clear all mocks and timers
jest.clearAllMocks();
jest.clearAllTimers();
```

#### Network Store Not Updating
```javascript
// Check if store is properly initialized
const state = useNetworkStore.getState();
console.log('Current network state:', state);

// Manually trigger updates
useNetworkStore.getState().updateConnectionType();
```

#### WebSocket Not Reconnecting
```javascript
// Check network store state
const state = useNetworkStore.getState();
if (!state.isOnline) {
  console.log('Cannot reconnect: browser is offline');
}
```

#### UI Components Not Updating
```javascript
// Verify component is using the hook correctly
const networkStatus = useNetworkStatus();
console.log('Hook state:', networkStatus);
```

### Debug Commands

```javascript
// Enable debug logging in browser console
localStorage.setItem('debug', 'network:*');

// Check current network state
console.log('Network store:', useNetworkStore.getState());

// Monitor store changes
const unsubscribe = useNetworkStore.subscribe(console.log);
```

### Performance Issues

```javascript
// Check for excessive re-renders
React.StrictMode // Enable in development

// Monitor network check frequency
console.log('Connectivity check intervals:', {
  online: '30s',
  offline: '10s'
});
```

## Validation Checklist

### Before Release

- [ ] All automated tests pass
- [ ] Manual testing scenarios complete
- [ ] Performance validation completed
- [ ] Cross-browser testing done
- [ ] Memory leak testing passed
- [ ] Integration with existing sockets works
- [ ] Backward compatibility verified
- [ ] Error handling tested
- [ ] UI components responsive to all states
- [ ] Documentation updated

### Browser Compatibility

Test in:
- [ ] Chrome (latest)
- [ ] Firefox (latest) 
- [ ] Safari (latest)
- [ ] Edge (latest)

### Network Conditions

Test with:
- [ ] Normal connection
- [ ] Slow 3G
- [ ] Offline mode
- [ ] Intermittent connectivity
- [ ] WebSocket blocked
- [ ] API endpoint unreachable

## Continuous Testing

### Pre-commit Hooks

```bash
# Add to package.json scripts
"pre-commit": "npm run test:network && npm run lint"
```

### CI/CD Integration

```yaml
# Add to CI pipeline
- name: Test Network Features
  run: npm test -- --testPathPattern="network|offline" --coverage --watchAll=false
```

### Monitoring

```javascript
// Add to production monitoring
if (process.env.NODE_ENV === 'production') {
  useNetworkStore.subscribe((state) => {
    if (state.connectionFailures > 5) {
      analytics.track('network_connectivity_issues', state);
    }
  });
}
```

This comprehensive testing guide ensures the offline mode implementation is robust, performant, and provides a great user experience across all network conditions.