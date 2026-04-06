# Settings API E2E Tests

This directory contains comprehensive End-to-End tests for the Settings API functionality, specifically designed to prevent regression of the **500 Internal Server Error** that occurred when users clicked "Save" on the settings page.

## 🐛 Background

The Settings API E2E tests were created to prevent regression of a critical bug where:

- **Error**: `client.ts:4 PUT http://localhost:4200/api/settings 500 (Internal Server Error)`
- **Root Cause**: Multiple issues including type safety, server startup hanging, and port configuration
- **Impact**: Users couldn't save settings, blocking critical functionality

## 📁 Test Files

### `settings-api.e2e-spec.ts`
**Core Settings API functionality**

- Server startup resilience with proxy sandbox timeouts
- Type safety for null/undefined values
- First-run scenarios (empty forms)
- Re-initialization with timeout protection
- Error recovery and logging
- Performance optimization validation

### `settings-dashboard-integration.e2e-spec.ts` 
**Full Dashboard Workflow Simulation**

- Settings page load workflow
- User form interaction scenarios
- Dashboard response handling
- Concurrent request handling
- Error boundary testing
- Performance benchmarks

### `settings-type-safety.e2e-spec.ts`
**Type Safety and Edge Cases**

- Null/undefined value handling (original bug)
- String method safety
- Filtering logic verification
- Error boundaries
- Regression prevention
- Primitive type handling

### `settings-e2e-runner.ts`
**Test Runner Utility**

- Orchestrates all settings E2E tests
- Provides summary reporting
- Validates environment setup
- Can be used in CI/CD pipelines

## 🚀 Running Tests

### Prerequisites

```bash
# Required environment variables
export ANTHROPIC_API_KEY="sk-ant-your-key-here"

# Optional (for Daytona-specific tests)
export DAYTONA_API_KEY="your-daytona-key"
export DAYTONA_API_KEY_E2E="separate-e2e-key" # recommended
```

### Individual Test Suites

```bash
# Core settings API tests
npm run test:settings-e2e

# Dashboard integration tests  
npm run test:settings-dashboard-e2e

# Type safety and edge cases
npm run test:settings-type-safety-e2e

# Run all settings tests with summary
npm run test:settings-all-e2e
```

### Manual Test Execution

```bash
# Using Nx directly
npx nx e2e @apex/api-e2e --testPathPattern=settings-api

# Using Jest directly
cd apps/api-e2e
npx jest settings-api.e2e-spec.ts
```

## 📊 Test Scenarios Covered

### ✅ Original Bug Scenarios

| Scenario | Test Location | Description |
|----------|---------------|-------------|
| Null value crash | `settings-type-safety.e2e-spec.ts` | `value.includes('••••')` on null |
| Server startup hang | `settings-api.e2e-spec.ts` | Proxy sandbox timeout |
| Port mismatch | `settings-dashboard-integration.e2e-spec.ts` | Dashboard proxy config |
| Empty form save | `settings-api.e2e-spec.ts` | First-run scenarios |

### ✅ Regression Prevention

- **Type Safety**: All JavaScript primitive types
- **Form States**: Empty, partial, null, mixed
- **Error Recovery**: Malformed requests, network errors
- **Performance**: Timeout protection, optimization validation
- **User Workflows**: Complete dashboard interaction flows

### ✅ Edge Cases

- Mixed null and string values
- Masked value filtering (`••••`)
- JavaScript type coercion
- Concurrent save attempts
- Form state from React components

## 🎯 Test Goals

### 🔒 **Prevent 500 Errors**
- Ensure settings save always returns 200 OK
- Handle all possible form data combinations
- Graceful error handling and recovery

### ⚡ **Performance Validation**  
- Server startup within 45 seconds (with 30s timeout)
- Settings save within 35 seconds (re-init scenarios)
- Fast response for no-change scenarios (<2s)

### 🛡️ **Type Safety Assurance**
- No crashes on null/undefined values
- Proper string method safety
- Correct filtering of invalid data

### 🔄 **Workflow Integrity**
- Complete settings page lifecycle
- Dashboard-API communication
- State consistency after saves

## 🚨 Failure Scenarios

### Common Test Failures

**Server Startup Timeout**
```
Error: API did not settle within 45 seconds
```
- **Cause**: Proxy sandbox creation hanging
- **Solution**: Check Daytona provider status, validate timeout fix

**Type Safety Regression** 
```
Error: 500 - null is not an object (evaluating 'value.includes')
```
- **Cause**: Type checking removed or bypassed
- **Solution**: Verify string type checks in settings routes

**Performance Degradation**
```
Error: Settings save took 60000ms (expected < 35000ms)
```
- **Cause**: Timeout mechanism not working
- **Solution**: Check Promise.race timeout implementation

## 🔧 Debugging Tests

### Enable Debug Logging

```bash
# Enable verbose API logging
DEBUG=apex:* npm run test:settings-e2e

# Run with extended timeout
JEST_TIMEOUT=300000 npm run test:settings-e2e
```

### Manual Verification

```bash
# Start API server manually
npm run serve:api

# Test endpoints directly
curl -X GET http://localhost:6000/api/settings
curl -X PUT http://localhost:6000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"FIELD":null}'
```

### Log Analysis

Check these log patterns during test execution:

```bash
# Should see these logs
[settings] Update request received: {...}
[settings] Filtered values: {...}
[projects] Daytona LLM proxy sandbox failed (non-fatal): Proxy sandbox creation timeout (30s)
[settings] Update successful

# Should NOT see these errors
null is not an object (evaluating 'value.includes')
TypeError: Cannot read property 'includes' of null
```

## 🔄 CI/CD Integration

### GitHub Actions Example

```yaml
name: Settings API E2E Tests
on: [push, pull_request]

jobs:
  settings-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
        
      - name: Run Settings E2E Tests
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          DAYTONA_API_KEY_E2E: ${{ secrets.DAYTONA_API_KEY_E2E }}
        run: npm run test:settings-all-e2e
```

### Pre-commit Hook Example

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running settings E2E tests..."
npm run test:settings-all-e2e

if [ $? -ne 0 ]; then
  echo "❌ Settings E2E tests failed! Commit blocked."
  exit 1
fi

echo "✅ Settings E2E tests passed!"
```

## 📈 Metrics and Monitoring

The E2E tests track key metrics:

- **Server Startup Time**: Should be < 45 seconds
- **Settings Save Time**: Should be < 35 seconds (with re-init)
- **Fast Path Time**: Should be < 2 seconds (no changes)
- **Success Rate**: Should be 100% for all scenarios

## 🆘 Support

If tests fail:

1. **Check Environment**: Ensure required API keys are set
2. **Verify Server**: Ensure API server can start independently
3. **Review Logs**: Look for specific error patterns
4. **Run Individual Tests**: Isolate failing scenarios
5. **Check Network**: Verify localhost connectivity

For persistent failures, the tests may have identified a real regression in the settings API fix.

## 📚 Related Documentation

- [Settings API Architecture](../../workdocs/settings-api.md)
- [Error Handling Guide](../../workdocs/error-handling.md)
- [E2E Testing Strategy](./README.md)
- [Original Bug Report](https://github.com/repo/issues/xxx)

---

**Remember**: These tests exist to prevent a critical user-facing bug. If they fail, investigate thoroughly before bypassing!