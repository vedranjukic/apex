#!/usr/bin/env node

/**
 * Test script for the enhanced port-forwarder functionality
 * Tests automatic forwarding, conflict resolution, and health monitoring
 */

const { createServer } = require('net');

// Import the enhanced port-forwarder
const {
  forwardPort,
  forwardPortWithRange,
  autoForwardPorts,
  unforwardPort,
  unforwardAll,
  getPortStatus,
  listForwards,
  setConfig,
  getConfig,
  cleanup
} = require('./apps/api/src/modules/preview/port-forwarder.ts');

class TestRunner {
  constructor() {
    this.testServers = [];
    this.testResults = [];
  }

  async createTestServer(port) {
    return new Promise((resolve, reject) => {
      const server = createServer(() => {});
      server.listen(port, '127.0.0.1', () => {
        this.testServers.push(server);
        console.log(`✓ Test server created on port ${port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }

  async destroyTestServers() {
    console.log('\n🧹 Cleaning up test servers...');
    for (const server of this.testServers) {
      server.close();
    }
    this.testServers = [];
  }

  logTest(name, success, message = '') {
    const status = success ? '✅' : '❌';
    console.log(`${status} ${name}${message ? ': ' + message : ''}`);
    this.testResults.push({ name, success, message });
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async runTests() {
    console.log('🚀 Starting Enhanced Port Forwarder Tests\n');

    try {
      await this.testConfiguration();
      await this.testBasicForwarding();
      await this.testRangeForwarding();
      await this.testConflictResolution();
      await this.testAutoForwarding();
      await this.testStatusTracking();
      await this.testBatchOperations();
      await this.testCleanup();
    } catch (error) {
      console.error('❌ Test suite failed with error:', error);
    } finally {
      await this.destroyTestServers();
      cleanup();
      this.printSummary();
    }
  }

  async testConfiguration() {
    console.log('📋 Testing Configuration Management...');

    // Test default config
    const defaultConfig = getConfig();
    this.logTest(
      'Default configuration loaded',
      defaultConfig.portRange.start === 8000 && defaultConfig.portRange.end === 9000,
      `Range: ${defaultConfig.portRange.start}-${defaultConfig.portRange.end}`
    );

    // Test config update
    setConfig({
      portRange: { start: 8500, end: 8600 },
      excludedPorts: [8555]
    });

    const updatedConfig = getConfig();
    this.logTest(
      'Configuration update',
      updatedConfig.portRange.start === 8500 && updatedConfig.excludedPorts.includes(8555),
      'Custom range and excluded ports set'
    );

    // Reset to reasonable defaults for other tests
    setConfig({
      portRange: { start: 8000, end: 8100 },
      excludedPorts: [8080],
      enableHealthChecks: false // Disable for testing
    });
  }

  async testBasicForwarding() {
    console.log('\n🔌 Testing Basic Port Forwarding...');

    // Create a test server
    await this.createTestServer(3001);

    try {
      // Test basic forwarding
      const localPort1 = await forwardPort('test-sandbox-1', '127.0.0.1', 3001);
      this.logTest(
        'Basic port forward',
        typeof localPort1 === 'number' && localPort1 > 0,
        `3001 → ${localPort1}`
      );

      // Test duplicate forwarding returns same port
      const localPort2 = await forwardPort('test-sandbox-1', '127.0.0.1', 3001);
      this.logTest(
        'Duplicate forward returns same port',
        localPort1 === localPort2,
        `Both calls returned ${localPort1}`
      );

      // Test listing forwards
      const forwards = listForwards('test-sandbox-1');
      this.logTest(
        'List forwards',
        forwards.length === 1 && forwards[0].remotePort === 3001,
        `Found ${forwards.length} forward(s)`
      );

    } catch (error) {
      this.logTest('Basic forwarding', false, error.message);
    }
  }

  async testRangeForwarding() {
    console.log('\n🎯 Testing Range-based Port Forwarding...');

    // Create test servers
    await this.createTestServer(3002);
    await this.createTestServer(3003);

    try {
      // Test preferred port forwarding
      const localPort1 = await forwardPortWithRange('test-sandbox-2', '127.0.0.1', 3002, 8050);
      this.logTest(
        'Preferred port allocation',
        localPort1 === 8050,
        `Got preferred port ${localPort1}`
      );

      // Test range fallback when preferred port is taken
      const localPort2 = await forwardPortWithRange('test-sandbox-2', '127.0.0.1', 3003, 8050);
      this.logTest(
        'Range fallback',
        localPort2 !== 8050 && localPort2 >= 8000 && localPort2 <= 8100,
        `Fallback to ${localPort2}`
      );

      // Test excluded port is skipped
      setConfig({ excludedPorts: [8001, 8002, 8003] });
      const localPort3 = await forwardPortWithRange('test-sandbox-3', '127.0.0.1', 3002);
      this.logTest(
        'Excluded ports skipped',
        ![8001, 8002, 8003].includes(localPort3),
        `Got ${localPort3}, excluded [8001, 8002, 8003]`
      );

    } catch (error) {
      this.logTest('Range forwarding', false, error.message);
    }
  }

  async testConflictResolution() {
    console.log('\n⚡ Testing Conflict Resolution...');

    // Reset config for clean test
    setConfig({
      portRange: { start: 8010, end: 8020 },
      excludedPorts: []
    });

    await this.createTestServer(3004);

    try {
      // Fill up some ports in the range to test conflict resolution
      const localPorts = [];
      for (let i = 0; i < 5; i++) {
        const port = await forwardPortWithRange(`test-sandbox-conflict-${i}`, '127.0.0.1', 3004);
        localPorts.push(port);
      }

      this.logTest(
        'Multiple port allocation',
        localPorts.length === 5 && new Set(localPorts).size === 5,
        `Allocated ${localPorts.length} unique ports: [${localPorts.join(', ')}]`
      );

      // Test that all ports are within range
      const allInRange = localPorts.every(port => port >= 8010 && port <= 8020);
      this.logTest(
        'Ports within configured range',
        allInRange,
        `All ports in range 8010-8020`
      );

    } catch (error) {
      this.logTest('Conflict resolution', false, error.message);
    }
  }

  async testAutoForwarding() {
    console.log('\n🤖 Testing Auto-forwarding...');

    // Create multiple test servers
    await this.createTestServer(3005);
    await this.createTestServer(3006);
    await this.createTestServer(3007);

    try {
      // Test auto-forwarding multiple ports
      const portInfos = [
        { port: 3005, protocol: 'tcp' },
        { port: 3006, protocol: 'tcp' },
        { port: 3007, protocol: 'tcp' },
        { port: 3008, protocol: 'udp' }, // Should be filtered out
      ];

      const results = await autoForwardPorts('test-sandbox-auto', '127.0.0.1', portInfos);
      
      this.logTest(
        'Auto-forward batch',
        results.length === 3, // UDP should be filtered out
        `Processed ${results.length}/4 ports (UDP filtered)`
      );

      const successfulForwards = results.filter(r => r.localPort !== undefined);
      this.logTest(
        'Auto-forward success rate',
        successfulForwards.length === 3,
        `${successfulForwards.length}/${results.length} successful`
      );

      // Test that second call doesn't duplicate
      const results2 = await autoForwardPorts('test-sandbox-auto', '127.0.0.1', portInfos);
      this.logTest(
        'Auto-forward deduplication',
        results2.length === 0,
        'No duplicates created'
      );

    } catch (error) {
      this.logTest('Auto-forwarding', false, error.message);
    }
  }

  async testStatusTracking() {
    console.log('\n📊 Testing Status Tracking...');

    try {
      // Get status for specific sandbox
      const autoStatus = getPortStatus('test-sandbox-auto');
      this.logTest(
        'Sandbox-specific status',
        autoStatus.length === 3,
        `Found ${autoStatus.length} active forwards`
      );

      // Get all statuses
      const allStatus = getPortStatus();
      this.logTest(
        'Global status tracking',
        allStatus.length > 3,
        `Total ${allStatus.length} forwards across all sandboxes`
      );

      // Test status fields
      const statusSample = allStatus[0];
      const hasRequiredFields = statusSample.remotePort && 
                               statusSample.localPort && 
                               statusSample.sandboxId && 
                               statusSample.status &&
                               typeof statusSample.createdAt === 'number';

      this.logTest(
        'Status field completeness',
        hasRequiredFields,
        'All required fields present'
      );

    } catch (error) {
      this.logTest('Status tracking', false, error.message);
    }
  }

  async testBatchOperations() {
    console.log('\n📦 Testing Batch Operations...');

    try {
      // Count forwards before cleanup
      const beforeCount = getPortStatus('test-sandbox-auto').length;
      
      // Test unforwarding all for a sandbox
      const removedCount = unforwardAll('test-sandbox-auto');
      this.logTest(
        'Batch unforward',
        removedCount === beforeCount,
        `Removed ${removedCount} forwards`
      );

      // Verify cleanup
      const afterStatus = getPortStatus('test-sandbox-auto');
      this.logTest(
        'Batch cleanup verification',
        afterStatus.length === 0,
        'All forwards removed'
      );

    } catch (error) {
      this.logTest('Batch operations', false, error.message);
    }
  }

  async testCleanup() {
    console.log('\n🧹 Testing Cleanup Operations...');

    try {
      // Get total count before cleanup
      const beforeCount = getPortStatus().length;
      
      // Test individual unforward
      const sampleStatus = getPortStatus()[0];
      if (sampleStatus) {
        const removed = unforwardPort(sampleStatus.sandboxId, sampleStatus.remotePort);
        this.logTest(
          'Individual unforward',
          removed === true,
          `Removed forward for port ${sampleStatus.remotePort}`
        );
      }

      // Test global cleanup
      cleanup();
      const afterCount = getPortStatus().length;
      this.logTest(
        'Global cleanup',
        afterCount === 0,
        `Cleaned up ${beforeCount} total forwards`
      );

    } catch (error) {
      this.logTest('Cleanup operations', false, error.message);
    }
  }

  printSummary() {
    console.log('\n📈 Test Summary');
    console.log('================');
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;

    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (failedTests > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => !r.success)
        .forEach(r => console.log(`   - ${r.name}: ${r.message}`));
    }

    console.log('\n🎉 Enhanced Port Forwarder Test Complete!');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const runner = new TestRunner();
  runner.runTests().catch(console.error);
}

module.exports = { TestRunner };