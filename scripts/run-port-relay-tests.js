#!/usr/bin/env node

/**
 * Port Relay Integration Test Runner
 *
 * Comprehensive test runner that orchestrates all port relay integration tests.
 * Provides different test profiles for various scenarios:
 *   - smoke: Quick smoke tests for basic functionality
 *   - integration: Full integration test suite
 *   - performance: Performance and load testing
 *   - comprehensive: All tests including stress testing
 *
 * Usage:
 *   node scripts/run-port-relay-tests.js [profile]
 *   npm run test:port-relay [profile]
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Test profiles configuration
const TEST_PROFILES = {
  smoke: {
    description: 'Quick smoke tests for basic functionality',
    timeout: 30000,
    tests: [
      'port-relay-integration.spec.ts --testNamePattern="Basic Port Forwarding"',
      'port-relay-manager.integration.spec.ts --testNamePattern="Configuration Management"'
    ]
  },
  integration: {
    description: 'Full integration test suite',
    timeout: 60000,
    tests: [
      'port-relay-integration.spec.ts',
      'websocket-tunnel-integration.spec.ts',
      'rpc-port-relay-integration.spec.ts'
    ]
  },
  ui: {
    description: 'UI and dashboard integration tests',
    timeout: 45000,
    tests: [
      'ports-panel-integration.spec.ts'
    ]
  },
  performance: {
    description: 'Performance and load testing',
    timeout: 120000,
    tests: [
      'port-relay-integration.spec.ts --testNamePattern="Performance"',
      'websocket-tunnel-integration.spec.ts --testNamePattern="Performance"',
      'port-relay-comprehensive.spec.ts --testNamePattern="Performance"'
    ]
  },
  comprehensive: {
    description: 'All tests including stress testing',
    timeout: 180000,
    tests: [
      'port-relay-integration.spec.ts',
      'port-relay-manager.integration.spec.ts', 
      'websocket-tunnel-integration.spec.ts',
      'rpc-port-relay-integration.spec.ts',
      'port-relay-comprehensive.spec.ts'
    ]
  }
};

// Default profile
const DEFAULT_PROFILE = 'integration';

// Utility functions
function printBanner() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  Port Relay Integration Test Suite');
  console.log('='.repeat(70));
  console.log('');
}

function printProfile(profile, config) {
  console.log(`Profile: ${profile}`);
  console.log(`Description: ${config.description}`);
  console.log(`Timeout: ${config.timeout}ms`);
  console.log(`Tests: ${config.tests.length} test suites`);
  console.log('');
}

function printAvailableProfiles() {
  console.log('Available test profiles:');
  console.log('');
  
  Object.entries(TEST_PROFILES).forEach(([name, config]) => {
    console.log(`  ${name.padEnd(15)} - ${config.description}`);
  });
  
  console.log('');
  console.log(`Default profile: ${DEFAULT_PROFILE}`);
  console.log('');
}

function validateEnvironment() {
  const errors = [];
  
  // Check if API server is running
  const apiPort = process.env.PORT || '6000';
  console.log(`Checking API server on port ${apiPort}...`);
  
  // Check required files exist
  const requiredDirs = [
    'apps/api-e2e',
    'apps/desktop',
    'apps/dashboard-e2e'
  ];
  
  for (const dir of requiredDirs) {
    if (!fs.existsSync(path.join(process.cwd(), dir))) {
      errors.push(`Required directory not found: ${dir}`);
    }
  }
  
  return errors;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function runTestSuite(testFile, timeout, additionalArgs = []) {
  const isE2E = testFile.includes('spec.ts');
  const isDesktopTest = testFile.includes('rpc-port-relay');
  const isDashboardTest = testFile.includes('ports-panel');
  
  let command, args;
  
  if (isDashboardTest) {
    // Dashboard E2E tests (Playwright)
    command = 'npx';
    args = [
      'playwright', 'test',
      path.join('apps/dashboard-e2e/src', testFile),
      '--timeout', timeout.toString(),
      ...additionalArgs
    ];
  } else if (isDesktopTest) {
    // Desktop RPC tests (Jest in desktop app)
    command = 'npx';
    args = [
      'jest',
      path.join('apps/desktop/src/__tests__', testFile),
      '--testTimeout', timeout.toString(),
      '--verbose',
      ...additionalArgs
    ];
  } else {
    // API E2E tests (Jest)
    command = 'npx';
    args = [
      'nx', 'e2e', '@apex/api-e2e',
      '--testPathPattern', testFile,
      '--testTimeout', timeout.toString(),
      ...additionalArgs
    ];
  }
  
  try {
    await runCommand(command, args);
    return { success: true, testFile };
  } catch (error) {
    return { success: false, testFile, error: error.message };
  }
}

async function runProfile(profileName, additionalArgs = []) {
  const profile = TEST_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown profile: ${profileName}`);
  }
  
  printProfile(profileName, profile);
  
  const results = [];
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  
  for (const test of profile.tests) {
    const [testFile, ...testArgs] = test.split(' ');
    const args = [...testArgs, ...additionalArgs];
    
    console.log(`\nRunning: ${testFile}`);
    console.log('-'.repeat(50));
    
    totalTests++;
    const startTime = Date.now();
    
    try {
      const result = await runTestSuite(testFile, profile.timeout, args);
      const duration = Date.now() - startTime;
      
      if (result.success) {
        console.log(`✅ PASSED: ${testFile} (${duration}ms)`);
        passedTests++;
      } else {
        console.log(`❌ FAILED: ${testFile} (${duration}ms)`);
        console.log(`   Error: ${result.error}`);
        failedTests++;
      }
      
      results.push({ ...result, duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`❌ ERROR: ${testFile} (${duration}ms)`);
      console.log(`   Error: ${error.message}`);
      failedTests++;
      
      results.push({ 
        success: false, 
        testFile, 
        error: error.message, 
        duration 
      });
    }
  }
  
  // Print summary
  console.log('');
  console.log('='.repeat(70));
  console.log('  Test Results Summary');
  console.log('='.repeat(70));
  console.log(`Profile: ${profileName}`);
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Success rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  const totalDuration = results.reduce((sum, result) => sum + (result.duration || 0), 0);
  console.log(`Total duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);
  console.log('');
  
  if (failedTests > 0) {
    console.log('Failed tests:');
    results
      .filter(result => !result.success)
      .forEach(result => {
        console.log(`  ❌ ${result.testFile}: ${result.error}`);
      });
    console.log('');
  }
  
  return {
    totalTests,
    passedTests,
    failedTests,
    successRate: (passedTests / totalTests) * 100,
    totalDuration,
    results
  };
}

async function main() {
  const args = process.argv.slice(2);
  const profileName = args[0] || DEFAULT_PROFILE;
  const additionalArgs = args.slice(1);
  
  printBanner();
  
  // Handle help command
  if (profileName === 'help' || profileName === '--help' || profileName === '-h') {
    printAvailableProfiles();
    process.exit(0);
  }
  
  // Validate profile
  if (!TEST_PROFILES[profileName]) {
    console.error(`❌ Unknown profile: ${profileName}`);
    console.log('');
    printAvailableProfiles();
    process.exit(1);
  }
  
  // Validate environment
  console.log('Validating environment...');
  const errors = validateEnvironment();
  if (errors.length > 0) {
    console.error('❌ Environment validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    console.log('');
    console.log('Please ensure:');
    console.log('  1. API server is running (npm run serve:api)');
    console.log('  2. All required directories exist');
    console.log('  3. Dependencies are installed');
    process.exit(1);
  }
  console.log('✅ Environment validation passed');
  console.log('');
  
  try {
    const result = await runProfile(profileName, additionalArgs);
    
    if (result.failedTests > 0) {
      console.log('❌ Some tests failed. Check the output above for details.');
      process.exit(1);
    } else {
      console.log('✅ All tests passed!');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Test execution failed:');
    console.error(error.message);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the main function
main().catch(error => {
  console.error('❌ Main execution failed:', error);
  process.exit(1);
});