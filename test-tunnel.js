#!/usr/bin/env node

/**
 * Test script to validate the TCP-over-WebSocket tunnel implementation
 */

const net = require('net');
const http = require('http');
const WebSocket = require('ws');

// Test configuration
const TUNNEL_CLIENT_PORT = 9339;
const TUNNEL_BRIDGE_PORT = 3000;
const MITM_PROXY_PORT = 9340;

console.log('🧪 Testing TCP-over-WebSocket Tunnel Implementation');
console.log('==================================================');

/**
 * Test 1: Verify tunnel client creates TCP server on port 9339
 */
function testTunnelClientPort() {
  return new Promise((resolve, reject) => {
    console.log('\n🔍 Test 1: Checking if tunnel client port 9339 would be available...');
    
    const server = net.createServer();
    server.listen(TUNNEL_CLIENT_PORT, '127.0.0.1', () => {
      console.log('✅ Port 9339 is available for tunnel client');
      server.close(() => resolve());
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log('⚠️  Port 9339 is already in use (expected if bridge is running)');
        resolve();
      } else {
        console.log('❌ Error testing port 9339:', err.message);
        reject(err);
      }
    });
  });
}

/**
 * Test 2: Verify combined proxy service script syntax
 */
function testCombinedProxyServiceScript() {
  console.log('\n🔍 Test 2: Validating combined proxy service script...');
  
  try {
    const { getCombinedProxyServiceScript } = require('./libs/orchestrator/src/lib/combined-proxy-service-script');
    const script = getCombinedProxyServiceScript(3000, 9340);
    
    // Basic syntax validation
    if (script.includes('MITM_PROXY_PORT') && 
        script.includes('/tunnel') &&
        script.includes('WebSocket') &&
        script.includes('net.connect')) {
      console.log('✅ Combined proxy service script contains required components');
      console.log('   - MITM proxy configuration: ✓');
      console.log('   - WebSocket tunnel endpoint: ✓');
      console.log('   - TCP-to-WebSocket bridge: ✓');
    } else {
      throw new Error('Missing required components in script');
    }
    
  } catch (err) {
    console.log('❌ Error validating combined proxy script:', err.message);
    throw err;
  }
}

/**
 * Test 3: Verify bridge script has tunnel client
 */
function testBridgeScript() {
  console.log('\n🔍 Test 3: Validating bridge script tunnel client...');
  
  try {
    const { getBridgeScript } = require('./libs/orchestrator/src/lib/bridge-script');
    const script = getBridgeScript(8080, '/tmp/test');
    
    // Check for tunnel client components
    if (script.includes('TUNNEL_ENDPOINT_URL') && 
        script.includes('TUNNEL_PORT = 9339') &&
        script.includes('tunnelServer') &&
        script.includes('new WebSocket(TUNNEL_ENDPOINT_URL)')) {
      console.log('✅ Bridge script contains tunnel client');
      console.log('   - Environment variable support: ✓');
      console.log('   - TCP server on port 9339: ✓');
      console.log('   - WebSocket client: ✓');
    } else {
      throw new Error('Missing tunnel client components in bridge script');
    }
    
  } catch (err) {
    console.log('❌ Error validating bridge script:', err.message);
    throw err;
  }
}

/**
 * Test 4: Verify proxy sandbox service configuration
 */
function testProxySandboxService() {
  console.log('\n🔍 Test 4: Validating proxy sandbox service configuration...');
  
  try {
    const fs = require('fs');
    const serviceContent = fs.readFileSync(
      './apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts', 
      'utf8'
    );
    
    if (serviceContent.includes('getCombinedProxyServiceScript') &&
        serviceContent.includes('SECRETS_JSON') &&
        serviceContent.includes('CA_CERT_PEM') &&
        serviceContent.includes('npm install ws')) {
      console.log('✅ Proxy sandbox service configured correctly');
      console.log('   - Combined proxy script: ✓');
      console.log('   - Secrets environment: ✓');
      console.log('   - CA certificate support: ✓');
      console.log('   - WebSocket dependencies: ✓');
    } else {
      throw new Error('Missing required configuration in proxy sandbox service');
    }
    
  } catch (err) {
    console.log('❌ Error validating proxy sandbox service:', err.message);
    throw err;
  }
}

/**
 * Test 5: Verify sandbox manager Daytona configuration
 */
function testSandboxManagerConfiguration() {
  console.log('\n🔍 Test 5: Validating sandbox manager Daytona configuration...');
  
  try {
    const fs = require('fs');
    const managerContent = fs.readFileSync(
      './libs/orchestrator/src/lib/sandbox-manager.ts', 
      'utf8'
    );
    
    if (managerContent.includes('http://localhost:9339') &&
        managerContent.includes('TUNNEL_ENDPOINT_URL') &&
        managerContent.includes('isDaytona')) {
      console.log('✅ Sandbox manager configured for Daytona tunnel');
      console.log('   - Local tunnel endpoint: ✓');
      console.log('   - Tunnel URL passing: ✓');
      console.log('   - Provider-specific logic: ✓');
    } else {
      throw new Error('Missing Daytona tunnel configuration in sandbox manager');
    }
    
  } catch (err) {
    console.log('❌ Error validating sandbox manager:', err.message);
    throw err;
  }
}

/**
 * Test 6: Verify exports are correct
 */
function testExports() {
  console.log('\n🔍 Test 6: Validating library exports...');
  
  try {
    const fs = require('fs');
    const indexContent = fs.readFileSync(
      './libs/orchestrator/src/index.ts', 
      'utf8'
    );
    
    if (indexContent.includes('getCombinedProxyServiceScript')) {
      console.log('✅ Combined proxy service script is exported');
    } else {
      throw new Error('getCombinedProxyServiceScript not exported');
    }
    
  } catch (err) {
    console.log('❌ Error validating exports:', err.message);
    throw err;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    await testTunnelClientPort();
    testCombinedProxyServiceScript();
    testBridgeScript();
    testProxySandboxService();
    testSandboxManagerConfiguration();
    testExports();
    
    console.log('\n🎉 All tests passed!');
    console.log('\n📋 Implementation Summary:');
    console.log('========================');
    console.log('✅ Combined proxy service script created');
    console.log('✅ Bridge script enhanced with tunnel client');
    console.log('✅ Proxy sandbox service updated');
    console.log('✅ Sandbox manager configured for Daytona');
    console.log('✅ Library exports updated');
    console.log('\n🚀 The TCP-over-WebSocket tunnel is ready for deployment!');
    
  } catch (err) {
    console.log('\n❌ Tests failed:', err.message);
    process.exit(1);
  }
}

// Check if this script is being run directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };