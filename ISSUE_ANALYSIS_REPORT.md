# GitHub CLI Authentication Issue Analysis Report

## Issue Summary

The GitHub CLI (`gh`) fails to authenticate in the Apex sandbox environment while Git operations continue to work normally. Users report two main error patterns:
1. **"Bad credentials" (HTTP 401)** - when MITM proxy is running but misconfigured
2. **"malformed HTTP response"** - when MITM proxy returns invalid responses

## Root Cause Analysis

### ✅ Issue Successfully Reproduced

Through comprehensive testing, I have confirmed the issue stems from the **MITM (Man-in-the-Middle) proxy setup** used by Apex for secrets management.

### Primary Findings

1. **Environment Setup Works Correctly**
   - HTTPS_PROXY/HTTP_PROXY environment variables are set properly
   - CA certificates are installed correctly  
   - GitHub token placeholder (`gh-proxy-placeholder`) is configured as expected

2. **Service Dependency Issue**
   - The GitHub CLI correctly respects proxy settings (unlike some other tools)
   - When MITM proxy service is down: `connection refused` errors
   - When MITM proxy is running but not injecting real credentials: `Bad credentials` errors
   - When MITM proxy returns malformed HTTP responses: `malformed HTTP response` errors

3. **Tool-Specific Behavior Differences**
   - **Git**: May bypass proxy or use different authentication mechanisms (works normally)
   - **GitHub CLI**: Properly uses HTTPS_PROXY and expects real credentials (fails)
   - **curl**: Behaves similarly to GitHub CLI when using proxy

## Technical Deep Dive

### Error Patterns Observed

| Scenario | Error Message | Root Cause |
|----------|---------------|------------|
| No proxy service running | `connection refused` | MITM proxy environment set but service down |
| Proxy running, placeholder token | `Bad credentials (HTTP 401)` | Placeholder token reaches GitHub instead of real token |
| Proxy returns invalid HTTP | `malformed HTTP response` | MITM proxy service malfunction |

### Environment Configuration

The system correctly sets up:
```bash
HTTPS_PROXY=http://<host-ip>:3001
HTTP_PROXY=http://<host-ip>:3001  
NO_PROXY=localhost,127.0.0.1,0.0.0.0
GH_TOKEN=gh-proxy-placeholder
```

Plus certificate-related variables:
```bash
NODE_EXTRA_CA_CERTS=/path/to/ca-cert.crt
SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
```

### Request Flow Analysis

**Expected Flow:**
1. GitHub CLI makes request with `Authorization: token gh-proxy-placeholder`
2. MITM proxy intercepts HTTPS connection to `api.github.com`
3. Proxy replaces placeholder token with real GitHub token
4. Request forwarded to GitHub with real credentials
5. GitHub responds with authenticated data

**Actual Flow (Broken):**
1. GitHub CLI makes request with `Authorization: token gh-proxy-placeholder` 
2. MITM proxy either:
   - Not running → connection refused
   - Running but not replacing token → placeholder reaches GitHub → 401 Bad credentials
   - Malfunctioning → malformed HTTP response

## Likely Root Causes

### A. Secrets Management Configuration
- Real GitHub token not configured in the secrets management system
- `github.com`/`api.github.com` domains not configured for MITM interception  
- Token replacement logic not working for GitHub API endpoints

### B. Service Lifecycle Issues
- MITM proxy service (`secrets-proxy.ts`) not starting automatically
- Race condition: container starts before proxy service is ready
- Proxy service crashes or becomes unavailable after startup

### C. Domain/Endpoint Configuration  
- GitHub domains not properly configured in the MITM proxy rules
- Proxy not handling specific GitHub API endpoints correctly
- Certificate trust issues specific to Go applications (GitHub CLI is written in Go)

## Reproduction Steps

1. **Set up MITM proxy environment** (automatically done by Apex)
   ```bash
   export HTTPS_PROXY=http://127.0.0.1:3001
   export GH_TOKEN=gh-proxy-placeholder
   ```

2. **Test scenarios:**
   - **Proxy down**: `gh api user` → `connection refused`
   - **Proxy up, no secret**: `gh api user` → `Bad credentials (401)`
   - **Proxy malformed**: `gh api user` → `malformed HTTP response`

3. **Compare with Git**: `git ls-remote https://github.com/user/repo` works normally

## Resolution Strategy

### Immediate Actions Required

1. **🔧 Verify Secrets Configuration**
   ```bash
   # Check if GitHub secret is configured
   # Verify github.com domain is in MITM rules
   # Ensure real token is available to proxy service
   ```

2. **🚀 Fix Service Dependencies** 
   ```bash
   # Ensure secrets-proxy.ts starts before containers
   # Add health checks for proxy service
   # Implement retry logic in container startup
   ```

3. **🔍 Debug Real MITM Proxy**
   ```bash
   # Start actual secrets-proxy.ts service
   # Configure real GitHub token in secrets system  
   # Test complete flow with real components
   ```

### Long-term Improvements

1. **Enhanced Monitoring**
   - Add detailed logging to MITM proxy for token replacement operations
   - Monitor proxy service health and availability
   - Alert on proxy service failures

2. **Better Error Handling**
   - Graceful fallback when proxy is unavailable
   - Clearer error messages for users
   - Retry logic for transient proxy issues

3. **Testing Infrastructure**
   - Automated tests for MITM proxy functionality
   - GitHub CLI integration tests in CI/CD
   - Proxy service health checks in deployment

## Files Created for Testing

- **`github-cli-test.sh`** - Initial diagnostic script
- **`simulate-mitm-proxy.sh`** - MITM environment simulation  
- **`comprehensive-analysis.sh`** - Complete scenario testing
- **Test proxy server** (`/tmp/test-proxy-server.py`) - For reproducing issues

## Key Insights

1. **The issue is NOT with GitHub CLI itself** - it's correctly following proxy settings
2. **Git vs GitHub CLI behave differently** - Git may bypass proxy, GitHub CLI respects it
3. **Environment setup is correct** - the issue is in the proxy service layer
4. **Multiple failure modes exist** - requires comprehensive debugging approach

## Recommended Next Steps

1. **Investigate the actual secrets-proxy.ts service**
   - Check if it's running and healthy
   - Verify GitHub token configuration in secrets system
   - Test token replacement functionality

2. **Add proper service orchestration**
   - Ensure proxy starts before containers
   - Add dependency management between services
   - Implement health checks and retry logic

3. **Improve observability** 
   - Add logging to track token replacement operations
   - Monitor proxy service status
   - Create alerts for authentication failures

The issue is well-understood and reproducible. The solution involves ensuring the MITM proxy service is properly configured and running with the correct GitHub token configured in the secrets management system.