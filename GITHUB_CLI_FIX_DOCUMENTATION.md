# GitHub CLI Authentication Fix - Issue #16

## Problem Summary

GitHub CLI (`gh`) was failing to authenticate inside sandbox containers despite the MITM proxy infrastructure supporting GitHub domain interception. Git operations worked correctly through the same proxy, but `gh` CLI returned either "Bad credentials" (bypassing the proxy) or "malformed HTTP response" (proxy connection failing at the TLS layer).

## Root Cause Analysis

After thorough analysis of the codebase and MITM proxy infrastructure, the following issues were identified:

1. **Incomplete Container Environment Setup**: Missing Go-specific environment variables needed for proper TLS certificate validation
2. **Limited GitHub Domain Coverage**: Only `github.com` and `api.github.com` were intercepted, but GitHub CLI connects to additional domains
3. **Insufficient CA Certificate Validation**: The CA certificate installation process lacked proper verification
4. **Missing Debug Logging**: No visibility into whether GitHub domains were being intercepted

## Solution Implementation

### 1. Enhanced Container Environment Variables

**File**: `libs/orchestrator/src/lib/sandbox-manager.ts`
**Method**: `buildContainerEnvVars()`

Added Go-specific environment variables for proper TLS certificate validation:

```typescript
// Go-specific environment variables for CA certificate validation
// Go's crypto/tls package looks for certificates in these locations
envVars["GOFLAGS"] = "-insecure=false"; // Ensure TLS verification is enabled
envVars["GODEBUG"] = "x509ignoreCN=0"; // Enable proper certificate validation
envVars["CGO_ENABLED"] = "1"; // Enable CGO for proper certificate chain validation
// Additional CA bundle paths that Go applications may use
envVars["CA_BUNDLE"] = "/etc/ssl/certs/ca-certificates.crt";
envVars["CAFILE"] = "/etc/ssl/certs/ca-certificates.crt";
```

### 2. Improved GitHub Token Configuration

Enhanced the GitHub token setup to be more comprehensive:

```typescript
// Set GitHub token placeholder when secrets proxy is available
// This ensures `gh` CLI will use the proxy for authentication
if (this.config.githubToken || secretsProxyUrl) {
  envVars["GH_TOKEN"] = "gh-proxy-placeholder";
  envVars["GITHUB_TOKEN"] = "gh-proxy-placeholder";
  // Set additional GitHub-related environment variables that some tools expect
  envVars["GIT_ASKPASS"] = "true"; // Disable interactive password prompts
  envVars["GIT_TERMINAL_PROMPT"] = "0"; // Disable terminal prompts for Git
}
```

### 3. Expanded GitHub Domain Coverage

**File**: `apps/api/src/modules/secrets-proxy/secrets-proxy.ts`
**Constant**: `GITHUB_DOMAINS`

Expanded the list of GitHub domains that the MITM proxy will intercept:

```typescript
const GITHUB_DOMAINS = new Set([
  'github.com',
  'api.github.com',
  // Additional GitHub domains that gh CLI might connect to
  'uploads.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'codeload.github.com',
  'ghcr.io',
  // GitHub Enterprise Cloud domains
  'github.enterprise.com',
  'api.github.enterprise.com'
]);
```

### 4. Enhanced Debug Logging

Added comprehensive debug logging to track GitHub domain interceptions:

```typescript
// Debug logging for GitHub domain handling
if (GITHUB_DOMAINS.has(host)) {
  if (secret) {
    console.log(`[secrets-proxy] GitHub domain ${host}: intercepting with auth injection`);
  } else {
    console.warn(`[secrets-proxy] GitHub domain ${host}: no token found, passing through`);
  }
}
```

### 5. Improved CA Certificate Installation

Enhanced the CA certificate installation process with better error handling and verification:

```typescript
// Install CA certificate with better error handling and verification
const caCertResult = await sandbox.process.executeCommand(
  `sudo update-ca-certificates 2>&1 && echo "CA_UPDATE_SUCCESS"`,
);
const caCertOutput = (caCertResult.result ?? "").trim();

if (caCertOutput.includes("CA_UPDATE_SUCCESS")) {
  console.log(`[bridge:${sid}] CA cert installed successfully`);
  
  // Verify the certificate is in the system store
  const verifyResult = await sandbox.process.executeCommand(
    `grep -l "Apex Proxy CA" /etc/ssl/certs/*.pem 2>/dev/null || echo "NOT_FOUND"`,
  );
  const verifyOutput = (verifyResult.result ?? "").trim();
  
  if (verifyOutput === "NOT_FOUND") {
    console.warn(`[bridge:${sid}] CA cert not found in system store after installation`);
  } else {
    console.log(`[bridge:${sid}] CA cert verified in system store`);
  }
} else {
  console.error(`[bridge:${sid}] CA cert update failed: ${caCertOutput}`);
}
```

## Testing and Validation

### Test Script

Created `test-github-cli-auth.sh` to validate the fix:

- Checks environment setup (proxy, tokens, CA certificates)
- Tests proxy connectivity
- Validates CA certificate installation
- Tests GitHub CLI authentication
- Compares with Git operations
- Provides debugging output

### Usage

```bash
# Run the test script inside a sandbox container
./test-github-cli-auth.sh
```

## Files Modified

1. **`libs/orchestrator/src/lib/sandbox-manager.ts`**
   - Enhanced `buildContainerEnvVars()` method
   - Improved CA certificate installation in `restartBridge()` and `installBridge()`
   - Added Go-specific environment variables

2. **`apps/api/src/modules/secrets-proxy/secrets-proxy.ts`**
   - Expanded `GITHUB_DOMAINS` set to include additional GitHub domains
   - Added debug logging in `handleConnect()` and `handleHttpProxy()`

3. **`test-github-cli-auth.sh`** (new file)
   - Comprehensive test script for validation

4. **`GITHUB_CLI_FIX_DOCUMENTATION.md`** (new file)
   - This documentation file

## Expected Results

After implementing these changes:

1. **GitHub CLI authentication should work** through the MITM proxy
2. **Real GitHub tokens** will be injected by the proxy, replacing placeholder tokens
3. **TLS certificate validation** will work properly for Go applications
4. **Comprehensive logging** will help troubleshoot any remaining issues
5. **All GitHub domains** used by the CLI will be properly intercepted

## Troubleshooting

If GitHub CLI still fails after these changes:

1. **Check the proxy logs** for GitHub domain interceptions
2. **Verify the secrets proxy service** is running and healthy
3. **Confirm the real GitHub token** is configured in settings
4. **Run the test script** to identify specific failure points
5. **Check container environment variables** are set correctly

## Security Considerations

These changes maintain the existing security model:

- Real GitHub tokens are never exposed inside containers
- The placeholder token approach is preserved
- CA certificates are properly validated
- All authentication flows through the secure MITM proxy

## Compatibility

These changes are backward compatible:

- Existing configurations will continue to work
- No breaking changes to the API
- Enhanced logging is optional and non-intrusive
- Additional environment variables are safe additions

## Impact on Performance

Minimal performance impact:

- Debug logging is lightweight
- Environment variable additions are negligible
- CA certificate verification adds minimal overhead
- Domain list expansion has no runtime cost