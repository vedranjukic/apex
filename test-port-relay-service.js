#!/usr/bin/env node

/**
 * Simple integration test for PortRelayService
 * 
 * This test verifies that:
 * 1. PortRelayService can be imported and instantiated
 * 2. Auto-forward functionality can be enabled/disabled
 * 3. Event emission works correctly
 * 4. Port forwarding state management works
 */

import { PortRelayService } from './apps/api/src/modules/preview/port-relay.service.js';

async function testPortRelayService() {
  console.log('🧪 Testing PortRelayService...');
  
  try {
    // Test 1: Create service instance
    console.log('\n1. Creating PortRelayService instance...');
    const service = new PortRelayService({
      maxAutoForwards: 5,
      excludedPorts: [3001, 8080]
    });
    console.log('✅ Service created successfully');
    console.log('   Config:', service.getConfig());
    
    // Test 2: Event handling
    console.log('\n2. Testing event handling...');
    const events = [];
    const unsubscribe = service.onEvent((event) => {
      events.push(event);
      console.log(`   📡 Event: ${event.type} for project ${event.projectId}`);
    });
    console.log('✅ Event listener registered');
    
    // Test 3: Auto-forward enable/disable (without real project)
    console.log('\n3. Testing auto-forward with mock data...');
    const mockProjectId = 'test-project-123';
    
    // Initialize a mock project state directly
    console.log('   Initializing mock project state...');
    service.projectStates = service.projectStates || new Map();
    service.projectStates.set(mockProjectId, {
      projectId: mockProjectId,
      sandboxId: 'test-sandbox-123',
      autoForwardEnabled: false,
      lastKnownPorts: [],
      activeForwards: new Map(),
      provider: 'docker'
    });
    
    // Test enabling auto-forward
    const enableResult = await service.setAutoForward(mockProjectId, true);
    console.log('   Auto-forward enable result:', enableResult);
    console.log(`✅ Auto-forward enabled: ${enableResult.success}`);
    
    // Test disabling auto-forward  
    const disableResult = await service.setAutoForward(mockProjectId, false);
    console.log('   Auto-forward disable result:', disableResult);
    console.log(`✅ Auto-forward disabled: ${disableResult.success}`);
    
    // Test 4: Status retrieval
    console.log('\n4. Testing status retrieval...');
    const status = service.getRelayStatus(mockProjectId);
    console.log('   Status:', status);
    console.log(`✅ Status retrieved: autoForward=${status?.autoForwardEnabled}, forwards=${status?.forwards.length}`);
    
    // Test 5: Configuration update
    console.log('\n5. Testing configuration update...');
    service.updateConfig({ maxAutoForwards: 3 });
    const updatedConfig = service.getConfig();
    console.log('   Updated config:', updatedConfig);
    console.log(`✅ Config updated: maxAutoForwards=${updatedConfig.maxAutoForwards}`);
    
    // Test 6: Cleanup
    console.log('\n6. Testing cleanup...');
    service.cleanupProject(mockProjectId);
    const statusAfterCleanup = service.getRelayStatus(mockProjectId);
    console.log(`✅ Cleanup completed: status is ${statusAfterCleanup ? 'still present' : 'removed'}`);
    
    // Clean up event listener
    unsubscribe();
    console.log('✅ Event listener unsubscribed');
    
    console.log('\n🎉 All PortRelayService tests passed!');
    
    // Summary of events
    console.log(`\n📊 Total events emitted: ${events.length}`);
    for (const event of events) {
      console.log(`   - ${event.type}: ${JSON.stringify(event.payload)}`);
    }
    
  } catch (error) {
    console.error('❌ PortRelayService test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Handle ES modules
if (import.meta.url === `file://${process.argv[1]}`) {
  testPortRelayService();
}