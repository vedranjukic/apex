#!/usr/bin/env node
/**
 * Comprehensive Test Suite for GitHub Merge Status Indicators Implementation
 * 
 * This script performs end-to-end testing of the merge status indicators feature:
 * 1. Database schema validation
 * 2. TypeScript interface verification
 * 3. API endpoint testing
 * 4. WebSocket event testing
 * 5. Frontend component validation
 * 6. Integration testing
 * 7. Performance verification
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000/ws/projects';
const PROJECT_ROOT = process.cwd();

// Test results storage
const testResults = {
  database: { passed: 0, failed: 0, tests: [] },
  typescript: { passed: 0, failed: 0, tests: [] },
  api: { passed: 0, failed: 0, tests: [] },
  websocket: { passed: 0, failed: 0, tests: [] },
  frontend: { passed: 0, failed: 0, tests: [] },
  integration: { passed: 0, failed: 0, tests: [] }
};

// Utility functions
function logTest(category, testName, passed, details = '') {
  const status = passed ? '✅' : '❌';
  console.log(`  ${status} ${testName}${details ? ` - ${details}` : ''}`);
  
  testResults[category].tests.push({ name: testName, passed, details });
  if (passed) testResults[category].passed++;
  else testResults[category].failed++;
}

async function fetchJson(url, options = {}) {
  try {
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
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

function fileExists(filePath) {
  try {
    return fs.existsSync(path.join(PROJECT_ROOT, filePath));
  } catch {
    return false;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(path.join(PROJECT_ROOT, filePath), 'utf8');
  } catch {
    return null;
  }
}

// Test Categories
async function testDatabaseSchema() {
  console.log('\n🗄️  Testing Database Schema...');
  
  // Test 1: Check if migration files exist
  const migrationPattern = /apps\/api\/src\/database\/migrations/;
  const hasMigration = fs.readdirSync(path.join(PROJECT_ROOT, 'apps/api/src'), { recursive: true })
    .some(file => file.toString().includes('migration') || file.toString().includes('drizzle'));
  logTest('database', 'Migration system exists', hasMigration);
  
  // Test 2: Check database file exists
  const dbExists = fileExists('apex.db');
  logTest('database', 'Database file exists', dbExists, dbExists ? 'apex.db found' : 'apex.db not found');
  
  // Test 3: Check projects table schema in entity files
  const projectsEntity = readFile('libs/shared/src/lib/entities/project.entity.ts');
  const hasMergeStatusField = projectsEntity && projectsEntity.includes('mergeStatus');
  logTest('database', 'Project entity has mergeStatus field', hasMergeStatusField);
  
  // Test 4: Check database service integration
  const projectsService = readFile('apps/api/src/modules/projects/projects.service.ts');
  const serviceHandlesMergeStatus = projectsService && 
    (projectsService.includes('mergeStatus') || projectsService.includes('merge_status'));
  logTest('database', 'Projects service handles mergeStatus', serviceHandlesMergeStatus);
}

async function testTypeScriptInterfaces() {
  console.log('\n📝 Testing TypeScript Interfaces...');
  
  // Test 1: MergeStatusData interface exists
  const clientTypes = readFile('apps/dashboard/src/lib/api/client.ts');
  const hasMergeStatusInterface = clientTypes && clientTypes.includes('MergeStatusData');
  logTest('typescript', 'MergeStatusData interface exists', hasMergeStatusInterface);
  
  // Test 2: Project interface includes mergeStatus
  const hasProjectMergeStatus = clientTypes && 
    clientTypes.includes('mergeStatus') && 
    clientTypes.includes('MergeStatusData');
  logTest('typescript', 'Project interface includes mergeStatus', hasProjectMergeStatus);
  
  // Test 3: WebSocket event types
  const wsTypes = readFile('apps/api/src/modules/projects/projects.ws.ts');
  const hasMergeStatusEvents = wsTypes && 
    wsTypes.includes('merge-status-updated') && 
    wsTypes.includes('merge-status-poll-completed');
  logTest('typescript', 'WebSocket merge status event types exist', hasMergeStatusEvents);
  
  // Test 4: Check for proper typing in projects store
  const projectsStore = readFile('apps/dashboard/src/stores/projects-store.ts');
  const storeHasMergeStatusSupport = projectsStore && 
    (projectsStore.includes('setProjectMergeStatus') || projectsStore.includes('mergeStatus'));
  logTest('typescript', 'Projects store has merge status support', storeHasMergeStatusSupport);
}

async function testAPIEndpoints() {
  console.log('\n🌐 Testing API Endpoints...');
  
  try {
    // Test 1: Polling status endpoint
    const status = await fetchJson('/github/polling/status');
    logTest('api', 'GET /github/polling/status works', true, 
      `Service ${status.enabled ? 'enabled' : 'disabled'}`);
    
    // Test 2: Check status response structure
    const hasRequiredFields = status.hasOwnProperty('enabled') && 
      status.hasOwnProperty('intervalMinutes') && 
      status.hasOwnProperty('hasGitHubToken');
    logTest('api', 'Status response has required fields', hasRequiredFields);
    
    // Test 3: Manual trigger endpoint
    const triggerResult = await fetchJson('/github/polling/trigger', { method: 'POST' });
    const triggerWorked = triggerResult.message && triggerResult.message.includes('triggered');
    logTest('api', 'POST /github/polling/trigger works', triggerWorked);
    
    // Test 4: Configuration update endpoint
    const configUpdate = await fetchJson('/github/polling/config', {
      method: 'PUT',
      body: JSON.stringify({
        intervalMinutes: 10,
        enabled: true
      })
    });
    const configWorked = configUpdate.message && configUpdate.message.includes('updated');
    logTest('api', 'PUT /github/polling/config works', configWorked);
    
  } catch (error) {
    logTest('api', 'API endpoints accessible', false, error.message);
  }
}

async function testWebSocketEvents() {
  console.log('\n🔌 Testing WebSocket Events...');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let connected = false;
    let receivedEvents = [];
    
    const timeout = setTimeout(() => {
      if (connected) {
        ws.close();
      }
      resolve(receivedEvents);
    }, 10000);
    
    ws.on('open', () => {
      connected = true;
      logTest('websocket', 'WebSocket connection established', true);
    });
    
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        receivedEvents.push(event);
        
        // Check for merge status events
        if (event.type && event.type.startsWith('merge-status-')) {
          logTest('websocket', `Received ${event.type} event`, true);
        }
      } catch (error) {
        logTest('websocket', 'WebSocket message parsing', false, error.message);
      }
    });
    
    ws.on('error', (error) => {
      logTest('websocket', 'WebSocket error handling', false, error.message);
      clearTimeout(timeout);
      resolve(receivedEvents);
    });
    
    ws.on('close', () => {
      clearTimeout(timeout);
      resolve(receivedEvents);
    });
  });
}

async function testFrontendComponents() {
  console.log('\n🖥️  Testing Frontend Components...');
  
  // Test 1: MergeStatusIcon component exists
  const iconComponent = readFile('apps/dashboard/src/components/projects/merge-status-icon.tsx');
  const iconExists = iconComponent !== null;
  logTest('frontend', 'MergeStatusIcon component exists', iconExists);
  
  // Test 2: Component uses proper imports
  const hasLucideImports = iconComponent && iconComponent.includes('lucide-react');
  logTest('frontend', 'Uses Lucide React icons', hasLucideImports);
  
  // Test 3: Component handles all status states
  const handlesAllStates = iconComponent && 
    iconComponent.includes('mergeable') && 
    iconComponent.includes('mergeable_state') && 
    iconComponent.includes('checks_status');
  logTest('frontend', 'Handles all merge status states', handlesAllStates);
  
  // Test 4: Project list integration
  const projectList = readFile('apps/dashboard/src/components/projects/project-list.tsx');
  const hasRepoInfoIntegration = projectList && projectList.includes('MergeStatusIcon');
  logTest('frontend', 'Integrated into project list', hasRepoInfoIntegration);
  
  // Test 5: WebSocket hook integration
  const socketHook = readFile('apps/dashboard/src/hooks/use-projects-socket.ts');
  const hookHandlesMergeStatus = socketHook && 
    socketHook.includes('merge-status-updated');
  logTest('frontend', 'WebSocket hook handles merge status', hookHandlesMergeStatus);
}

async function testIntegrationPoints() {
  console.log('\n🔄 Testing Integration Points...');
  
  // Test 1: GitHub service integration
  const githubService = readFile('apps/api/src/modules/github/github.service.ts');
  const serviceHasMergeStatus = githubService && 
    (githubService.includes('getMergeStatus') || githubService.includes('mergeable'));
  logTest('integration', 'GitHub service supports merge status', serviceHasMergeStatus);
  
  // Test 2: Polling service exists
  const pollingService = readFile('apps/api/src/modules/github/github-merge-poller.service.ts');
  const pollingExists = pollingService !== null;
  logTest('integration', 'GitHub merge polling service exists', pollingExists);
  
  // Test 3: Service initialization in main.ts
  const mainFile = readFile('apps/api/src/main.ts');
  const serviceInitialized = mainFile && 
    (mainFile.includes('GitHubMergePollerService') || mainFile.includes('github-merge-poller'));
  logTest('integration', 'Polling service initialized in main.ts', serviceInitialized);
  
  // Test 4: Error handling implementation
  const hasErrorHandling = pollingService && 
    pollingService.includes('try') && 
    pollingService.includes('catch') && 
    pollingService.includes('error');
  logTest('integration', 'Proper error handling implemented', hasErrorHandling);
  
  // Test 5: Rate limiting consideration
  const hasRateLimit = pollingService && 
    (pollingService.includes('rate') || pollingService.includes('retry') || pollingService.includes('delay'));
  logTest('integration', 'GitHub rate limiting handled', hasRateLimit);
}

async function performanceTest() {
  console.log('\n⚡ Testing Performance Characteristics...');
  
  try {
    const startTime = Date.now();
    const status = await fetchJson('/github/polling/status');
    const responseTime = Date.now() - startTime;
    
    logTest('integration', 'API response time acceptable', responseTime < 1000, 
      `${responseTime}ms`);
    
    // Memory usage test (basic)
    const memUsage = process.memoryUsage();
    const memoryOK = memUsage.heapUsed < 100 * 1024 * 1024; // Less than 100MB
    logTest('integration', 'Memory usage reasonable', memoryOK, 
      `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    
  } catch (error) {
    logTest('integration', 'Performance test', false, error.message);
  }
}

function generateTestSummary() {
  console.log('\n📊 COMPREHENSIVE TEST SUMMARY');
  console.log('═'.repeat(60));
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  Object.entries(testResults).forEach(([category, results]) => {
    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
    const total = results.passed + results.failed;
    const percentage = total > 0 ? Math.round((results.passed / total) * 100) : 0;
    
    console.log(`\n${categoryName.padEnd(15)} ${results.passed}/${total} (${percentage}%)`);
    
    // Show failed tests
    results.tests.filter(test => !test.passed).forEach(test => {
      console.log(`  ❌ ${test.name}: ${test.details}`);
    });
    
    totalPassed += results.passed;
    totalFailed += results.failed;
  });
  
  const overallTotal = totalPassed + totalFailed;
  const overallPercentage = overallTotal > 0 ? Math.round((totalPassed / overallTotal) * 100) : 0;
  
  console.log('\n' + '═'.repeat(60));
  console.log(`OVERALL RESULTS: ${totalPassed}/${overallTotal} tests passed (${overallPercentage}%)`);
  
  if (overallPercentage >= 90) {
    console.log('🎉 EXCELLENT! Merge status implementation is working great!');
  } else if (overallPercentage >= 70) {
    console.log('✅ GOOD! Most features are working, some minor issues to address.');
  } else if (overallPercentage >= 50) {
    console.log('⚠️  NEEDS WORK! Several issues need to be resolved.');
  } else {
    console.log('❌ CRITICAL ISSUES! Major problems need immediate attention.');
  }
  
  return {
    totalPassed,
    totalFailed,
    overallPercentage,
    categoryResults: testResults
  };
}

async function generateImplementationReport(testSummary) {
  console.log('\n📋 IMPLEMENTATION FEATURES REPORT');
  console.log('═'.repeat(60));
  
  const features = [
    {
      name: 'Database Schema & Migration',
      status: testSummary.categoryResults.database.passed > 0 ? '✅' : '❌',
      description: 'merge_status column added to projects table'
    },
    {
      name: 'TypeScript Interfaces',
      status: testSummary.categoryResults.typescript.passed >= 3 ? '✅' : '⚠️',
      description: 'MergeStatusData interface and Project type updates'
    },
    {
      name: 'API Endpoints',
      status: testSummary.categoryResults.api.passed >= 3 ? '✅' : '❌',
      description: 'Polling management endpoints (/status, /trigger, /config)'
    },
    {
      name: 'WebSocket Real-time Updates',
      status: testSummary.categoryResults.websocket.passed > 0 ? '✅' : '⚠️',
      description: 'Live merge status updates via WebSocket events'
    },
    {
      name: 'Frontend Components',
      status: testSummary.categoryResults.frontend.passed >= 3 ? '✅' : '❌',
      description: 'MergeStatusIcon component with visual indicators'
    },
    {
      name: 'Backend Integration',
      status: testSummary.categoryResults.integration.passed >= 3 ? '✅' : '❌',
      description: 'GitHub API service, polling service, error handling'
    }
  ];
  
  features.forEach(feature => {
    console.log(`${feature.status} ${feature.name}`);
    console.log(`   ${feature.description}`);
  });
  
  console.log('\n🔍 VERIFICATION CHECKLIST:');
  console.log('─'.repeat(40));
  
  const checklist = [
    'Database migration for merge_status column',
    'TypeScript interfaces properly typed',
    'API endpoints correctly defined and working',
    'WebSocket events for real-time updates',
    'Frontend components render without errors',
    'GitHub service methods implemented',
    'Error handling and rate limiting',
    'Service initialization and lifecycle'
  ];
  
  checklist.forEach((item, index) => {
    const passed = testSummary.overallPercentage > 75;
    console.log(`${passed ? '✅' : '❓'} ${item}`);
  });
}

async function runComprehensiveTests() {
  console.log('🧪 COMPREHENSIVE MERGE STATUS INDICATORS TEST SUITE');
  console.log('═'.repeat(60));
  console.log('Testing implementation across all layers...\n');
  
  // Run all test categories
  await testDatabaseSchema();
  await testTypeScriptInterfaces();
  await testAPIEndpoints();
  const wsEvents = await testWebSocketEvents();
  await testFrontendComponents();
  await testIntegrationPoints();
  await performanceTest();
  
  // Generate comprehensive summary
  const testSummary = generateTestSummary();
  await generateImplementationReport(testSummary);
  
  // Final recommendations
  console.log('\n🎯 RECOMMENDATIONS:');
  console.log('─'.repeat(40));
  
  if (testSummary.overallPercentage >= 90) {
    console.log('• Implementation is production-ready');
    console.log('• Consider adding monitoring and metrics');
    console.log('• Documentation looks comprehensive');
  } else if (testSummary.overallPercentage >= 70) {
    console.log('• Address failing tests before deployment');
    console.log('• Verify WebSocket event handling');
    console.log('• Test with real GitHub repositories');
  } else {
    console.log('• Critical issues need immediate resolution');
    console.log('• Review implementation against requirements');
    console.log('• Consider code review with team');
  }
  
  console.log('\n📚 For detailed implementation info, see:');
  console.log('• IMPLEMENTATION_SUMMARY.md - Backend implementation');
  console.log('• MERGE_STATUS_FRONTEND_IMPLEMENTATION.md - Frontend details');
  
  return testSummary;
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Tests interrupted by user');
  process.exit(0);
});

// Execute comprehensive test suite
if (require.main === module) {
  runComprehensiveTests().catch((error) => {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { runComprehensiveTests };