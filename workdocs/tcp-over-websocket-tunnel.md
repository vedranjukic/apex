# TCP-over-WebSocket Tunnel for MITM Secrets Proxy on Daytona

This document describes the TCP-over-WebSocket tunnel implementation that enables MITM secrets proxy functionality on Daytona infrastructure, which only supports HTTP/HTTPS with WebSocket upgrades (no raw TCP port exposure).

## Problem Solved

**Challenge**: Daytona preview URLs only support HTTP/HTTPS traffic with WebSocket upgrades. The MITM secrets proxy requires raw TCP connections for HTTP `CONNECT` tunneling (the standard HTTPS proxy mechanism).

**Solution**: A WebSocket-based TCP tunnel that enables transparent proxy functionality through Daytona's WebSocket-compatible infrastructure.

## Architecture

```
Regular Sandbox (Daytona)                    Proxy Sandbox (Daytona)
┌─────────────────────────────┐              ┌──────────────────────────────┐
│ Applications                │              │ MITM Secrets Proxy (:9340)  │
│ (gh, curl, SDKs)            │              │   ▲                          │
│   ↓                         │              │   │ TCP                      │
│ HTTPS_PROXY=localhost:9339  │  WebSocket   │   │                          │
│   ↓                         │  /tunnel     │   │                          │
│ TCP-to-WS Tunnel Client     │ ──────────── │ WS-to-TCP Bridge            │
│ (bridge script, :9339)      │              │ (LLM proxy :3000/tunnel)    │
│                             │              │                              │
│                             │              │ LLM Proxy (:3000)          │
└─────────────────────────────┘              └──────────────────────────────┘
```

## Port Assignments

| Port | Role | Location |
|------|------|----------|
| `9339` | Tunnel client (local proxy endpoint) | Regular sandbox — bridge script |
| `9340` | MITM secrets proxy | Proxy sandbox — internal only |
| `3000` | LLM proxy + WebSocket tunnel bridge | Proxy sandbox — shared HTTP server |

## Data Flow

### Example: GitHub API Call via Tunnel

1. **Application** (`gh`) reads `HTTPS_PROXY=http://localhost:9339`
2. **TCP Connection** - `gh` connects to localhost:9339
3. **CONNECT Request** - `gh` sends `CONNECT api.github.com:443 HTTP/1.1`
4. **Tunnel Client** (bridge script) opens WebSocket to `wss://proxy-sandbox/tunnel`
5. **Binary Tunneling** - TCP bytes ↔ WebSocket frames bidirectionally
6. **Bridge Service** (proxy sandbox) connects WebSocket to MITM proxy (port 9340)
7. **MITM Processing** - handles CONNECT, terminates TLS, injects GitHub token
8. **Upstream Forward** - forwards authenticated request to api.github.com
9. **Response Path** - data flows back through same tunnel

## Implementation Components

### 1. Rust Proxy Binary (`apps/proxy/`)

Runs inside the Daytona proxy sandbox as a single statically-linked binary (`apex-proxy`), cross-compiled for `x86_64-unknown-linux-musl`. Uploaded to the sandbox at creation time by `proxy-sandbox.service.ts`. Combines four services:

#### LLM Proxy (port 3000)
- API key proxying for Anthropic/OpenAI with auth token verification
- Routes: `/llm-proxy/anthropic/*`, `/llm-proxy/openai/*`, `/health`

#### MITM Secrets Proxy (port 9340, internal only)
- TLS termination with ECDSA P256 domain certificates (signed by RSA CA, cached in `DashMap`)
- Secrets injection based on domain lookup (loaded from `SECRETS_JSON` env var)
- Transparent tunneling for non-secret domains (`tokio::io::copy_bidirectional`)
- Auth types: bearer, x-api-key, basic, header:custom
- Hot-reload via `POST /internal/reload-secrets`

#### WebSocket-to-TCP Tunnel Bridge (`/tunnel` endpoint)
- Accepts WebSocket upgrade connections at `/tunnel`
- Creates TCP connection to MITM proxy (localhost:9340)
- Binary frame handling via `tokio-tungstenite`

#### Port Relay Bridge (`/port-relay/:port` endpoint)
- WebSocket-to-TCP bridge for arbitrary localhost ports

### 2. Bridge Script Enhancement (`libs/orchestrator/src/lib/bridge-script.ts`)

**ENHANCED** - Added TCP-to-WebSocket tunnel client:

- **TCP Server** on port 9339 accepting HTTPS proxy connections
- **WebSocket Client** connecting to proxy sandbox `/tunnel` endpoint  
- **Environment Variable** `TUNNEL_ENDPOINT_URL` for tunnel configuration
- **Bidirectional Data Flow** with backpressure handling
- **Connection Management** with timeouts and proper cleanup

### 3. Sandbox Manager Updates (`libs/orchestrator/src/lib/sandbox-manager.ts`)

**UPDATED** - Provider-specific proxy configuration:

#### Daytona Provider
- Sets `HTTPS_PROXY=http://localhost:9339` (tunnel client endpoint)
- Sets `HTTP_PROXY=http://localhost:9339` for HTTP traffic  
- Passes `TUNNEL_ENDPOINT_URL=${proxyBase}/tunnel` to bridge environment
- Installs CA certificate for TLS verification (same as other providers)

#### Other Providers (Docker, Apple Container, Local)
- Uses direct proxy URLs unchanged (backward compatible)
- `HTTPS_PROXY=http://<host-lan-ip>:9350` points to local MITM proxy

### 4. Proxy Sandbox Service (`apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts`)

**UPDATED** - Uploads the cross-compiled Rust binary to the proxy sandbox:

- **Binary Upload** - Reads `apps/proxy/target/x86_64-unknown-linux-musl/release/apex-proxy` and uploads via `sandbox.fs.uploadFile()`
- **Environment Variables** - Includes secrets JSON, CA cert/key, GitHub token, port config
- **Health Check** - `curl localhost:3000/health` verifies all services running

## Technical Features

### Binary WebSocket Frames
- Uses binary WebSocket frames (not text) to avoid encoding issues with TLS handshake bytes
- Preserves raw TCP data integrity for HTTPS proxy connections

### Backpressure Management  
- **WebSocket Buffer Monitoring** - Pauses client when buffer > 64KB, resumes when < 16KB
- **TCP Socket Drain Events** - Handles backpressure using Node.js drain mechanism
- **Memory Protection** - Prevents exhaustion on large file transfers

### Connection Isolation
- **One WebSocket per TCP connection** - Preserves connection boundaries
- **Independent Lifecycle** - Each proxy connection gets dedicated WebSocket
- **Proper Cleanup** - Connections closed cleanly on either side

### Error Handling
- **Connection Timeouts** - 5 minutes for client sockets, 30 seconds for TCP connections  
- **WebSocket Errors** - Proper error propagation and connection termination
- **Health Monitoring** - Combined health endpoint shows status of all services

### Performance
- **Low Latency** - Direct WebSocket-to-TCP bridging with minimal overhead
- **Concurrent Connections** - Multiple simultaneous tunnels supported
- **Memory Efficient** - Bounded buffers prevent memory leaks

## Environment Variables

### Regular Sandbox (Daytona)
```bash
HTTPS_PROXY=http://localhost:9339
HTTP_PROXY=http://localhost:9339  
TUNNEL_ENDPOINT_URL=wss://proxy-sandbox-uuid.preview.daytona.com/tunnel
NO_PROXY=localhost,127.0.0.1,0.0.0.0
NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/apex-proxy-ca.crt
# ... other CA cert variables
STRIPE_KEY=sk-proxy-placeholder  # Secret placeholders
```

### Proxy Sandbox (Daytona)  
```bash
REAL_ANTHROPIC_API_KEY=sk-ant-...          # Real LLM keys
REAL_OPENAI_API_KEY=sk-...
PROXY_AUTH_TOKEN=sk-proxy-abc123...        # Auth token
SECRETS_JSON=[{"name":"STRIPE_KEY",...}]    # Secrets data  
GITHUB_TOKEN=ghp_...                       # GitHub token fallback
CA_CERT_PEM=-----BEGIN CERTIFICATE-----   # CA certificate
CA_KEY_PEM=-----BEGIN PRIVATE KEY-----     # CA private key
PROXY_PORT=3000                            # LLM proxy port
MITM_PROXY_PORT=9340                       # MITM proxy port
```

## Validation & Testing

### Automated Tests
- **File Structure** - Verifies all implementation files exist
- **Component Features** - Validates required functionality in each component
- **Port Assignments** - Checks correct port usage (9339, 9340, 3000)
- **Integration** - Ensures all components work together

### Manual Testing
1. **Deploy** proxy sandbox with combined service
2. **Create** regular sandbox with tunnel client
3. **Configure** secrets in dashboard UI
4. **Test** GitHub API call: `gh api user` (should show authenticated user)
5. **Verify** logs show tunnel connections and auth injection

## Troubleshooting

### Common Issues

**Tunnel Client Not Starting**
- Check `TUNNEL_ENDPOINT_URL` environment variable in bridge
- Verify proxy sandbox is deployed and healthy at `/health`

**WebSocket Connection Failed**  
- Test proxy sandbox WebSocket endpoint: `wss://proxy-sandbox/tunnel`
- Check proxy sandbox logs for connection errors
- Verify preview URL accessibility

**MITM Not Intercepting**
- Ensure secrets configured for target domain in dashboard
- Check CA certificate installed in regular sandbox  
- Verify `HTTPS_PROXY` points to tunnel client (localhost:9339)

**Performance Issues**
- Monitor WebSocket `bufferedAmount` for backpressure
- Check for connection timeout errors in logs
- Verify concurrent connection limits not exceeded

### Debug Logging

**Bridge Script (Regular Sandbox)**
```
[tunnel-bridge] New tunnel connection
[tunnel-bridge] Connected to MITM proxy  
[tunnel-bridge] WebSocket buffer high, pausing client
```

**Combined Proxy (Proxy Sandbox)**
```
[combined-proxy] Starting combined proxy service...
[mitm-proxy] MITM CONNECT to api.github.com:443
[tunnel-bridge] TCP connection closed
```

### Health Checks

**Proxy Sandbox Health Endpoint**
```bash
curl https://proxy-sandbox/health
# Returns: {"status":"ok","services":{"llm_proxy":"running","mitm_proxy":"running","tunnel_bridge":"running"}}
```

**Tunnel Client Status**
```bash  
# Inside regular sandbox
netstat -ln | grep 9339
# Should show: tcp4  0  0  127.0.0.1.9339  *.*  LISTEN
```

## Security Considerations

- **Secrets Isolation** - Secret values never enter regular sandboxes
- **CA Certificate Validation** - Proper TLS certificate chain verification
- **Domain-Specific MITM** - Only intercepts configured secret domains
- **Connection Isolation** - Each tunnel connection is independent
- **Auth Token Validation** - Proxy verifies tokens before processing

## Backward Compatibility

- **Other Providers Unchanged** - Docker, Apple Container, Local use direct proxy
- **Existing Secrets** - All auth types work with tunnel (bearer, x-api-key, etc.)
- **Agent Integration** - `list_secrets` MCP tool works unchanged
- **Environment Variables** - Same placeholder mechanism for SDK initialization

## Key Files

| File | Role |
|------|------|
| `apps/proxy/` | Rust crate — `apex-proxy` binary (MITM + LLM proxy + tunnel + port relay) |
| `apps/api/src/modules/secrets-proxy/secrets-proxy.ts` | Spawns Rust binary on host; hot-reloads secrets |
| `apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts` | Uploads Linux binary to Daytona proxy sandbox |
| `libs/orchestrator/src/lib/bridge-script.ts` | TCP-to-WebSocket tunnel client on port 9339 |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Daytona proxy configuration (env vars, CA cert) |
| `images/proxy/Dockerfile` | Multi-stage Docker image (Rust build + minimal runtime) |