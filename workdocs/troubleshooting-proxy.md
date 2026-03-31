# Troubleshooting GitHub CLI Authentication in Apex

This guide helps you troubleshoot GitHub CLI authentication issues in Apex sandbox environments.

## Quick Diagnosis

Run this command inside your sandbox to check the setup:

```bash
curl -s https://raw.githubusercontent.com/apex/test-scripts/main/check-github-auth.sh | bash
```

Or manually check:
```bash
# Check if gh CLI works
gh api user
```

If you see:
- ✅ User data → Everything is working!
- ❌ "Bad credentials" → Token issue (see below)
- ❌ "Malformed HTTP response" → Certificate issue (see below)
- ❌ Connection error → Proxy issue (see below)

## Common Issues and Solutions

### 1. "Bad credentials" Error

**Symptoms:**
```
{
  "message": "Bad credentials",
  "documentation_url": "https://docs.github.com/rest",
  "status": "401"
}
```

**Causes:**
- GitHub token not configured in Apex settings
- Proxy not intercepting the request
- Token expired or revoked

**Solutions:**

1. **Check if GitHub token is configured:**
   - Go to Apex Settings
   - Look for "GitHub Token" field
   - Ensure a valid Personal Access Token is entered

2. **Verify proxy is working:**
   ```bash
   # Inside sandbox
   echo $HTTPS_PROXY  # Should show proxy URL
   curl -I --proxy $HTTPS_PROXY https://api.github.com
   ```

3. **Test with a new token:**
   - [Create a new GitHub PAT](https://github.com/settings/tokens/new)
   - Required scopes: `repo`, `workflow`, `read:org`
   - Update in Apex Settings

### 2. "Malformed HTTP response" Error

**Symptoms:**
```
gh: malformed HTTP response
```

**Causes:**
- CA certificate not properly installed
- TLS handshake failure
- Go-specific certificate validation issues

**Solutions:**

1. **Check CA certificate installation:**
   ```bash
   # Check if Apex CA cert exists
   ls -la /usr/local/share/ca-certificates/apex-proxy.crt
   
   # Check if it's in the system bundle
   grep -c "Apex Proxy CA" /etc/ssl/certs/ca-certificates.crt
   ```

2. **Reinstall CA certificates:**
   ```bash
   # Inside sandbox (requires sudo)
   sudo update-ca-certificates
   ```

3. **Verify Go can use the certificates:**
   ```bash
   # Check Go-specific env vars
   env | grep -E "GOFLAGS|SSL_CERT_FILE|CA_BUNDLE"
   ```

### 3. Connection Refused/Timeout

**Symptoms:**
- `connection refused`
- `connect: timeout`
- `proxy connect error`

**Solutions:**

1. **Check proxy is running:**
   ```bash
   # From host machine
   curl http://localhost:3001/health
   ```

2. **Verify proxy settings:**
   ```bash
   # Inside sandbox
   echo $HTTPS_PROXY
   echo $HTTP_PROXY
   ```

3. **Test connectivity:**
   ```bash
   # Test proxy connectivity
   nc -zv $(echo $HTTPS_PROXY | sed 's|.*://||' | sed 's|:| |')
   ```

### 4. Specific gh Commands Failing

**Some commands work, others don't:**

1. **API calls fail but auth status works:**
   ```bash
   gh auth status  # Works
   gh api user     # Fails
   ```
   This usually indicates the proxy is not intercepting api.github.com properly.

2. **PR/Issue commands fail:**
   These commands may use additional GitHub domains. Ensure all domains are covered.

## Advanced Debugging

### Enable Debug Output

```bash
# Debug GitHub CLI
GH_DEBUG=api gh api user 2>&1 | less

# Debug HTTP requests
GH_DEBUG=http gh api user 2>&1 | less

# Debug everything
GH_DEBUG=1 gh api user 2>&1 | less
```

### Check Complete Environment

```bash
#!/bin/bash
echo "=== GitHub CLI Authentication Debug ==="
echo ""
echo "1. Environment Variables:"
env | grep -E "(PROXY|GH_|GITHUB_|SSL_|CURL_|NODE_|GO)" | sort
echo ""
echo "2. Proxy Connectivity:"
if [ -n "$HTTPS_PROXY" ]; then
    proxy_host=$(echo $HTTPS_PROXY | sed 's|.*://||' | sed 's|:.*||')
    proxy_port=$(echo $HTTPS_PROXY | sed 's|.*:||')
    timeout 2 nc -zv "$proxy_host" "$proxy_port" 2>&1
fi
echo ""
echo "3. CA Certificate Status:"
if [ -f /usr/local/share/ca-certificates/apex-proxy.crt ]; then
    echo "✓ Apex CA cert exists"
    openssl x509 -in /usr/local/share/ca-certificates/apex-proxy.crt -noout -subject 2>/dev/null
else
    echo "✗ Apex CA cert missing"
fi
echo ""
echo "4. GitHub CLI Version:"
gh --version 2>/dev/null || echo "gh CLI not installed"
echo ""
echo "5. Test GitHub API:"
gh api user 2>&1 | head -20
```

### Manual Proxy Test

Test the proxy manually with curl:

```bash
# Test with placeholder token (should get replaced by proxy)
curl -v \
  --proxy $HTTPS_PROXY \
  -H "Authorization: Bearer gh-proxy-placeholder" \
  https://api.github.com/user
```

### Container Restart

Sometimes a container restart helps:

```bash
# Exit the sandbox terminal
exit

# From Apex UI, restart the sandbox
# Then reconnect and test again
```

## Verification Steps

After fixing issues, verify everything works:

```bash
# 1. Basic API test
gh api user | jq .login

# 2. Repository operations
gh repo view --json name

# 3. PR operations (if in a repo)
gh pr list --limit 5

# 4. Issue operations
gh issue list --limit 5

# 5. GitHub CLI auth status
gh auth status
```

## When All Else Fails

1. **Check Apex Logs:**
   - Look for `[secrets-proxy]` entries
   - Check for certificate installation errors
   - Monitor token lookup failures

2. **Recreate the Sandbox:**
   - Sometimes a fresh sandbox resolves persistent issues
   - Ensures latest configuration is applied

3. **Report the Issue:**
   - Include output from debug commands
   - Note which gh commands work/fail
   - Mention sandbox type (Docker/Daytona)

## Prevention Tips

1. **Keep GitHub Token Updated:**
   - Rotate tokens periodically
   - Use tokens with appropriate scopes
   - Monitor token expiration

2. **Test After Updates:**
   - Run `gh api user` after Apex updates
   - Verify after sandbox recreations

3. **Use Workspace Scripts:**
   - Add authentication checks to `.apex/setup.sh`
   - Automate token validation

## Quick Reference

| Error | Likely Cause | Quick Fix |
|-------|-------------|-----------|
| Bad credentials | No/invalid token | Update GitHub token in settings |
| Malformed HTTP response | CA cert issue | Run `sudo update-ca-certificates` |
| Connection refused | Proxy down | Check proxy health endpoint |
| Timeout | Network issue | Check HTTPS_PROXY setting |
| Works outside sandbox only | Proxy bypass | Verify env vars are set |

## Getting Help

If issues persist after trying these solutions:

1. Run the complete debug script above
2. Save the output
3. Contact support with:
   - Debug output
   - Sandbox type and ID
   - Steps to reproduce
   - What worked before (if anything)