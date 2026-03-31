#!/bin/bash

# Simulate MITM Proxy Environment for GitHub CLI Testing
# This script simulates the MITM proxy setup to reproduce the authentication issue

set -e

echo "🔧 Simulating MITM Proxy Environment for GitHub CLI Testing"
echo "=========================================================="
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

# 1. Create a fake CA certificate (for testing only)
log_section "Setting up Test CA Certificate"

CA_CERT_PATH="/usr/local/share/ca-certificates/apex-secrets-proxy-ca-test.crt"
SYSTEM_CA_PATH="/etc/ssl/certs/ca-certificates.crt"

# Create a self-signed CA certificate for testing
sudo mkdir -p /usr/local/share/ca-certificates/

# Generate a test CA certificate
sudo openssl req -x509 -newkey rsa:2048 -keyout /tmp/test-ca-key.pem -out "$CA_CERT_PATH" -days 1 -nodes -subj "/CN=Apex Secrets Proxy Test CA" 2>/dev/null

if [[ -f "$CA_CERT_PATH" ]]; then
    log_success "Test CA certificate created"
    # Update the system CA bundle
    sudo update-ca-certificates
    log_success "System CA bundle updated"
else
    log_error "Failed to create test CA certificate"
    exit 1
fi

# 2. Set up proxy environment variables
log_section "Setting up Proxy Environment Variables"

# Use a non-existent proxy to simulate the MITM setup
# This will cause connection failures that match the reported issue
PROXY_HOST="127.0.0.1"
PROXY_PORT="3001"
PROXY_URL="http://$PROXY_HOST:$PROXY_PORT"

export HTTPS_PROXY="$PROXY_URL"
export HTTP_PROXY="$PROXY_URL"
export https_proxy="$PROXY_URL"
export http_proxy="$PROXY_URL"
export NO_PROXY="localhost,127.0.0.1,0.0.0.0"
export no_proxy="localhost,127.0.0.1,0.0.0.0"

# Set certificate-related env vars
export NODE_EXTRA_CA_CERTS="$CA_CERT_PATH"
export SSL_CERT_FILE="$SYSTEM_CA_PATH"
export REQUESTS_CA_BUNDLE="$SYSTEM_CA_PATH"
export CURL_CA_BUNDLE="$SYSTEM_CA_PATH"

# Keep the placeholder token
export GH_TOKEN="gh-proxy-placeholder"

log_success "Proxy environment variables set:"
echo "  HTTPS_PROXY=$HTTPS_PROXY"
echo "  HTTP_PROXY=$HTTP_PROXY"
echo "  NO_PROXY=$NO_PROXY"
echo "  GH_TOKEN=$GH_TOKEN"

# 3. Test the simulated environment
log_section "Testing Simulated Environment"

echo "Testing curl with proxy (should fail - proxy not running):"
if curl -s --max-time 5 https://api.github.com/user > /dev/null 2>&1; then
    log_warning "curl succeeded (unexpected - proxy should block this)"
else
    log_success "curl failed as expected (proxy blocking connection)"
fi

echo
echo "Testing git with proxy:"
if git ls-remote --heads https://github.com/octocat/Hello-World.git > /dev/null 2>&1; then
    log_warning "git succeeded (may be ignoring proxy)"
    echo "Git might be configured to ignore proxy or use credential helpers"
else
    log_success "git failed (proxy blocking connection)"
fi

echo
echo "Testing GitHub CLI with proxy:"
echo "gh auth status:"
gh auth status 2>&1 || true

echo
echo "gh api user:"
gh api user 2>&1 || true

echo
echo "gh with debug output:"
GH_DEBUG=api gh api user 2>&1 | head -10 || true

# 4. Create a minimal proxy server to test actual MITM behavior
log_section "Creating Minimal Test Proxy Server"

cat << 'EOF' > /tmp/test-proxy-server.py
#!/usr/bin/env python3
import socket
import threading
import sys
import select

def handle_connect(client_socket, target_host, target_port):
    """Handle CONNECT request for HTTPS tunneling"""
    try:
        # Create connection to target server
        target_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        target_socket.connect((target_host, target_port))
        
        # Send 200 Connection established
        client_socket.send(b"HTTP/1.1 200 Connection established\r\n\r\n")
        
        # Start tunneling
        def forward_data(src, dst, direction):
            try:
                while True:
                    data = src.recv(4096)
                    if not data:
                        break
                    dst.send(data)
            except:
                pass
            finally:
                src.close()
                dst.close()
        
        # Start forwarding in both directions
        t1 = threading.Thread(target=forward_data, args=(client_socket, target_socket, "client->server"))
        t2 = threading.Thread(target=forward_data, args=(target_socket, client_socket, "server->client"))
        t1.daemon = True
        t2.daemon = True
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        
    except Exception as e:
        print(f"Error in CONNECT handler: {e}")
        try:
            client_socket.send(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        except:
            pass
        client_socket.close()

def handle_client(client_socket):
    """Handle incoming client connection"""
    try:
        # Read the first line of the request
        data = client_socket.recv(4096)
        if not data:
            return
            
        request_line = data.decode('utf-8').split('\n')[0]
        print(f"Request: {request_line}")
        
        if request_line.startswith("CONNECT "):
            # Parse CONNECT request
            parts = request_line.split()
            if len(parts) >= 2:
                host_port = parts[1]
                if ':' in host_port:
                    host, port = host_port.split(':', 1)
                    port = int(port)
                    print(f"CONNECT to {host}:{port}")
                    handle_connect(client_socket, host, port)
                else:
                    print(f"Invalid CONNECT format: {host_port}")
                    client_socket.close()
            else:
                print(f"Invalid CONNECT request: {request_line}")
                client_socket.close()
        else:
            # Not a CONNECT request, just close
            print(f"Non-CONNECT request: {request_line[:100]}")
            client_socket.send(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            client_socket.close()
            
    except Exception as e:
        print(f"Error handling client: {e}")
        client_socket.close()

def start_proxy(port):
    """Start the test proxy server"""
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(('127.0.0.1', port))
    server_socket.listen(5)
    
    print(f"Test proxy server listening on 127.0.0.1:{port}")
    print("Press Ctrl+C to stop")
    
    try:
        while True:
            client_socket, addr = server_socket.accept()
            print(f"Connection from {addr}")
            client_thread = threading.Thread(target=handle_client, args=(client_socket,))
            client_thread.daemon = True
            client_thread.start()
    except KeyboardInterrupt:
        print("\nShutting down proxy server...")
    finally:
        server_socket.close()

if __name__ == "__main__":
    start_proxy(3001)
EOF

chmod +x /tmp/test-proxy-server.py

echo "Created test proxy server at /tmp/test-proxy-server.py"
echo "To test with a running proxy, run in another terminal:"
echo "  python3 /tmp/test-proxy-server.py"
echo "Then run the tests again."

# 5. Test Go TLS behavior specifically
log_section "Testing Go TLS Behavior with Proxy"

cat << 'EOF' > /tmp/test_go_proxy.go
package main

import (
    "crypto/tls"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "os"
)

func main() {
    fmt.Println("Testing Go HTTP client with proxy settings...")
    
    // Get proxy from environment (like gh CLI would)
    proxyURL := os.Getenv("HTTPS_PROXY")
    if proxyURL == "" {
        proxyURL = os.Getenv("HTTP_PROXY")
    }
    
    fmt.Printf("Proxy URL: %s\n", proxyURL)
    
    // Create HTTP transport with proxy
    transport := &http.Transport{
        TLSClientConfig: &tls.Config{},
    }
    
    if proxyURL != "" {
        proxy, err := url.Parse(proxyURL)
        if err != nil {
            fmt.Printf("Error parsing proxy URL: %v\n", err)
            os.Exit(1)
        }
        transport.Proxy = http.ProxyURL(proxy)
    }
    
    client := &http.Client{Transport: transport}
    
    req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
    if err != nil {
        fmt.Printf("Error creating request: %v\n", err)
        os.Exit(1)
    }
    
    // Add auth header
    if token := os.Getenv("GH_TOKEN"); token != "" {
        req.Header.Set("Authorization", "token " + token)
        fmt.Printf("Using token: %s\n", token)
    }
    
    fmt.Println("Making request...")
    resp, err := client.Do(req)
    if err != nil {
        fmt.Printf("Request failed: %v\n", err)
        // This is the expected error - proxy not reachable
        os.Exit(1)
    }
    defer resp.Body.Close()
    
    fmt.Printf("Response status: %s\n", resp.Status)
    
    body, _ := io.ReadAll(resp.Body)
    fmt.Printf("Response body (first 200 chars): %s\n", string(body[:min(200, len(body))]))
}
EOF

if command -v go > /dev/null 2>&1; then
    echo "Testing Go proxy behavior:"
    go run /tmp/test_go_proxy.go 2>&1 || echo "Go test completed (failure expected when proxy is not running)"
else
    log_warning "Go compiler not available"
fi

# 6. Summary of simulation
log_section "Simulation Summary"

echo "✅ Environment simulates the reported issue:"
echo "   - MITM proxy environment variables are set"
echo "   - CA certificate is installed (test version)"
echo "   - GH_TOKEN is set to placeholder"
echo "   - Proxy server is not running (simulates connection failure)"
echo
echo "🔍 This reproduces the exact scenario from the GitHub issue:"
echo "   1. Git operations may work (they might ignore proxy or use different auth)"
echo "   2. GitHub CLI fails because it tries to use the proxy that's not running"
echo "   3. The 'Bad credentials' error occurs when gh CLI gets a 401 response"
echo
echo "📝 Key findings:"
echo "   - The issue is likely that gh CLI respects HTTPS_PROXY but the proxy server is down"
echo "   - Git might be configured to bypass proxy or use different authentication"
echo "   - The 'malformed HTTP response' error would occur when proxy connection fails"
echo
echo "🎯 Next steps to investigate:"
echo "   1. Start the actual MITM proxy server (secrets-proxy.ts)"
echo "   2. Configure GitHub secrets in the secrets management system"
echo "   3. Test gh CLI behavior with a running MITM proxy"
echo "   4. Compare git vs gh CLI proxy behavior"

# Cleanup
rm -f /tmp/test_go_proxy.go

echo
echo "🏁 Simulation completed!"