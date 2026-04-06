#!/usr/bin/env node

/**
 * E2E Test Runner for Settings API
 * 
 * Utility to run all settings-related E2E tests and validate the fixes.
 * This can be used in CI/CD pipelines to prevent regression of the 500 error.
 * 
 * Usage:
 *   npm run test:settings-e2e
 *   # or directly:
 *   npx tsx apps/api-e2e/src/settings-e2e-runner.ts
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const projectRoot = process.cwd();
const apiE2EPath = join(projectRoot, 'apps/api-e2e');

console.log('🧪 Settings API E2E Test Runner');
console.log('=================================');

// Validate environment
const requiredEnvVars = ['ANTHROPIC_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(env => !process.env[env]);

if (missingEnvVars.length > 0) {
  console.warn('⚠️  Missing environment variables:', missingEnvVars.join(', '));
  console.warn('   Some tests will be skipped.');
}

// Validate test files exist
const testFiles = [
  'settings-api.e2e-spec.ts',
  'settings-dashboard-integration.e2e-spec.ts', 
  'settings-type-safety.e2e-spec.ts',
];

console.log('\n📁 Checking test files...');
const missingFiles = testFiles.filter(file => 
  !existsSync(join(apiE2EPath, 'src', file))
);

if (missingFiles.length > 0) {
  console.error('❌ Missing test files:', missingFiles.join(', '));
  process.exit(1);
}

console.log('✅ All test files found');

// Run tests
console.log('\n🚀 Starting E2E tests...');
console.log('Note: These tests include proxy sandbox timeout scenarios');
console.log('      Each test suite may take 30-60 seconds to complete\n');

const testCommands = [
  {
    name: 'Settings API Core Tests',
    command: 'npx nx e2e @apex/api-e2e --testPathPattern=settings-api.e2e-spec.ts',
    description: 'Core settings API functionality and error handling'
  },
  {
    name: 'Dashboard Integration Tests', 
    command: 'npx nx e2e @apex/api-e2e --testPathPattern=settings-dashboard-integration.e2e-spec.ts',
    description: 'Full dashboard workflow simulation'
  },
  {
    name: 'Type Safety Tests',
    command: 'npx nx e2e @apex/api-e2e --testPathPattern=settings-type-safety.e2e-spec.ts', 
    description: 'Edge cases and regression prevention'
  }
];

const results: Array<{ name: string; success: boolean; duration: number }> = [];

for (const test of testCommands) {
  console.log(`\n📋 Running: ${test.name}`);
  console.log(`   ${test.description}`);
  
  const startTime = Date.now();
  let success = false;
  
  try {
    execSync(test.command, { 
      stdio: 'inherit',
      cwd: projectRoot,
      timeout: 5 * 60 * 1000 // 5 minute timeout per test suite
    });
    success = true;
    console.log(`✅ ${test.name} - PASSED`);
  } catch (error) {
    console.error(`❌ ${test.name} - FAILED`);
    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);
    }
  }
  
  const duration = Date.now() - startTime;
  results.push({ name: test.name, success, duration });
}

// Summary
console.log('\n📊 Test Results Summary');
console.log('========================');

let allPassed = true;
for (const result of results) {
  const status = result.success ? '✅ PASS' : '❌ FAIL';
  const duration = `${Math.round(result.duration / 1000)}s`;
  console.log(`${status} ${result.name} (${duration})`);
  
  if (!result.success) {
    allPassed = false;
  }
}

const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
console.log(`\nTotal time: ${Math.round(totalDuration / 1000)}s`);

if (allPassed) {
  console.log('\n🎉 All settings E2E tests passed!');
  console.log('   The 500 error fix is working correctly.');
  process.exit(0);
} else {
  console.log('\n💥 Some tests failed!');
  console.log('   There may be a regression in the settings API fix.');
  process.exit(1);
}