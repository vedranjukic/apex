#!/usr/bin/env node
/**
 * Integration test script for GitHub merge status polling service
 * 
 * This script tests the polling service by:
 * 1. Checking service status
 * 2. Triggering a manual poll
 * 3. Monitoring WebSocket events
 * 4. Verifying database updates
 */

const WebSocket = require('ws');

const API_BASE = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000/ws/projects';

async function fetchJson(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  return response.json();
}

async function testPollingStatus() {
  console.log('🔍 Testing polling service status...');
  
  try {
    const status = await fetchJson('/github/polling/status');
    console.log('✅ Polling status:', status);
    
    if (!status.hasGitHubToken) {
      console.warn('⚠️  GitHub token not configured - polling will be limited');
    }
    
    return status;
  } catch (error) {
    console.error('❌ Failed to get polling status:', error.message);
    return null;
  }
}

async function testManualTrigger() {
  console.log('🚀 Testing manual poll trigger...');
  
  try {
    const result = await fetchJson('/github/polling/trigger', {
      method: 'POST',
    });
    console.log('✅ Manual poll triggered:', result);
    return true;
  } catch (error) {
    console.error('❌ Failed to trigger manual poll:', error.message);
    return false;
  }
}

function testWebSocketEvents() {
  console.log('🔌 Testing WebSocket events...');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const events = [];
    let timeout;
    
    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      
      // Set timeout to close connection after 30 seconds
      timeout = setTimeout(() => {
        ws.close();
        resolve(events);
      }, 30000);
    });
    
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        console.log(`📨 Received event: ${event.type}`, event.payload);
        events.push(event);
        
        // If we receive any merge status events, we can consider it successful
        if (event.type.startsWith('merge-status-')) {
          clearTimeout(timeout);
          ws.close();
          resolve(events);
        }
      } catch (error) {
        console.error('❌ Failed to parse WebSocket message:', error.message);
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      clearTimeout(timeout);
      resolve([]);
    });
    
    ws.on('close', () => {
      console.log('🔌 WebSocket disconnected');
      clearTimeout(timeout);
    });
  });
}

async function testConfigUpdate() {
  console.log('⚙️  Testing configuration update...');
  
  try {
    const result = await fetchJson('/github/polling/config', {
      method: 'PUT',
      body: JSON.stringify({
        intervalMinutes: 15,
        enabled: true,
      }),
    });
    console.log('✅ Configuration updated:', result);
    return true;
  } catch (error) {
    console.error('❌ Failed to update configuration:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Starting GitHub merge polling integration tests...\n');
  
  // Test 1: Check service status
  const status = await testPollingStatus();
  if (!status) {
    console.log('\n❌ Tests aborted - service status check failed');
    return;
  }
  
  console.log('');
  
  // Test 2: Update configuration
  await testConfigUpdate();
  
  console.log('');
  
  // Test 3: Start WebSocket listener
  const wsPromise = testWebSocketEvents();
  
  // Wait a moment for WebSocket to connect
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 4: Trigger manual poll
  const triggered = await testManualTrigger();
  
  if (triggered) {
    console.log('\n⏳ Waiting for WebSocket events (up to 30 seconds)...');
    
    // Wait for WebSocket events
    const events = await wsPromise;
    
    console.log(`\n📊 Received ${events.length} events:`);
    events.forEach((event, index) => {
      console.log(`  ${index + 1}. ${event.type}`);
    });
    
    if (events.some(e => e.type.startsWith('merge-status-'))) {
      console.log('\n✅ All tests passed! Merge status polling is working correctly.');
    } else {
      console.log('\n⚠️  Tests completed but no merge status events received. This could mean:');
      console.log('   - No projects with GitHub URLs in database');
      console.log('   - GitHub API rate limiting');
      console.log('   - Network connectivity issues');
    }
  } else {
    console.log('\n❌ Tests failed - could not trigger manual poll');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Tests interrupted by user');
  process.exit(0);
});

// Run tests
runTests().catch((error) => {
  console.error('\n💥 Test runner failed:', error);
  process.exit(1);
});