# Port Relay Integration Tests Guide

This document provides comprehensive guidance for running and understanding the port relay integration tests.

## Overview

The port relay integration tests validate the entire port forwarding and relay system across all components:

- **PortRelayManager** (Electron main process)
- **Port Forwarder** (API service layer) 
- **PortRelayService** (coordination layer)
- **WebSocket Tunnels** (Daytona provider)
- **UI Components** (Dashboard ports panel)
- **RPC Communication** (Inter-process communication)

## Test Structure

```
apps/
├── api-e2e/src/
│   ├── port-relay-integration.spec.ts          # Core port forwarding tests
│   ├── websocket-tunnel-integration.spec.ts    # WebSocket tunnel tests
│   └── port-relay-comprehensive.spec.ts        # Full system tests
├── desktop/src/__tests__/
│   ├── port-relay-manager.integration.spec.ts  # Desktop manager tests
│   └── rpc-port-relay-integration.spec.ts      # RPC communication tests
└── dashboard-e2e/src/
    └── ports-panel-integration.spec.ts         # UI integration tests
```

## Test Profiles

### 1. Smoke Tests (`smoke`)
Quick validation of core functionality:
- Basic port forwarding
- Configuration management
- Essential UI components

**Duration:** ~30 seconds  
**Usage:** `npm run test:port-relay smoke`

### 2. Integration Tests (`integration`) 
Full integration test suite:
- All core functionality
- Cross-component integration
- Error handling scenarios

**Duration:** ~60 seconds  
**Usage:** `npm run test:port-relay integration`

### 3. UI Tests (`ui`)
Dashboard and user interface tests:
- Ports panel functionality
- User interactions
- Real-time updates

**Duration:** ~45 seconds  
**Usage:** `npm run test:port-relay ui`

### 4. Performance Tests (`performance`)
Load and performance validation:
- High-frequency operations
- Concurrent connections
- Resource usage monitoring

**Duration:** ~2 minutes  
**Usage:** `npm run test:port-relay performance`

### 5. Comprehensive Tests (`comprehensive`)
Complete test suite including stress testing:
- All functionality
- Edge cases and failure scenarios
- Multi-provider compatibility
- Real-world usage patterns

**Duration:** ~3 minutes  
**Usage:** `npm run test:port-relay comprehensive`

## Prerequisites

### 1. Environment Setup
```bash
# Install dependencies
npm install

# Build all projects
npm run build

# Start API server
npm run serve:api
```

### 2. Required Services
- **API Server:** Must be running on port 6000 (or PORT env var)
- **Database:** SQLite database for project management
- **Free Ports:** Range 8000-9500 should be available for testing

### 3. System Requirements
- **Node.js:** 18+ recommended
- **Memory:** 4GB+ available (for comprehensive tests)
- **Network:** Localhost connectivity required

## Running Tests

### Quick Start
```bash
# Run default integration tests
npm run test:port-relay

# Run specific profile
npm run test:port-relay comprehensive

# Run with additional Jest flags
npm run test:port-relay integration --verbose --bail
```

### Manual Test Execution
```bash
# API E2E tests
npx nx e2e @apex/api-e2e --testPathPattern=port-relay-integration

# Desktop tests  
npx jest apps/desktop/src/__tests__/port-relay-manager.integration.spec.ts

# UI tests (Playwright)
npx playwright test apps/dashboard-e2e/src/ports-panel-integration.spec.ts
```

### Custom Test Runner
```bash
# Use the custom test runner
node scripts/run-port-relay-tests.js comprehensive

# Get help
node scripts/run-port-relay-tests.js help
```

## Test Scenarios Covered

### Core Port Forwarding
- [x] Single port forwarding (TCP/HTTP)
- [x] Multiple simultaneous forwards
- [x] Port conflict resolution
- [x] Automatic port assignment
- [x] Forward cleanup and teardown

### Provider Compatibility
- [x] Docker provider integration
- [x] Apple Container provider
- [x] Daytona WebSocket tunnels
- [x] Cross-provider isolation
- [x] Provider-specific configuration

### Auto-Forward Features
- [x] Automatic port detection
- [x] Auto-forward configuration
- [x] Excluded ports handling
- [x] Maximum forward limits
- [x] Enable/disable toggle

### WebSocket Tunnels (Daytona)
- [x] Tunnel establishment
- [x] Data transmission
- [x] Multi-client handling
- [x] Connection recovery
- [x] Protocol compliance

### UI Integration
- [x] Ports panel display
- [x] Real-time status updates
- [x] Localhost URL generation
- [x] Daytona preview URLs
- [x] User interactions
- [x] Error feedback
- [x] Accessibility compliance

### RPC Communication
- [x] Type-safe RPC calls
- [x] Event broadcasting
- [x] Error handling
- [x] Timeout scenarios
- [x] Concurrent requests

### Error Handling
- [x] Network failures
- [x] Port conflicts
- [x] Resource exhaustion  
- [x] Invalid configurations
- [x] Recovery mechanisms

### Performance
- [x] Concurrent connections
- [x] High-frequency operations
- [x] Memory usage monitoring
- [x] Load testing
- [x] Scalability validation

## Debugging Tests

### Enable Debug Logging
```bash
DEBUG=port-relay* npm run test:port-relay integration
```

### Run Individual Test Suites
```bash
# Core integration only
npx nx e2e @apex/api-e2e --testPathPattern=port-relay-integration --testNamePattern="Basic Port Forwarding"

# WebSocket tests only
npx nx e2e @apex/api-e2e --testPathPattern=websocket-tunnel-integration --testNamePattern="Basic WebSocket"
```

### Verbose Output
```bash
npm run test:port-relay integration -- --verbose --no-coverage
```

### Test in Watch Mode
```bash
npx jest apps/desktop/src/__tests__/port-relay-manager.integration.spec.ts --watch
```

## Common Issues and Solutions

### 1. Port Already in Use
**Error:** `EADDRINUSE: address already in use`
**Solution:** 
- Check for running processes: `lsof -i :PORT`
- Kill processes: `kill -9 PID`
- Use different port ranges in test config

### 2. API Server Not Running
**Error:** `connect ECONNREFUSED 127.0.0.1:6000`
**Solution:**
```bash
npm run serve:api
```

### 3. Database Lock Issues  
**Error:** `SQLITE_BUSY: database is locked`
**Solution:**
- Stop all test processes
- Delete test databases: `rm -f *.db-*`
- Restart API server

### 4. Memory Issues in Comprehensive Tests
**Error:** `JavaScript heap out of memory`
**Solution:**
```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run test:port-relay comprehensive
```

### 5. WebSocket Connection Failures
**Error:** WebSocket connection timeout
**Solution:**
- Check firewall settings
- Verify no proxy interference
- Ensure localhost resolution works

## Test Data and Mocking

### Mock Services
Tests create temporary HTTP servers on various ports:
- `3000-3999`: Core functionality tests
- `4000-4999`: Multi-service tests  
- `5000-5999`: Load testing
- `6000-6999`: Cross-provider tests
- `7000-7999`: Stress testing

### Test Databases
Each test suite uses isolated temporary directories:
- Config files in `/tmp/port-relay-tests-{timestamp}/`
- Automatic cleanup after tests complete

### WebSocket Mocks
Custom WebSocket servers simulate Daytona tunnel endpoints:
- Echo servers for basic connectivity
- Protocol compliance testing
- Multi-client simulation

## Continuous Integration

### GitHub Actions Configuration
```yaml
- name: Run Port Relay Integration Tests
  run: |
    npm run serve:api &
    sleep 10
    npm run test:port-relay integration
    kill %1
```

### Docker Testing
```bash
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

### Performance Benchmarking
```bash
npm run test:port-relay performance > performance-results.txt
```

## Contributing Test Cases

### Adding New Test Scenarios
1. Choose appropriate test file based on component
2. Follow existing test structure and naming
3. Include both success and failure cases
4. Add performance considerations for load tests
5. Update this documentation

### Test Naming Convention
- **Describe blocks:** Component or feature being tested
- **Test cases:** `should [expected behavior] when [condition]`
- **File names:** `[component]-[type]-integration.spec.ts`

### Mock Guidelines
- Use realistic data and scenarios
- Clean up resources in `afterEach/afterAll`
- Make tests independent and idempotent
- Handle async operations properly

## Performance Expectations

### Benchmark Targets
- **Single port forward:** < 100ms
- **10 concurrent forwards:** < 1000ms  
- **Auto-forward detection:** < 500ms
- **UI update latency:** < 200ms
- **WebSocket tunnel setup:** < 2000ms

### Resource Limits
- **Memory usage:** < 500MB during tests
- **CPU usage:** < 80% sustained
- **Open file descriptors:** < 1000
- **Network connections:** Proper cleanup

## Support

For test-related issues:
1. Check this documentation first
2. Review test output and logs
3. Run tests in isolation to identify failing component
4. Check GitHub issues for known problems
5. Create detailed issue with reproduction steps

## Test Coverage

Current test coverage targets:
- **Core Functions:** 95%+ coverage
- **Integration Paths:** 90%+ coverage  
- **Error Scenarios:** 85%+ coverage
- **UI Components:** 80%+ coverage

Run coverage reports:
```bash
npm run test:port-relay integration -- --coverage
```