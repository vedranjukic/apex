# Test Setup Guide for GitHub CLI Authentication Fix

This guide explains how to run tests for the GitHub CLI authentication fix implementation.

## Prerequisites

1. **Node.js and npm**: Already installed in the environment
2. **Dependencies**: Run `npm install` in the project root (already done)

## Available Tests

### 1. Unit Tests

#### Proxy Configuration Tests
```bash
cd apps/api
npx vitest run src/modules/secrets-proxy/proxy-config.spec.ts
```

This tests:
- GitHub domain configuration
- Environment variable settings
- Basic proxy configuration

#### Sandbox Manager Tests
```bash
cd libs/orchestrator
npx vitest run src/lib/__tests__/sandbox-manager.spec.ts
```

This tests:
- Environment variable setup for containers
- Go-specific TLS configuration
- GitHub token placeholder settings
- CA certificate paths

### 2. Integration Tests (Require More Setup)

The following tests require the actual services to be running and are more complex to set up:

#### Secrets Proxy Tests
- Location: `apps/api/src/modules/secrets-proxy/__tests__/secrets-proxy.spec.ts`
- Requires: Running secrets proxy service, mocked GitHub API
- Status: Currently not runnable due to Bun-specific imports in the actual service

#### GitHub Authentication Tests  
- Location: `apps/api/src/modules/secrets/__tests__/github-auth.spec.ts`
- Requires: Running proxy server, mock GitHub API server
- Status: Currently not runnable due to Bun-specific imports

### 3. End-to-End Tests

Located in `test/e2e/github-cli-auth.e2e.ts`, these would require:
- Full Apex environment running
- Real sandbox creation
- GitHub token configuration
- Running secrets proxy

## Running Basic Tests

To run the tests that are currently working:

```bash
# Run all working tests
cd /home/daytona/github-cli-gh-fails-to-authenticate-thro

# Proxy configuration tests
cd apps/api && npx vitest run src/modules/secrets-proxy/proxy-config.spec.ts

# Sandbox manager tests  
cd ../libs/orchestrator && npx vitest run src/lib/__tests__/sandbox-manager.spec.ts
```

## Test Results Summary

✅ **Passing Tests:**
- Proxy configuration validation (4 tests)
- Sandbox manager environment setup (8 tests)

⚠️ **Tests Requiring Additional Setup:**
- Full proxy integration tests
- GitHub API authentication flow tests
- End-to-end sandbox tests

## Manual Testing

For comprehensive validation, manual testing in a real sandbox environment is recommended:

1. Deploy the changes to a test environment
2. Create a sandbox with GitHub token configured
3. Inside the sandbox, run:
   ```bash
   ./test-github-cli-auth.sh
   ```

4. Verify that `gh` commands work:
   ```bash
   gh api user
   gh repo list --limit 5
   gh auth status
   ```

## What You Need to Set Up

For full testing:

1. **GitHub Personal Access Token**: 
   - Create at https://github.com/settings/tokens
   - Required scopes: `repo`, `workflow`, `read:org`

2. **Apex Environment**:
   - API server running (`npx nx serve @apex/api`)
   - Dashboard running (`npx nx serve @apex/dashboard`)
   - Secrets proxy started (happens automatically with API)

3. **Sandbox Provider**:
   - Docker installed and running, OR
   - Daytona account configured

4. **Environment Variables**:
   ```bash
   export GITHUB_TOKEN="your-personal-access-token"
   export NODE_ENV="test"
   ```

## Continuous Integration

For CI/CD pipelines, use:
```bash
# Run unit tests only
npm run test:unit

# Or specific test files
npx vitest run --reporter=json apps/api/src/modules/secrets-proxy/proxy-config.spec.ts
```

## Troubleshooting

1. **Import Errors**: Some tests fail due to Bun-specific imports in the source code. These would need to be refactored to be testable in Node.js/Vitest environment.

2. **Missing Dependencies**: If you see module not found errors, ensure you've run `npm install`.

3. **Port Conflicts**: The proxy runs on port 3001 by default. Ensure this port is available.

## Next Steps

1. The basic unit tests validate that the configuration changes are correct
2. Manual testing in a real sandbox environment is the most reliable way to verify the fix works
3. Consider refactoring the services to be more testable (removing Bun-specific imports from core logic)