#!/bin/bash

# Test script for GitHub CLI authentication through MITM proxy
# This script helps validate the fixes implemented for issue #16

set -e

echo "=== GitHub CLI Authentication Test ==="
echo "Testing GitHub CLI authentication through MITM secrets proxy"
echo ""

# Check environment setup
echo "1. Checking environment setup..."
echo "   HTTPS_PROXY: ${HTTPS_PROXY:-<not set>}"
echo "   GH_TOKEN: ${GH_TOKEN:-<not set>}"
echo "   GITHUB_TOKEN: ${GITHUB_TOKEN:-<not set>}"
echo "   SSL_CERT_FILE: ${SSL_CERT_FILE:-<not set>}"
echo ""

# Check if proxy is reachable
echo "2. Checking proxy connectivity..."
if [ -n "$HTTPS_PROXY" ]; then
    PROXY_HOST=$(echo $HTTPS_PROXY | sed 's|.*://||' | sed 's|:.*||')
    PROXY_PORT=$(echo $HTTPS_PROXY | sed 's|.*:||')
    if timeout 5 nc -z "$PROXY_HOST" "$PROXY_PORT" 2>/dev/null; then
        echo "   ✓ Proxy is reachable at $PROXY_HOST:$PROXY_PORT"
    else
        echo "   ✗ Proxy is NOT reachable at $PROXY_HOST:$PROXY_PORT"
    fi
else
    echo "   ⚠ No proxy configured"
fi
echo ""

# Check CA certificate installation
echo "3. Checking CA certificate setup..."
if [ -f "/etc/ssl/certs/ca-certificates.crt" ]; then
    echo "   ✓ System CA bundle exists"
    if grep -q "Apex" "/etc/ssl/certs/ca-certificates.crt" 2>/dev/null; then
        echo "   ✓ Apex CA found in system bundle"
    else
        echo "   ⚠ Apex CA not found in system bundle"
    fi
else
    echo "   ✗ System CA bundle missing"
fi

if [ -f "/usr/local/share/ca-certificates/apex-proxy.crt" ]; then
    echo "   ✓ Apex proxy CA cert exists"
    # Check if it's a valid certificate
    if openssl x509 -in "/usr/local/share/ca-certificates/apex-proxy.crt" -noout -text >/dev/null 2>&1; then
        echo "   ✓ Apex proxy CA cert is valid"
    else
        echo "   ✗ Apex proxy CA cert is invalid"
    fi
else
    echo "   ⚠ Apex proxy CA cert not found"
fi
echo ""

# Test basic connectivity
echo "4. Testing basic connectivity..."

echo "   Testing direct connection to api.github.com..."
if timeout 10 curl -s -o /dev/null -w "%{http_code}" https://api.github.com/zen 2>/dev/null | grep -q "200"; then
    echo "   ✓ Direct HTTPS connection to api.github.com works"
else
    echo "   ✗ Direct HTTPS connection to api.github.com failed"
fi

# Test with placeholder token (this should fail with 401)
echo "   Testing with placeholder token..."
if [ -n "$GH_TOKEN" ]; then
    RESPONSE=$(timeout 10 curl -s -w "%{http_code}" -H "Authorization: Bearer ${GH_TOKEN}" https://api.github.com/user 2>/dev/null || echo "000")
    case "$RESPONSE" in
        *401*)
            echo "   ✓ Placeholder token correctly returns 401 (expected if proxy not working)"
            ;;
        *200*)
            echo "   ✓ Authentication successful! Proxy is working correctly"
            ;;
        *000*)
            echo "   ✗ Connection failed or timed out"
            ;;
        *)
            echo "   ⚠ Unexpected response: $RESPONSE"
            ;;
    esac
else
    echo "   ⚠ No GH_TOKEN set, skipping auth test"
fi
echo ""

# Test GitHub CLI
echo "5. Testing GitHub CLI..."

# Check if gh is installed
if command -v gh >/dev/null 2>&1; then
    echo "   ✓ GitHub CLI is installed: $(gh --version | head -1)"
    
    # Test basic gh command
    echo "   Testing 'gh api /zen'..."
    if GH_PAGER= timeout 30 gh api /zen >/dev/null 2>&1; then
        echo "   ✓ GitHub CLI basic API call successful"
    else
        echo "   ✗ GitHub CLI basic API call failed"
        
        # Try with debug output for troubleshooting
        echo "   Debug output:"
        GH_DEBUG=api GH_PAGER= timeout 10 gh api /zen 2>&1 | head -10 | sed 's/^/      /'
    fi
    
    # Test user info
    echo "   Testing 'gh api /user'..."
    if GH_PAGER= timeout 30 gh api /user >/dev/null 2>&1; then
        echo "   ✓ GitHub CLI user API call successful"
        # Show user info if successful
        USER_INFO=$(GH_PAGER= gh api /user 2>/dev/null | jq -r '.login // .name // "Unknown"' 2>/dev/null || echo "Unknown")
        echo "      Authenticated as: $USER_INFO"
    else
        echo "   ✗ GitHub CLI user API call failed"
        
        # Get error details
        ERROR_OUTPUT=$(GH_DEBUG=api GH_PAGER= timeout 10 gh api /user 2>&1 | tail -5)
        echo "      Error: $ERROR_OUTPUT" | sed 's/^/      /'
    fi
else
    echo "   ✗ GitHub CLI not installed"
    echo "      Installing GitHub CLI..."
    
    # Try to install gh
    if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
        sudo apt update && sudo apt install gh -y
        
        if command -v gh >/dev/null 2>&1; then
            echo "   ✓ GitHub CLI installed successfully"
        else
            echo "   ✗ Failed to install GitHub CLI"
        fi
    else
        echo "      Cannot install GitHub CLI (apt-get not available)"
    fi
fi
echo ""

# Test Git operations for comparison
echo "6. Testing Git operations (for comparison)..."
if command -v git >/dev/null 2>&1; then
    echo "   Testing Git with HTTPS..."
    
    # Test git ls-remote (this should work according to the issue)
    if timeout 30 git ls-remote --heads https://github.com/octocat/Hello-World.git >/dev/null 2>&1; then
        echo "   ✓ Git HTTPS operations work (as expected)"
    else
        echo "   ⚠ Git HTTPS operations failed (unexpected)"
    fi
else
    echo "   ⚠ Git not available"
fi
echo ""

echo "=== Test Complete ==="
echo ""
echo "Summary:"
echo "- If GitHub CLI works but Git doesn't: Issue likely resolved"
echo "- If both fail: Check proxy service and CA certificates"  
echo "- If both work: Issue was already resolved or not reproducible"
echo "- For more detailed debugging, check proxy logs for GitHub domain interceptions"