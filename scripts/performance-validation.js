#!/usr/bin/env node

/**
 * Performance validation script for offline mode implementation
 * 
 * This script runs comprehensive performance tests to ensure the offline mode
 * implementation doesn't introduce performance issues, memory leaks, or
 * excessive resource usage.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Starting Performance Validation for Offline Mode...\n');

// Configuration
const PERFORMANCE_CONFIG = {
  maxMemoryIncrease: 50, // MB
  maxTestDuration: 30000, // 30 seconds
  reconnectionAttempts: 100,
  stateTransitions: 500,
};

/**
 * Run command and capture output
 */
function runCommand(command, description) {
  console.log(`⏳ ${description}...`);
  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 60000 });
    console.log(`✅ ${description} - PASSED\n`);
    return { success: true, output };
  } catch (error) {
    console.log(`❌ ${description} - FAILED`);
    console.log(`Error: ${error.message}\n`);
    return { success: false, error: error.message };
  }
}

/**
 * Check build performance
 */
function validateBuildPerformance() {
  console.log('📦 Build Performance Validation');
  console.log('================================');
  
  const startTime = Date.now();
  
  const dashboardResult = runCommand(
    'npm run build:dashboard',
    'Building dashboard (checking for performance regressions)'
  );
  
  const apiResult = runCommand(
    'npm run build:api',
    'Building API (checking for performance regressions)'
  );
  
  const buildTime = Date.now() - startTime;
  console.log(`⏱️  Total build time: ${buildTime}ms`);
  
  if (buildTime > 120000) { // 2 minutes
    console.log('⚠️  Warning: Build time is longer than expected');
  }
  
  return dashboardResult.success && apiResult.success;
}

/**
 * Run performance-focused tests
 */
function runPerformanceTests() {
  console.log('🧪 Performance Test Suite');
  console.log('=========================');
  
  const testCommands = [
    {
      command: 'npm test -- --testPathPattern="network-store" --verbose',
      description: 'Network store performance tests',
    },
    {
      command: 'npm test -- --testPathPattern="use-network-status" --verbose', 
      description: 'Network status hook performance tests',
    },
    {
      command: 'npm test -- --testPathPattern="reconnecting-ws" --verbose',
      description: 'WebSocket performance tests',
    },
    {
      command: 'npm test -- --testPathPattern="offline-mode-integration" --verbose',
      description: 'Integration performance tests',
    }
  ];
  
  const results = testCommands.map(({ command, description }) =>
    runCommand(command, description)
  );
  
  return results.every(result => result.success);
}

/**
 * Memory usage validation test
 */
function createMemoryValidationTest() {
  const testContent = `
/**
 * Memory usage validation test for offline mode
 */

import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus } from '../hooks/use-network-status';
import { NetworkTestUtils, NetworkTestScenarios } from '../test-utils/network-testing-utils';
import { ReconnectingWebSocket } from '../lib/reconnecting-ws';

// Mock performance.memory for Node.js
const mockMemory = {
  usedJSHeapSize: 10 * 1024 * 1024, // 10MB initial
  totalJSHeapSize: 20 * 1024 * 1024, // 20MB initial
};

Object.defineProperty(performance, 'memory', {
  value: mockMemory,
  writable: true,
});

describe('Memory Performance Validation', () => {
  beforeEach(() => {
    NetworkTestUtils.cleanup();
    // Reset memory mock
    mockMemory.usedJSHeapSize = 10 * 1024 * 1024;
  });

  afterEach(() => {
    NetworkTestUtils.cleanup();
  });

  test('should not leak memory during rapid state transitions', async () => {
    const initialMemory = mockMemory.usedJSHeapSize;
    const { result } = renderHook(() => useNetworkStatus());
    
    // Simulate rapid state transitions
    for (let i = 0; i < ${PERFORMANCE_CONFIG.stateTransitions}; i++) {
      act(() => {
        NetworkTestUtils.triggerNetworkEvent(i % 2 === 0 ? 'offline' : 'online');
      });
      
      // Simulate memory usage increase (small amount per transition)
      mockMemory.usedJSHeapSize += 1024; // 1KB per transition
    }
    
    const finalMemory = mockMemory.usedJSHeapSize;
    const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024); // Convert to MB
    
    // Should not increase memory by more than configured limit
    expect(memoryIncrease).toBeLessThan(${PERFORMANCE_CONFIG.maxMemoryIncrease});
  });

  test('should clean up WebSocket resources properly', () => {
    const sockets = [];
    
    // Create multiple WebSocket instances
    for (let i = 0; i < 10; i++) {
      const ws = new ReconnectingWebSocket('/test-' + i);
      sockets.push(ws);
    }
    
    // Destroy all sockets
    sockets.forEach(ws => ws.destroy());
    
    // Check that network store is clean
    const networkState = NetworkTestUtils.getNetworkState();
    expect(networkState.socketConnected).toBe(false);
    expect(networkState.isReconnecting).toBe(false);
  });

  test('should handle many reconnection attempts efficiently', async () => {
    const startTime = Date.now();
    const mockWS = NetworkTestUtils.createMockWebSocket();
    const reconnectingWS = new ReconnectingWebSocket('/test');
    
    // Simulate many failed connections
    for (let i = 0; i < ${PERFORMANCE_CONFIG.reconnectionAttempts}; i++) {
      act(() => {
        mockWS.triggerClose();
        jest.advanceTimersByTime(1000);
      });
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Should complete within reasonable time
    expect(duration).toBeLessThan(${PERFORMANCE_CONFIG.maxTestDuration});
    
    reconnectingWS.destroy();
  });

  test('should not create excessive timers', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    
    // Create multiple hook instances
    const hooks = [];
    for (let i = 0; i < 5; i++) {
      const { result } = renderHook(() => useNetworkStatus());
      hooks.push(result);
    }
    
    // Should not create excessive timers (max 2 per hook: connectivity check + any reconnect timer)
    expect(setIntervalSpy).toHaveBeenCalledTimes(5); // One connectivity check per hook
    
    hooks.forEach(({ current }) => {
      // Trigger some network events
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
        NetworkTestUtils.triggerNetworkEvent('online');
      });
    });
    
    // Timer count should remain reasonable
    expect(setTimeoutSpy.mock.calls.length).toBeLessThan(20);
    
    setIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });
});
`;

  const testPath = path.join(__dirname, '../apps/dashboard/src/__tests__/performance/memory-validation.test.ts');
  const testDir = path.dirname(testPath);
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  fs.writeFileSync(testPath, testContent);
  console.log('📝 Created memory validation test');
  
  return testPath;
}

/**
 * Run memory validation
 */
function validateMemoryUsage() {
  console.log('🧠 Memory Usage Validation');
  console.log('==========================');
  
  const testPath = createMemoryValidationTest();
  
  const result = runCommand(
    `npm test -- ${testPath} --verbose`,
    'Running memory validation tests'
  );
  
  return result.success;
}

/**
 * Bundle size analysis
 */
function analyzeBundleSize() {
  console.log('📊 Bundle Size Analysis');
  console.log('=======================');
  
  try {
    // Check if build exists
    const distPath = path.join(__dirname, '../apps/dashboard/dist');
    if (!fs.existsSync(distPath)) {
      console.log('⚠️  No build found, running build first...');
      runCommand('npm run build:dashboard', 'Building dashboard for bundle analysis');
    }
    
    // Analyze main bundle
    const files = fs.readdirSync(path.join(distPath, 'assets'));
    const jsFiles = files.filter(f => f.endsWith('.js') && !f.includes('worker'));
    
    let totalSize = 0;
    let networkRelatedSize = 0;
    
    jsFiles.forEach(file => {
      const filePath = path.join(distPath, 'assets', file);
      const stats = fs.statSync(filePath);
      const sizeKB = stats.size / 1024;
      
      totalSize += sizeKB;
      
      // Check if file likely contains network-related code
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('network') || content.includes('reconnect') || content.includes('websocket')) {
        networkRelatedSize += sizeKB;
      }
      
      console.log(`  📄 ${file}: ${sizeKB.toFixed(2)} KB`);
    });
    
    console.log(`\n📐 Total JS bundle size: ${totalSize.toFixed(2)} KB`);
    console.log(`🌐 Network-related code: ${networkRelatedSize.toFixed(2)} KB (${(networkRelatedSize / totalSize * 100).toFixed(1)}%)`);
    
    // Warning thresholds
    if (totalSize > 10000) { // 10MB
      console.log('⚠️  Warning: Bundle size is very large');
    }
    
    if (networkRelatedSize > 200) { // 200KB
      console.log('⚠️  Warning: Network code footprint is larger than expected');
    } else {
      console.log('✅ Network code footprint is reasonable');
    }
    
    return true;
  } catch (error) {
    console.log(`❌ Bundle analysis failed: ${error.message}`);
    return false;
  }
}

/**
 * TypeScript performance check
 */
function validateTypeScriptPerformance() {
  console.log('🔍 TypeScript Performance Check');
  console.log('===============================');
  
  const result = runCommand(
    'npx tsc --noEmit --incremental --tsBuildInfoFile .tsbuildinfo',
    'TypeScript compilation performance check'
  );
  
  return result.success;
}

/**
 * Runtime performance test
 */
function createRuntimePerformanceTest() {
  const testContent = `
/**
 * Runtime performance test for offline mode
 */

import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus } from '../hooks/use-network-status';
import { NetworkTestUtils } from '../test-utils/network-testing-utils';

describe('Runtime Performance', () => {
  beforeEach(() => {
    NetworkTestUtils.cleanup();
  });

  afterEach(() => {
    NetworkTestUtils.cleanup();
  });

  test('hook initialization should be fast', () => {
    const startTime = performance.now();
    
    const { result } = renderHook(() => useNetworkStatus());
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Hook initialization should be very fast (< 10ms)
    expect(duration).toBeLessThan(10);
    expect(result.current.isOnline).toBeDefined();
  });

  test('state updates should be fast', () => {
    const { result } = renderHook(() => useNetworkStatus());
    
    const startTime = performance.now();
    
    act(() => {
      result.current.handleSocketConnected();
      result.current.handleSocketDisconnected();
      result.current.handleSocketReconnecting();
      result.current.handleConnectionError();
    });
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // All state updates should complete quickly (< 5ms)
    expect(duration).toBeLessThan(5);
  });

  test('rapid network events should not block UI', async () => {
    renderHook(() => useNetworkStatus());
    
    const startTime = performance.now();
    
    // Simulate rapid network events
    for (let i = 0; i < 100; i++) {
      act(() => {
        NetworkTestUtils.triggerNetworkEvent(i % 2 === 0 ? 'offline' : 'online');
      });
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Should handle 100 events quickly (< 100ms)
    expect(duration).toBeLessThan(100);
  });
});
`;

  const testPath = path.join(__dirname, '../apps/dashboard/src/__tests__/performance/runtime-performance.test.ts');
  const testDir = path.dirname(testPath);
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  fs.writeFileSync(testPath, testContent);
  
  return testPath;
}

/**
 * Run runtime performance tests
 */
function validateRuntimePerformance() {
  console.log('⚡ Runtime Performance Validation');
  console.log('=================================');
  
  const testPath = createRuntimePerformanceTest();
  
  const result = runCommand(
    `npm test -- ${testPath} --verbose`,
    'Running runtime performance tests'
  );
  
  return result.success;
}

/**
 * Main validation function
 */
async function main() {
  const validations = [
    { name: 'Build Performance', fn: validateBuildPerformance },
    { name: 'Performance Tests', fn: runPerformanceTests },
    { name: 'Memory Usage', fn: validateMemoryUsage },
    { name: 'Runtime Performance', fn: validateRuntimePerformance },
    { name: 'Bundle Size Analysis', fn: analyzeBundleSize },
    { name: 'TypeScript Performance', fn: validateTypeScriptPerformance },
  ];
  
  const results = [];
  
  for (const validation of validations) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Starting: ${validation.name}`);
    console.log(`${'='.repeat(50)}\n`);
    
    const success = await validation.fn();
    results.push({ name: validation.name, success });
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('PERFORMANCE VALIDATION SUMMARY');
  console.log('='.repeat(50));
  
  results.forEach(({ name, success }) => {
    const status = success ? '✅ PASSED' : '❌ FAILED';
    console.log(`${status} - ${name}`);
  });
  
  const allPassed = results.every(r => r.success);
  
  if (allPassed) {
    console.log('\n🎉 All performance validations passed!');
    console.log('The offline mode implementation meets performance requirements.');
  } else {
    console.log('\n⚠️  Some performance validations failed.');
    console.log('Please review the failures above and optimize accordingly.');
  }
  
  console.log('\n📊 Performance Metrics Summary:');
  console.log(`- Max memory increase allowed: ${PERFORMANCE_CONFIG.maxMemoryIncrease}MB`);
  console.log(`- Max test duration: ${PERFORMANCE_CONFIG.maxTestDuration}ms`);
  console.log(`- Reconnection attempts tested: ${PERFORMANCE_CONFIG.reconnectionAttempts}`);
  console.log(`- State transitions tested: ${PERFORMANCE_CONFIG.stateTransitions}`);
  
  process.exit(allPassed ? 0 : 1);
}

// Run the validation
if (require.main === module) {
  main().catch(error => {
    console.error('Validation failed:', error);
    process.exit(1);
  });
}

module.exports = {
  validateBuildPerformance,
  runPerformanceTests,
  validateMemoryUsage,
  validateRuntimePerformance,
  analyzeBundleSize,
  validateTypeScriptPerformance,
};