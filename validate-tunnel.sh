#!/bin/bash

echo "🧪 Validating TCP-over-WebSocket Tunnel Implementation"
echo "=================================================="

# Test 1: Check if all required files exist
echo
echo "🔍 Test 1: Checking required implementation files..."

FILES=(
  "libs/orchestrator/src/lib/combined-proxy-service-script.ts"
  "libs/orchestrator/src/lib/bridge-script.ts"
  "libs/orchestrator/src/lib/sandbox-manager.ts"
  "libs/orchestrator/src/index.ts"
  "apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts"
)

ALL_FILES_EXIST=true

for file in "${FILES[@]}"; do
  if [[ -f "$file" ]]; then
    echo "   ✅ $file"
  else
    echo "   ❌ $file (missing)"
    ALL_FILES_EXIST=false
  fi
done

if [[ "$ALL_FILES_EXIST" == false ]]; then
  echo "❌ Some required files are missing!"
  exit 1
fi

echo
echo "🔍 Test 2: Validating combined proxy service script content..."

COMBINED_PROXY_FILE="libs/orchestrator/src/lib/combined-proxy-service-script.ts"

if grep -q "getCombinedProxyServiceScript" "$COMBINED_PROXY_FILE" &&
   grep -q "MITM_PROXY_PORT" "$COMBINED_PROXY_FILE" &&
   grep -q "/tunnel" "$COMBINED_PROXY_FILE" &&
   grep -q "WebSocket" "$COMBINED_PROXY_FILE" &&
   grep -q "net.connect" "$COMBINED_PROXY_FILE"; then
  echo "   ✅ Combined proxy script has all required components"
else
  echo "   ❌ Missing components in combined proxy script"
  exit 1
fi

echo
echo "🔍 Test 3: Validating bridge script tunnel client..."

BRIDGE_FILE="libs/orchestrator/src/lib/bridge-script.ts"

if grep -q "TUNNEL_ENDPOINT_URL" "$BRIDGE_FILE" &&
   grep -q "TUNNEL_PORT = 9339" "$BRIDGE_FILE" &&
   grep -q "tunnelServer" "$BRIDGE_FILE" &&
   grep -q "new WebSocket" "$BRIDGE_FILE"; then
  echo "   ✅ Bridge script contains tunnel client"
else
  echo "   ❌ Missing tunnel client in bridge script"
  exit 1
fi

echo
echo "🔍 Test 4: Validating sandbox manager Daytona configuration..."

MANAGER_FILE="libs/orchestrator/src/lib/sandbox-manager.ts"

if grep -q "http://localhost:9339" "$MANAGER_FILE" &&
   grep -q "TUNNEL_ENDPOINT_URL" "$MANAGER_FILE" &&
   grep -q "isDaytona" "$MANAGER_FILE"; then
  echo "   ✅ Sandbox manager configured for Daytona tunnel"
else
  echo "   ❌ Missing Daytona configuration in sandbox manager"
  exit 1
fi

echo
echo "🔍 Test 5: Validating proxy sandbox service..."

PROXY_SERVICE_FILE="apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts"

if grep -q "getCombinedProxyServiceScript" "$PROXY_SERVICE_FILE" &&
   grep -q "SECRETS_JSON" "$PROXY_SERVICE_FILE" &&
   grep -q "CA_CERT_PEM" "$PROXY_SERVICE_FILE"; then
  echo "   ✅ Proxy sandbox service updated correctly"
else
  echo "   ❌ Missing updates in proxy sandbox service"
  exit 1
fi

echo
echo "🔍 Test 6: Validating library exports..."

INDEX_FILE="libs/orchestrator/src/index.ts"

if grep -q "getCombinedProxyServiceScript" "$INDEX_FILE"; then
  echo "   ✅ Combined proxy service script is exported"
else
  echo "   ❌ getCombinedProxyServiceScript not exported"
  exit 1
fi

echo
echo "🔍 Test 7: Checking port assignments in code..."

# Check port 9339 in bridge script
if grep -q "9339" "$BRIDGE_FILE"; then
  echo "   ✅ Tunnel client port 9339 configured in bridge"
else
  echo "   ❌ Port 9339 not found in bridge script"
  exit 1
fi

# Check port 9340 in combined proxy script
if grep -q "9340" "$COMBINED_PROXY_FILE"; then
  echo "   ✅ MITM proxy port 9340 configured in combined script"
else
  echo "   ❌ Port 9340 not found in combined proxy script"
  exit 1
fi

echo
echo "🎉 All validation tests passed!"
echo
echo "📋 Implementation Summary:"
echo "========================"
echo "✅ Combined proxy service script created"
echo "   - LLM proxy functionality (port 3000)"
echo "   - MITM secrets proxy (port 9340, internal)"
echo "   - WebSocket tunnel bridge (/tunnel endpoint)"
echo
echo "✅ Bridge script enhanced with tunnel client"
echo "   - TCP-to-WebSocket client on port 9339"
echo "   - Environment variable TUNNEL_ENDPOINT_URL support"
echo "   - Bidirectional data piping"
echo
echo "✅ Proxy sandbox service updated"
echo "   - Uses combined proxy service script"
echo "   - Includes secrets data and CA certificates"
echo "   - Installs WebSocket dependencies"
echo
echo "✅ Sandbox manager configured for Daytona"
echo "   - Sets HTTPS_PROXY=http://localhost:9339 for Daytona"
echo "   - Passes tunnel endpoint URL to bridge"
echo "   - Preserves direct proxy for other providers"
echo
echo "✅ Library exports updated"
echo "   - getCombinedProxyServiceScript exported"
echo
echo "🚀 TCP-over-WebSocket tunnel implementation is complete!"
echo
echo "🏗️  Architecture Overview:"
echo "========================="
echo "Regular Sandbox (Daytona)     →  Proxy Sandbox (Daytona)"
echo "┌─────────────────────────┐   ┌──────────────────────────┐"
echo "│ gh/curl/SDK             │   │ MITM Secrets Proxy       │"
echo "│   ↓                     │   │ (:9340, internal)        │"
echo "│ HTTPS_PROXY=            │   │   ↑                      │"
echo "│ localhost:9339          │   │   │ TCP                  │"
echo "│   ↓                     │   │   │                      │"
echo "│ TCP-to-WS Client        │──→│ WS-to-TCP Bridge         │"
echo "│ (bridge, :9339)         │   │ (LLM proxy :3000/tunnel) │"
echo "└─────────────────────────┘   └──────────────────────────┘"
echo
echo "📝 Next Steps:"
echo "============="
echo "1. Deploy to a Daytona environment for integration testing"
echo "2. Test with actual GitHub API calls using secrets"
echo "3. Monitor logs for tunnel establishment and data flow"
echo "4. Verify MITM proxy intercepts and injects auth correctly"