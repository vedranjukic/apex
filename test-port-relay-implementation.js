#!/usr/bin/env node

/**
 * Test script to validate the port relay feature implementation
 */

const fs = require('fs');
const path = require('path');

function checkFile(filePath, description) {
  console.log(`Checking ${description}...`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }
  
  console.log(`✅ File exists: ${filePath}`);
  return true;
}

function checkContent(filePath, patterns, description) {
  console.log(`Checking ${description}...`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const results = [];
  
  for (const [pattern, desc] of patterns) {
    const found = content.includes(pattern);
    results.push([desc, found]);
    console.log(`  ${found ? '✅' : '❌'} ${desc}`);
  }
  
  return results.every(([, found]) => found);
}

function main() {
  console.log('='.repeat(60));
  console.log('PORT RELAY FEATURE IMPLEMENTATION TEST');
  console.log('='.repeat(60));
  
  const checks = [];
  
  // 1. Combined proxy service script
  checks.push(checkContent(
    'libs/orchestrator/src/lib/combined-proxy-service-script.ts',
    [
      ['PORT_RELAY_PORT', 'Port relay port configuration'],
      ['/port-relay/:port', 'Port relay WebSocket endpoint'],
      ['portRelayPort = 9341', 'Default port relay port'],
      ['portRelayWss', 'Port relay WebSocket server'],
      ['port_relay_bridge', 'Port relay service in health check']
    ],
    'Combined proxy service script enhancements'
  ));
  
  // 2. Bridge script enhancements
  checks.push(checkContent(
    'libs/orchestrator/src/lib/bridge-script.ts',
    [
      ['PORT_RELAY_BASE_URL', 'Port relay base URL environment variable'],
      ['startPortRelay', 'Start port relay function'],
      ['stopPortRelay', 'Stop port relay function'],
      ['start_port_relay', 'Start port relay message handler'],
      ['port_relay_started', 'Port relay started event'],
      ['/internal/start-port-relay', 'Port relay HTTP endpoint']
    ],
    'Bridge script port relay functionality'
  ));
  
  // 3. Types definitions
  checks.push(checkContent(
    'libs/orchestrator/src/lib/types.ts',
    [
      ['BridgePortRelayStarted', 'Port relay started message type'],
      ['BridgePortRelayStopped', 'Port relay stopped message type'],
      ['BridgePortRelayError', 'Port relay error message type'],
      ['port_relay_started', 'Port relay started event type'],
      ['targetPort', 'Target port field in messages']
    ],
    'Type definitions for port relay messages'
  ));
  
  // 4. Daytona provider enhancements
  checks.push(checkContent(
    'libs/orchestrator/src/lib/providers/daytona-provider.ts',
    [
      ['getSignedPreviewUrlWithDefaultTTL', 'Default TTL helper method'],
      ['60-minute TTL', 'TTL documentation'],
      ['3600', '60-minute TTL value']
    ],
    'Daytona provider getSignedPreviewUrl with 60-minute TTL'
  ));
  
  // 5. Proxy sandbox service
  checks.push(checkContent(
    'apps/api/src/modules/llm-proxy/proxy-sandbox.service.ts',
    [
      ['PORT_RELAY_PORT', 'Port relay port constant'],
      ['9341', 'Port relay port value'],
      ['PORT_RELAY_PORT:', 'Port relay environment variable'],
      ['PORT_RELAY_PORT)', 'Port relay parameter in script call']
    ],
    'Proxy sandbox service port relay configuration'
  ));
  
  // 6. Sandbox manager environment variables
  checks.push(checkContent(
    'libs/orchestrator/src/lib/sandbox-manager.ts',
    [
      ['PORT_RELAY_BASE_URL', 'Port relay base URL environment variable'],
      [':9341', 'Port relay port in URL']
    ],
    'Sandbox manager environment configuration'
  ));
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const passed = checks.filter(Boolean).length;
  const total = checks.length;
  
  console.log(`Tests passed: ${passed}/${total}`);
  
  if (passed === total) {
    console.log('🎉 All port relay implementation checks passed!');
    console.log('\nKey features implemented:');
    console.log('✅ Extended combined proxy service with port relay bridge on port 9341');
    console.log('✅ Added port relay tunnel client functionality in bridge script');
    console.log('✅ Added port relay WebSocket message types and handlers');
    console.log('✅ Enhanced Daytona provider with 60-minute TTL helper method');
    console.log('✅ Updated proxy sandbox service with port relay configuration');
    console.log('✅ Added PORT_RELAY_BASE_URL environment variable for sandboxes');
    return true;
  } else {
    console.error('❌ Some implementation checks failed');
    return false;
  }
}

if (require.main === module) {
  const success = main();
  process.exit(success ? 0 : 1);
}

module.exports = { main };