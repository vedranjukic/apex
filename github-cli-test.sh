#!/bin/bash

# GitHub CLI Authentication Diagnostic Test
# This script reproduces and diagnoses the GitHub CLI authentication issue
# where Git operations work but `gh` CLI fails with proxy authentication

set -e

echo "🔍 GitHub CLI Authentication Diagnostic Test"
echo "=============================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_section() {
    echo -e "\n${BLUE}📋 $1${NC}"
    echo "----------------------------------------"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 1. Environment Variables Check
log_section "Environment Variables"
echo "Checking proxy and certificate environment variables:"

env_vars=("HTTP_PROXY" "HTTPS_PROXY" "NO_PROXY" "SSL_CERT_FILE" "SSL_CERT_DIR")
for var in "${env_vars[@]}"; do
    value="${!var}"
    if [[ -n "$value" ]]; then
        log_success "$var=$value"
    else
        log_warning "$var is not set"
    fi
done

# Check for GitHub-specific environment variables
github_vars=("GITHUB_TOKEN" "GH_TOKEN")
for var in "${github_vars[@]}"; do
    value="${!var}"
    if [[ -n "$value" ]]; then
        log_success "$var is set (length: ${#value})"
    else
        log_warning "$var is not set"
    fi
done

# 2. CA Certificate Check
log_section "CA Certificate Installation"

# Check if the Apex Secrets Proxy CA certificate is installed
if [[ -f "/usr/local/share/ca-certificates/apex-secrets-proxy-ca.crt" ]]; then
    log_success "Apex Secrets Proxy CA certificate found"
    echo "Certificate info:"
    openssl x509 -in /usr/local/share/ca-certificates/apex-secrets-proxy-ca.crt -text -noout | grep -E "(Subject:|Issuer:|Not Before:|Not After:)"
else
    log_error "Apex Secrets Proxy CA certificate NOT found at /usr/local/share/ca-certificates/apex-secrets-proxy-ca.crt"
fi

# Check system CA bundle
if [[ -f "/etc/ssl/certs/ca-certificates.crt" ]]; then
    if grep -q "Apex Secrets Proxy CA" /etc/ssl/certs/ca-certificates.crt; then
        log_success "Apex Secrets Proxy CA found in system CA bundle"
    else
        log_error "Apex Secrets Proxy CA NOT found in system CA bundle"
    fi
else
    log_error "System CA bundle not found at /etc/ssl/certs/ca-certificates.crt"
fi

# 3. Network Connectivity Test
log_section "Network Connectivity Tests"

# Test direct connection (should fail if proxy is required)
echo "Testing direct connection to GitHub API:"
if curl -s --max-time 5 https://api.github.com/user > /dev/null 2>&1; then
    log_warning "Direct connection to GitHub API works (proxy bypass?)"
else
    log_success "Direct connection to GitHub API blocked (proxy working as expected)"
fi

# Test connection through proxy
if [[ -n "$HTTPS_PROXY" ]]; then
    echo "Testing connection through proxy ($HTTPS_PROXY):"
    if curl -s --max-time 10 --proxy "$HTTPS_PROXY" https://api.github.com/user > /dev/null 2>&1; then
        log_success "Proxy connection to GitHub API works"
    else
        log_error "Proxy connection to GitHub API failed"
    fi
fi

# 4. Test curl with GitHub API
log_section "curl with GitHub API"

if [[ -n "${GITHUB_TOKEN}" ]]; then
    echo "Testing authenticated curl to GitHub API:"
    response=$(curl -s -w "HTTPSTATUS:%{http_code}" -H "Authorization: Bearer ${GITHUB_TOKEN}" https://api.github.com/user 2>&1)
    http_status=$(echo "$response" | grep -o "HTTPSTATUS:[0-9]*" | cut -d: -f2)
    body=$(echo "$response" | sed -E 's/HTTPSTATUS:[0-9]*$//')
    
    if [[ "$http_status" == "200" ]]; then
        log_success "curl authentication successful (HTTP $http_status)"
        username=$(echo "$body" | python3 -c "import sys, json; print(json.load(sys.stdin).get('login', 'unknown'))" 2>/dev/null || echo "unknown")
        echo "Authenticated as: $username"
    else
        log_error "curl authentication failed (HTTP $http_status)"
        echo "Response: $body"
    fi
else
    log_warning "No GitHub token available for authenticated curl test"
fi

# 5. Git Operations Test
log_section "Git Operations"

# Test git with a simple operation
echo "Testing git operations:"
if git ls-remote --heads https://github.com/octocat/Hello-World.git > /dev/null 2>&1; then
    log_success "git ls-remote works"
else
    log_error "git ls-remote failed"
fi

# 6. GitHub CLI Tests
log_section "GitHub CLI Tests"

# Check if gh is installed
if command -v gh > /dev/null 2>&1; then
    log_success "GitHub CLI (gh) is installed"
    gh --version
    echo
    
    # Check gh auth status
    echo "Checking gh auth status:"
    if gh auth status 2>&1 | grep -q "Logged in"; then
        log_success "gh auth status shows logged in"
        gh auth status
    else
        log_error "gh auth status shows not logged in"
        gh auth status 2>&1 || true
    fi
    
    echo
    
    # Test gh API call
    echo "Testing gh api call:"
    if gh api user > /dev/null 2>&1; then
        log_success "gh api user successful"
        username=$(gh api user | python3 -c "import sys, json; print(json.load(sys.stdin).get('login', 'unknown'))" 2>/dev/null || echo "unknown")
        echo "Authenticated as: $username"
    else
        log_error "gh api user failed"
        echo "Error output:"
        gh api user 2>&1 || true
    fi
    
    echo
    
    # Test gh with verbose output to see what's happening
    echo "Testing gh with verbose output:"
    GH_DEBUG=api gh api user 2>&1 | head -20 || true
    
else
    log_error "GitHub CLI (gh) is not installed"
fi

# 7. TLS/SSL Debug
log_section "TLS/SSL Debug Information"

# Check if we can connect to GitHub's TLS endpoint
echo "Testing TLS connection to api.github.com:"
if echo "Q" | openssl s_client -connect api.github.com:443 -verify_return_error > /dev/null 2>&1; then
    log_success "TLS connection to api.github.com successful"
else
    log_error "TLS connection to api.github.com failed"
    echo "Detailed TLS connection attempt:"
    echo "Q" | timeout 10 openssl s_client -connect api.github.com:443 -verify_return_error 2>&1 | head -20 || true
fi

# 8. Go TLS Debug (since gh is written in Go)
log_section "Go TLS Debug"

# Create a simple Go program to test TLS similar to how gh CLI would
cat << 'EOF' > /tmp/test_go_tls.go
package main

import (
    "crypto/tls"
    "fmt"
    "io"
    "net/http"
    "os"
)

func main() {
    // Test with system cert pool (similar to how gh CLI works)
    client := &http.Client{
        Transport: &http.Transport{
            TLSClientConfig: &tls.Config{},
        },
    }
    
    req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
    if err != nil {
        fmt.Printf("Error creating request: %v\n", err)
        os.Exit(1)
    }
    
    // Add auth header if token is available
    if token := os.Getenv("GITHUB_TOKEN"); token != "" {
        req.Header.Set("Authorization", "Bearer " + token)
    }
    
    resp, err := client.Do(req)
    if err != nil {
        fmt.Printf("Error making request: %v\n", err)
        os.Exit(1)
    }
    defer resp.Body.Close()
    
    fmt.Printf("Status: %s\n", resp.Status)
    
    if resp.StatusCode == 200 {
        body, _ := io.ReadAll(resp.Body)
        fmt.Printf("Success! Response length: %d bytes\n", len(body))
    } else {
        fmt.Printf("HTTP error: %d\n", resp.StatusCode)
    }
}
EOF

if command -v go > /dev/null 2>&1; then
    echo "Testing Go TLS connection (similar to gh CLI):"
    if go run /tmp/test_go_tls.go 2>&1; then
        log_success "Go TLS connection works"
    else
        log_error "Go TLS connection failed"
    fi
else
    log_warning "Go compiler not available for TLS test"
fi

# 9. Proxy Debug
log_section "Proxy Debug Information"

if [[ -n "$HTTPS_PROXY" ]]; then
    proxy_host=$(echo "$HTTPS_PROXY" | sed 's|http://||' | sed 's|https://||' | cut -d: -f1)
    proxy_port=$(echo "$HTTPS_PROXY" | sed 's|http://||' | sed 's|https://||' | cut -d: -f2 | cut -d/ -f1)
    
    echo "Testing proxy connectivity to $proxy_host:$proxy_port:"
    if nc -z "$proxy_host" "$proxy_port" 2>/dev/null; then
        log_success "Proxy server is reachable"
    else
        log_error "Proxy server is not reachable"
    fi
    
    # Test proxy with a simple CONNECT request
    echo "Testing CONNECT request through proxy:"
    (
        echo -e "CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n"
        sleep 1
    ) | nc "$proxy_host" "$proxy_port" 2>/dev/null | head -5 || log_error "CONNECT test failed"
fi

# 10. Summary
log_section "Summary and Recommendations"

echo "Key findings:"
echo "1. Environment setup:"
if [[ -n "$HTTPS_PROXY" ]]; then
    echo "   - HTTPS_PROXY is configured: $HTTPS_PROXY"
else
    echo "   - ❌ HTTPS_PROXY is not set"
fi

if [[ -f "/usr/local/share/ca-certificates/apex-secrets-proxy-ca.crt" ]]; then
    echo "   - ✅ Apex Secrets Proxy CA certificate is installed"
else
    echo "   - ❌ Apex Secrets Proxy CA certificate is missing"
fi

echo
echo "2. Authentication:"
if [[ -n "${GITHUB_TOKEN}" ]]; then
    echo "   - ✅ GitHub token is available"
else
    echo "   - ❌ GitHub token is not set"
fi

echo
echo "Next steps to investigate:"
echo "- Check if gh CLI is using the proxy correctly"
echo "- Verify if Go's crypto/tls respects the system CA bundle"
echo "- Test if the issue is specific to certain GitHub API endpoints"
echo "- Check gh CLI configuration and auth method"

# Cleanup
rm -f /tmp/test_go_tls.go

echo
echo "🎯 Test completed!"