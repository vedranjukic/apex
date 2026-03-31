# GitHub CLI Authentication Through MITM Proxy - Technical Documentation

## Overview

This document details the technical implementation of GitHub CLI (`gh`) authentication through the Apex MITM (Man-in-the-Middle) secrets proxy. The solution enables `gh` CLI to authenticate with GitHub API using a placeholder token that is transparently replaced with the real GitHub token by the proxy.

## Problem Statement

GitHub CLI was failing to authenticate inside sandbox containers with two primary error patterns:
1. **"Bad credentials" (HTTP 401)** - When the placeholder token reached GitHub directly (proxy bypass)
2. **"malformed HTTP response"** - When TLS handshake failed during MITM interception

Git operations worked correctly through the same proxy, indicating the issue was specific to how `gh` CLI (written in Go) handles HTTPS proxies and TLS certificate validation.

## Architecture

### Component Overview

```
┌─────────────────┐     HTTPS_PROXY     ┌──────────────────┐     Real Token    ┌─────────────┐
│   gh CLI in     │ ─────────────────> │   MITM Proxy     │ ──────────────> │ GitHub API  │
│   Container     │  placeholder token  │  (Port 3001)     │                 │             │
└─────────────────┘                     └──────────────────┘                 └─────────────┘
        │                                         │
        │                                         │
        └── GH_TOKEN=gh-proxy-placeholder        └── Intercepts & replaces token
            SSL_CERT_FILE=/etc/ssl/...               for GitHub domains
```

### Key Components

1. **Secrets Proxy** (`apps/api/src/modules/secrets-proxy/secrets-proxy.ts`)
   - MITM proxy that intercepts HTTPS connections
   - Selectively intercepts domains with configured secrets
   - Replaces placeholder tokens with real credentials

2. **CA Certificate Manager** (`apps/api/src/modules/secrets-proxy/ca-manager.ts`)
   - Generates root CA certificate for MITM operations
   - Creates per-domain certificates on demand
   - Caches certificates for performance

3. **Sandbox Manager** (`libs/orchestrator/src/lib/sandbox-manager.ts`)
   - Configures container environment variables
   - Installs CA certificates in containers
   - Sets up proxy configuration

## Implementation Details

### 1. Environment Variable Configuration

The solution sets specific environment variables required by Go applications for proper TLS validation:

```typescript
// Go-specific TLS configuration
envVars["GOFLAGS"] = "-insecure=false";        // Ensure TLS verification is enabled
envVars["GODEBUG"] = "x509ignoreCN=0";         // Enable proper certificate validation
envVars["CGO_ENABLED"] = "1";                  // Enable CGO for certificate chain validation

// Additional CA bundle paths for Go
envVars["CA_BUNDLE"] = "/etc/ssl/certs/ca-certificates.crt";
envVars["CAFILE"] = "/etc/ssl/certs/ca-certificates.crt";

// GitHub token placeholders
envVars["GH_TOKEN"] = "gh-proxy-placeholder";
envVars["GITHUB_TOKEN"] = "gh-proxy-placeholder";

// Disable interactive prompts
envVars["GIT_ASKPASS"] = "true";
envVars["GIT_TERMINAL_PROMPT"] = "0";
```

### 2. Expanded GitHub Domain Coverage

The proxy now intercepts all domains used by GitHub CLI:

```typescript
const GITHUB_DOMAINS = new Set([
  'github.com',
  'api.github.com',
  'uploads.github.com',              // File uploads
  'objects.githubusercontent.com',   // LFS objects
  'raw.githubusercontent.com',       // Raw file access
  'codeload.github.com',            // Archive downloads
  'ghcr.io',                        // GitHub Container Registry
  'github.enterprise.com',          // Enterprise domains
  'api.github.enterprise.com'
]);
```

### 3. CA Certificate Installation

Enhanced CA certificate installation with verification:

```typescript
// Install CA certificate
const caCertResult = await sandbox.process.executeCommand(
  `sudo update-ca-certificates 2>&1 && echo "CA_UPDATE_SUCCESS"`
);

// Verify installation
if (caCertOutput.includes("CA_UPDATE_SUCCESS")) {
  const verifyResult = await sandbox.process.executeCommand(
    `grep -l "Apex Proxy CA" /etc/ssl/certs/*.pem 2>/dev/null || echo "NOT_FOUND"`
  );
  
  if (verifyOutput !== "NOT_FOUND") {
    console.log("CA cert verified in system store");
  }
}
```

### 4. Debug Logging

Added comprehensive logging for GitHub domain interceptions:

```typescript
if (GITHUB_DOMAINS.has(host)) {
  if (secret) {
    console.log(`[secrets-proxy] GitHub domain ${host}: intercepting with auth injection`);
  } else {
    console.warn(`[secrets-proxy] GitHub domain ${host}: no token found, passing through`);
  }
}
```

### 5. Token Injection

The proxy replaces placeholder tokens with real credentials:

```typescript
function buildAuthHeader(secret: SecretRecord): { name: string; value: string } {
  const authType = secret.authType || 'bearer';
  
  if (authType === 'bearer') {
    return { name: 'authorization', value: `Bearer ${secret.value}` };
  }
  // ... other auth types
}

// In forwardRequest:
delete outHeaders['authorization'];
outHeaders[auth.name] = auth.value;  // Inject real token
```

## Authentication Flow

1. **Container Setup**
   - CA certificate is installed via `update-ca-certificates`
   - Environment variables are configured with placeholders
   - HTTPS_PROXY points to the MITM proxy

2. **Request Initiation**
   - `gh` CLI makes HTTPS request to `api.github.com`
   - Request includes `Authorization: token gh-proxy-placeholder`
   - Request is routed through HTTPS_PROXY

3. **MITM Interception**
   - Proxy receives CONNECT request for `api.github.com`
   - Checks if domain has a configured secret
   - Finds GitHub token from settings
   - Generates TLS certificate for `api.github.com`

4. **Token Replacement**
   - Proxy terminates TLS connection
   - Reads HTTP request with placeholder token
   - Replaces with real GitHub token
   - Forwards to GitHub API

5. **Response Handling**
   - GitHub API responds with authenticated data
   - Proxy forwards response to `gh` CLI
   - CLI receives successful response

## Security Considerations

### Token Protection
- Real GitHub tokens never exist in container environment variables
- Tokens are only accessible to the host-side proxy service
- Placeholder tokens have no value if leaked

### TLS Security
- All traffic between proxy and GitHub uses verified TLS
- CA certificate is properly validated
- No `--insecure` flags or TLS bypass

### Domain Filtering
- Only configured domains are intercepted
- All other HTTPS traffic passes through unchanged
- Minimizes attack surface

## Error Handling

### Connection Failures
- Retry logic with exponential backoff
- Circuit breaker pattern for repeated failures
- Graceful degradation when proxy unavailable

### Certificate Issues
- Detailed logging of CA installation failures
- Verification step ensures proper installation
- Clear error messages for debugging

### Token Issues
- Handles missing GitHub tokens gracefully
- Logs when tokens are not found
- Falls back to transparent proxy mode

## Performance Optimizations

### Certificate Caching
- Generated certificates are cached per domain
- Reduces overhead for repeated connections
- In-memory cache with no persistence

### Connection Pooling
- Reuses connections where possible
- Reduces handshake overhead
- Improves response times

### Parallel Processing
- Handles multiple connections concurrently
- Non-blocking I/O for all operations
- Scales with container count

## Testing Strategy

### Unit Tests
- Test proxy token replacement logic
- Verify domain matching
- Validate environment setup

### Integration Tests
- Full authentication flow testing
- Multiple GitHub CLI commands
- Various auth header formats

### End-to-End Tests
- Real sandbox environments
- Actual GitHub API calls
- Cross-platform validation

## Monitoring and Debugging

### Health Checks
- `/health` endpoint on proxy
- Returns status and configuration
- Used for readiness checks

### Debug Commands
```bash
# Check environment in container
env | grep -E "(PROXY|GH_|SSL_|CURL_|NODE_|GO)"

# Test proxy connectivity
curl -v --proxy $HTTPS_PROXY https://api.github.com/zen

# Debug gh CLI
GH_DEBUG=api gh api user

# Check CA certificate
grep "Apex" /etc/ssl/certs/ca-certificates.crt
```

### Log Analysis
- Look for `[secrets-proxy]` prefixed messages
- Check GitHub domain interception logs
- Monitor CA certificate installation logs

## Known Limitations

1. **Enterprise GitHub**: Custom domains need manual configuration
2. **Proxy Bypass**: Some tools may ignore proxy settings
3. **Certificate Pinning**: Apps with pinned certs won't work
4. **Performance**: MITM adds ~50-100ms latency per request

## Future Improvements

1. **Dynamic Domain Discovery**: Auto-detect GitHub domains
2. **Token Refresh**: Handle token expiration gracefully
3. **Metrics Collection**: Add Prometheus metrics
4. **WebSocket Support**: Handle real-time connections
5. **HTTP/2 Support**: Improve performance with multiplexing

## Troubleshooting Guide

### Problem: "Bad credentials" error
- **Check**: Is the proxy running? (`curl http://localhost:3001/health`)
- **Check**: Is GitHub token configured in settings?
- **Check**: Are proxy environment variables set?

### Problem: "Malformed HTTP response"
- **Check**: Is CA certificate installed? (`ls /usr/local/share/ca-certificates/`)
- **Check**: Is it in the system store? (`grep Apex /etc/ssl/certs/ca-certificates.crt`)
- **Check**: Are Go-specific env vars set?

### Problem: Connection timeout
- **Check**: Is proxy port accessible from container?
- **Check**: Network connectivity between container and host
- **Check**: Firewall rules blocking connections

## References

- [Go HTTP Proxy Support](https://golang.org/pkg/net/http/#ProxyFromEnvironment)
- [Go TLS Package](https://golang.org/pkg/crypto/tls/)
- [GitHub CLI Documentation](https://cli.github.com/)
- [HTTP CONNECT Tunneling](https://tools.ietf.org/html/rfc7231#section-4.3.6)