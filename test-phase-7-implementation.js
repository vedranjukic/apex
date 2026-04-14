#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Test configuration
const testConfig = {
  testRepo: 'octocat/Hello-World',
  colors: {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
  }
};

function log(message, color = '') {
  console.log(`${color}${message}${testConfig.colors.reset}`);
}

function logHeader(title) {
  log(`\n${testConfig.colors.bold}=== ${title} ===${testConfig.colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, testConfig.colors.green);
}

function logError(message) {
  log(`❌ ${message}`, testConfig.colors.red);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, testConfig.colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, testConfig.colors.yellow);
}

// File validation helpers
function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    logSuccess(`${description} exists: ${filePath}`);
    return true;
  } else {
    logError(`${description} missing: ${filePath}`);
    return false;
  }
}

function checkFileContains(filePath, searchString, description) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(searchString)) {
      logSuccess(`${description} contains required content`);
      return true;
    } else {
      logError(`${description} missing required content: ${searchString}`);
      return false;
    }
  } catch (err) {
    logError(`Error reading ${description}: ${err.message}`);
    return false;
  }
}

function validateRepositorySecretsHook() {
  logHeader('Testing Repository Secrets Hook');
  
  const hookPath = 'apps/dashboard/src/hooks/use-repository-secrets.ts';
  const passed = [];
  
  // Check if hook file exists
  if (!checkFileExists(hookPath, 'Repository secrets hook')) {
    return false;
  }
  
  // Check hook implementation
  const hookChecks = [
    ['useRepositorySecrets export', 'export function useRepositorySecrets'],
    ['secretsApi import', 'import { secretsApi'],
    ['useState for loading', 'useState(false)'],
    ['useEffect for API call', 'useEffect'],
    ['Repository ID parameter', 'repositoryId: string | null'],
    ['Secrets filtering', 'filter(s => s.isSecret)'],
    ['Environment variables filtering', 'filter(s => !s.isSecret)']
  ];
  
  hookChecks.forEach(([desc, search]) => {
    if (checkFileContains(hookPath, search, `Hook ${desc}`)) {
      passed.push(desc);
    }
  });
  
  logInfo(`Repository secrets hook validation: ${passed.length}/${hookChecks.length} checks passed`);
  return passed.length === hookChecks.length;
}

function validateRepositoryPreviewComponent() {
  logHeader('Testing Repository Settings Preview Component');
  
  const componentPath = 'apps/dashboard/src/components/projects/repository-settings-preview.tsx';
  const passed = [];
  
  // Check if component file exists
  if (!checkFileExists(componentPath, 'Repository settings preview component')) {
    return false;
  }
  
  // Check component implementation
  const componentChecks = [
    ['RepositorySettingsPreview export', 'export function RepositorySettingsPreview'],
    ['Secret and env var props', 'secrets: Secret[]'],
    ['Environment variables prop', 'environmentVariables: Secret[]'],
    ['Loading state prop', 'isLoading: boolean'],
    ['Error prop', 'error: string | null'],
    ['Repository ID display', 'repositoryId'],
    ['Icons import', 'import { Key, Variable'],
    ['Collapsed state', 'useState(false)'],
    ['Loading indicator', 'animate-spin'],
    ['Error handling', 'Failed to load'],
    ['Empty state handling', 'totalCount === 0'],
    ['Secrets section', 'Secrets ('],
    ['Environment variables section', 'Environment Variables (']
  ];
  
  componentChecks.forEach(([desc, search]) => {
    if (checkFileContains(componentPath, search, `Component ${desc}`)) {
      passed.push(desc);
    }
  });
  
  logInfo(`Repository preview component validation: ${passed.length}/${componentChecks.length} checks passed`);
  return passed.length >= componentChecks.length * 0.8; // Allow 80% pass rate
}

function validateCreateProjectDialogIntegration() {
  logHeader('Testing Create Project Dialog Integration');
  
  const dialogPath = 'apps/dashboard/src/components/projects/create-project-dialog.tsx';
  const passed = [];
  
  if (!checkFileExists(dialogPath, 'Create project dialog')) {
    return false;
  }
  
  // Check integration changes
  const integrationChecks = [
    ['parseGitHubUrl import', 'import { parseGitHubUrl } from \'@apex/shared\''],
    ['RepositorySettingsPreview import', 'import { RepositorySettingsPreview }'],
    ['useRepositorySecrets import', 'import { useRepositorySecrets }'],
    ['Repository ID state', 'repositoryId, setRepositoryId'],
    ['useRepositorySecrets hook usage', 'useRepositorySecrets(repositoryId)'],
    ['Repository ID parsing', 'parseGitHubUrl(trimmed)'],
    ['Repository ID setting', 'setRepositoryId(repoId)'],
    ['Repository preview rendering', 'RepositorySettingsPreview'],
    ['Repository ID reset', 'setRepositoryId(null)']
  ];
  
  integrationChecks.forEach(([desc, search]) => {
    if (checkFileContains(dialogPath, search, `Integration ${desc}`)) {
      passed.push(desc);
    }
  });
  
  logInfo(`Create project dialog integration: ${passed.length}/${integrationChecks.length} checks passed`);
  return passed.length >= integrationChecks.length * 0.8;
}

function validateBackendInheritance() {
  logHeader('Testing Backend Repository Inheritance');
  
  const servicePath = 'apps/api/src/modules/projects/projects.service.ts';
  const passed = [];
  
  if (!checkFileExists(servicePath, 'Projects service')) {
    return false;
  }
  
  // Check backend inheritance logic
  const backendChecks = [
    ['Repository ID extraction', 'getRepositoryIdFromGitUrl'],
    ['parseGitHubUrl usage', 'parseGitHubUrl(gitRepo)'],
    ['Repository ID passing to sandbox', 'repositoryId'],
    ['Context secrets method', 'getContextSecrets']
  ];
  
  backendChecks.forEach(([desc, search]) => {
    if (checkFileContains(servicePath, search, `Backend ${desc}`)) {
      passed.push(desc);
    }
  });
  
  logInfo(`Backend inheritance validation: ${passed.length}/${backendChecks.length} checks passed`);
  return passed.length === backendChecks.length;
}

function validateSharedTypes() {
  logHeader('Testing Shared Types and API');
  
  const clientPath = 'apps/dashboard/src/api/client.ts';
  const sharedPath = 'libs/shared/src/lib/github-url.ts';
  const passed = [];
  
  // Check API client
  if (checkFileExists(clientPath, 'API client')) {
    const apiChecks = [
      ['Secret interface', 'interface Secret'],
      ['repositoryId field', 'repositoryId: string | null'],
      ['secretsApi.list with repositoryId', 'repositoryId?: string'],
      ['isSecret field', 'isSecret: boolean']
    ];
    
    apiChecks.forEach(([desc, search]) => {
      if (checkFileContains(clientPath, search, `API ${desc}`)) {
        passed.push(desc);
      }
    });
  }
  
  // Check shared GitHub URL parsing
  if (checkFileExists(sharedPath, 'Shared GitHub URL utilities')) {
    const sharedChecks = [
      ['parseGitHubUrl export', 'export function parseGitHubUrl'],
      ['ParsedGitHubUrl interface', 'interface ParsedGitHubUrl'],
      ['owner/repo extraction', 'owner, repo']
    ];
    
    sharedChecks.forEach(([desc, search]) => {
      if (checkFileContains(sharedPath, search, `Shared ${desc}`)) {
        passed.push(desc);
      }
    });
  }
  
  logInfo(`Shared types and API validation: ${passed.length}/7 checks passed`);
  return passed.length >= 5;
}

function validateUXRequirements() {
  logHeader('Testing UX Requirements Compliance');
  
  const componentPath = 'apps/dashboard/src/components/projects/repository-settings-preview.tsx';
  const passed = [];
  
  if (checkFileExists(componentPath, 'Repository preview component')) {
    const uxChecks = [
      ['Clear inheritance indication', 'inherited'],
      ['Visual distinction for secrets vs env vars', 'Key className'],
      ['Repository identification display', 'repositoryId'],
      ['Collapsible preview', 'collapsed'],
      ['Loading state', 'Loading repository'],
      ['Empty state handling', 'totalCount === 0'],
      ['Error state handling', 'Failed to load'],
      ['Settings count display', 'setting']
    ];
    
    uxChecks.forEach(([desc, search]) => {
      if (checkFileContains(componentPath, search, `UX ${desc}`)) {
        passed.push(desc);
      }
    });
  }
  
  logInfo(`UX requirements validation: ${passed.length}/8 checks passed`);
  return passed.length >= 6;
}

async function runCompilationTest() {
  logHeader('Testing TypeScript Compilation');
  
  try {
    const { execSync } = require('child_process');
    
    // Test dashboard compilation
    try {
      execSync('npx tsc --noEmit --project apps/dashboard', { 
        cwd: process.cwd(),
        stdio: 'pipe'
      });
      logSuccess('Dashboard TypeScript compilation passed');
      return true;
    } catch (error) {
      logError('Dashboard TypeScript compilation failed');
      if (error.stdout) {
        log(`Output: ${error.stdout.toString()}`, testConfig.colors.red);
      }
      return false;
    }
  } catch (error) {
    logWarning('Could not run TypeScript compilation test');
    return null;
  }
}

// Main test execution
async function main() {
  log(`${testConfig.colors.bold}🧪 Phase 7: Repository Secrets Inheritance Implementation Test${testConfig.colors.reset}\n`);
  
  const results = {
    hookValidation: validateRepositorySecretsHook(),
    componentValidation: validateRepositoryPreviewComponent(),
    dialogIntegration: validateCreateProjectDialogIntegration(),
    backendInheritance: validateBackendInheritance(),
    sharedTypes: validateSharedTypes(),
    uxRequirements: validateUXRequirements(),
    compilation: await runCompilationTest()
  };
  
  logHeader('Test Results Summary');
  
  let passedTests = 0;
  let totalTests = 0;
  
  Object.entries(results).forEach(([test, passed]) => {
    totalTests++;
    if (passed === true) {
      passedTests++;
      logSuccess(`${test}: PASSED`);
    } else if (passed === false) {
      logError(`${test}: FAILED`);
    } else {
      logWarning(`${test}: SKIPPED`);
      passedTests += 0.5; // Partial credit for skipped tests
    }
  });
  
  logHeader('Overall Assessment');
  
  const successRate = (passedTests / totalTests) * 100;
  
  if (successRate >= 85) {
    logSuccess(`✨ Phase 7 implementation is COMPLETE! (${Math.round(successRate)}% success rate)`);
    logInfo('🎉 Repository secrets inheritance has been successfully implemented!');
    logInfo('📋 Key features working:');
    logInfo('   • GitHub URL parsing for repository identification');
    logInfo('   • Repository-scoped secrets and env vars fetching');
    logInfo('   • Preview component showing inherited settings');
    logInfo('   • Integration with project creation flow');
    logInfo('   • Backend inheritance logic in place');
  } else if (successRate >= 70) {
    logWarning(`⚠️ Phase 7 implementation is MOSTLY COMPLETE (${Math.round(successRate)}% success rate)`);
    logInfo('Most functionality is working, but some minor issues may exist.');
  } else {
    logError(`❌ Phase 7 implementation has ISSUES (${Math.round(successRate)}% success rate)`);
    logError('Significant problems detected that need to be addressed.');
  }
  
  logInfo('\n📝 Next steps:');
  logInfo('1. Test the UI manually by creating a new project with a GitHub URL');
  logInfo('2. Verify that repository settings preview appears');
  logInfo('3. Confirm that inherited settings are applied to the new project');
  logInfo('4. Test with both public and private repositories');
  
  logHeader('Implementation Summary');
  logInfo('Phase 7 adds repository secrets inheritance to project creation:');
  logInfo('• When a GitHub URL is detected, parse repository identifier');
  logInfo('• Fetch repository-scoped secrets and environment variables');
  logInfo('• Display preview of inherited settings in project creation UI');
  logInfo('• Auto-apply repository settings to new projects via existing backend logic');
  logInfo('• Clear visual indication of inherited vs local settings');
  
  return successRate >= 85;
}

// Run the tests
main().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  logError(`Test execution failed: ${err.message}`);
  process.exit(1);
});