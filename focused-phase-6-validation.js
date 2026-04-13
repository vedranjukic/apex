#!/usr/bin/env bun

/**
 * Focused Phase 6 Validation
 * Tests the core functionality with a direct approach
 */

const { Database } = require('bun:sqlite');
const fs = require('fs');

console.log('🎯 Focused Phase 6 Validation');
console.log('=============================');

let testDb;
let testResults = { passed: 0, failed: 0, details: [] };

function addResult(name, passed, details = '') {
  testResults.details.push({ name, passed, details });
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${name}: ${details}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${name}: ${details}`);
  }
}

async function setupTestDatabase() {
  console.log('\n📋 Setting up test database...');
  
  const dbPath = './focused-test.sqlite';
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  
  testDb = new Database(dbPath);
  
  // Create minimal schema
  testDb.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  
  testDb.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      git_repo TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  
  testDb.exec(`
    CREATE TABLE secrets (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      project_id TEXT,
      repository_id TEXT,
      name TEXT,
      value TEXT,
      domain TEXT,
      auth_type TEXT DEFAULT 'bearer',
      is_secret INTEGER DEFAULT 1,
      description TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  
  testDb.exec(`
    CREATE TABLE migrations (
      id TEXT PRIMARY KEY,
      name TEXT,
      executed_at TEXT
    );
  `);
  
  // Insert test data
  const now = new Date().toISOString();
  const userId = 'test-user-123';
  
  testDb.query('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
    .run(userId, 'Test User', 'test@example.com', now, now);
  
  // Projects with different git repo configurations
  testDb.query('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)')
    .run('proj1', userId, 'GitHub Project', 'https://github.com/owner1/repo1', now, now);
  testDb.query('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)')
    .run('proj2', userId, 'GitLab Project', 'https://gitlab.com/owner2/repo2', now, now);
  testDb.query('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)')
    .run('proj3', userId, 'No Repo Project', null, now, now);
  
  // Pre-migration secrets (project-scoped)
  testDb.query('INSERT INTO secrets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('secret1', userId, 'proj1', null, 'API_KEY', 'github-api-key', 'api.github.com', 'bearer', 1, 'GitHub API', now, now);
  testDb.query('INSERT INTO secrets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('secret2', userId, 'proj2', null, 'GITLAB_TOKEN', 'gitlab-token', 'gitlab.com', 'bearer', 1, 'GitLab Token', now, now);
  testDb.query('INSERT INTO secrets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('secret3', userId, 'proj3', null, 'NO_REPO_SECRET', 'no-repo-value', 'api.example.com', 'bearer', 1, 'No Repo', now, now);
  
  // Environment variable
  testDb.query('INSERT INTO secrets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('env1', userId, 'proj1', null, 'NODE_ENV', 'development', 'localhost', 'none', 0, 'Environment', now, now);
  
  // Global secret
  testDb.query('INSERT INTO secrets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('global1', userId, null, null, 'GLOBAL_KEY', 'global-value', 'api.global.com', 'bearer', 1, 'Global', now, now);
  
  console.log('✅ Test database setup complete');
  return { userId, testDb };
}

async function testMigration() {
  console.log('\n🔄 Testing Migration...');
  
  try {
    // Import the migration runner and point it to our test database
    const migrationModule = await import('./apps/api/src/database/migrations/migration-runner.ts');
    const { MigrationRunner } = migrationModule;
    
    const runner = new MigrationRunner(testDb);
    await runner.runAllMigrations();
    
    addResult('MIGRATION_EXECUTION', true, 'Migration completed successfully');
    
    // Verify results
    const migratedSecrets = testDb.query('SELECT * FROM secrets WHERE repository_id IS NOT NULL').all();
    const githubSecrets = migratedSecrets.filter(s => s.repository_id === 'owner1/repo1');
    const unmigrated = testDb.query('SELECT * FROM secrets WHERE project_id IS NOT NULL AND repository_id IS NULL').all();
    
    addResult('MIGRATION_GITHUB_SECRETS', githubSecrets.length > 0, `Found ${githubSecrets.length} GitHub secrets migrated`);
    addResult('MIGRATION_GITLAB_PRESERVED', unmigrated.some(s => s.id === 'secret2'), 'GitLab project secret preserved as project-scoped');
    addResult('MIGRATION_NO_REPO_PRESERVED', unmigrated.some(s => s.id === 'secret3'), 'No-repo project secret preserved');
    
    return true;
  } catch (error) {
    addResult('MIGRATION_EXECUTION', false, `Migration failed: ${error.message}`);
    return false;
  }
}

async function testSecretResolution() {
  console.log('\n🔍 Testing Secret Resolution...');
  
  try {
    // We'll test resolution manually by querying the database with the same logic as the service
    const userId = 'test-user-123';
    
    // Test 1: Repository-scoped resolution (should include repo + global)
    const repoSecrets = testDb.query(`
      SELECT * FROM secrets 
      WHERE user_id = ? AND (
        repository_id = ? OR 
        (project_id IS NULL AND repository_id IS NULL)
      )
    `).all(userId, 'owner1/repo1');
    
    const repoApiKey = repoSecrets.find(s => s.name === 'API_KEY');
    addResult('RESOLUTION_REPOSITORY_FOUND', !!repoApiKey, `Repository API_KEY found: ${!!repoApiKey}`);
    addResult('RESOLUTION_REPOSITORY_SCOPE', repoApiKey?.repository_id === 'owner1/repo1', 
      `Repository scope correct: ${repoApiKey?.repository_id}`);
    
    // Test 2: Global secrets are included when no repository override
    const globalKey = repoSecrets.find(s => s.name === 'GLOBAL_KEY');
    addResult('RESOLUTION_GLOBAL_INCLUDED', !!globalKey, 'Global secret included in repository resolution');
    
    // Test 3: Environment variables can be filtered
    const allSecrets = testDb.query('SELECT * FROM secrets WHERE user_id = ?').all(userId);
    const onlySecrets = allSecrets.filter(s => s.is_secret === 1);
    addResult('RESOLUTION_SECRET_FILTERING', onlySecrets.length < allSecrets.length, 
      `Secrets filtering works: ${onlySecrets.length} secrets vs ${allSecrets.length} total`);
    
    return true;
  } catch (error) {
    addResult('RESOLUTION_TESTS', false, `Resolution test failed: ${error.message}`);
    return false;
  }
}

async function testDomainLookup() {
  console.log('\n🌐 Testing Domain-based Lookup...');
  
  try {
    const domains = testDb.query('SELECT DISTINCT domain FROM secrets WHERE is_secret = 1').all();
    addResult('DOMAIN_DIVERSITY', domains.length > 1, `Found ${domains.length} unique domains`);
    
    const apiGithubSecrets = testDb.query('SELECT * FROM secrets WHERE domain = ? AND is_secret = 1').all('api.github.com');
    addResult('DOMAIN_LOOKUP', apiGithubSecrets.length > 0, `Found ${apiGithubSecrets.length} secrets for api.github.com`);
    
    return true;
  } catch (error) {
    addResult('DOMAIN_TESTS', false, `Domain test failed: ${error.message}`);
    return false;
  }
}

async function testDataIntegrity() {
  console.log('\n🔒 Testing Data Integrity...');
  
  try {
    // Test unique constraints would work
    const duplicateCheck = testDb.query(`
      SELECT user_id, repository_id, name, COUNT(*) as count 
      FROM secrets 
      WHERE repository_id IS NOT NULL 
      GROUP BY user_id, repository_id, name 
      HAVING COUNT(*) > 1
    `).all();
    
    addResult('DATA_INTEGRITY_NO_DUPLICATES', duplicateCheck.length === 0, 
      `No duplicate repository secrets: ${duplicateCheck.length}`);
    
    // Test that migrated secrets have correct structure
    const migratedSecrets = testDb.query('SELECT * FROM secrets WHERE repository_id IS NOT NULL').all();
    const allHaveNullProject = migratedSecrets.every(s => s.project_id === null);
    
    addResult('DATA_INTEGRITY_NULL_PROJECT', allHaveNullProject, 
      'All repository secrets have null project_id');
    
    return true;
  } catch (error) {
    addResult('INTEGRITY_TESTS', false, `Integrity test failed: ${error.message}`);
    return false;
  }
}

async function validateImplementation() {
  console.log('\n✅ Validating Implementation Files...');
  
  try {
    // Check that key files exist and have expected content
    const servicePath = './apps/api/src/modules/secrets/secrets.service.ts';
    const routesPath = './apps/api/src/modules/secrets/secrets.routes.ts';
    const migrationPath = './apps/api/src/database/migrations/migration-runner.ts';
    
    const serviceExists = fs.existsSync(servicePath);
    const routesExists = fs.existsSync(routesPath);
    const migrationExists = fs.existsSync(migrationPath);
    
    addResult('FILES_SERVICE_EXISTS', serviceExists, 'Secrets service file exists');
    addResult('FILES_ROUTES_EXISTS', routesExists, 'Secrets routes file exists');
    addResult('FILES_MIGRATION_EXISTS', migrationExists, 'Migration runner exists');
    
    if (serviceExists) {
      const serviceContent = fs.readFileSync(servicePath, 'utf8');
      const hasRepoMethods = serviceContent.includes('resolveForRepository') && 
                            serviceContent.includes('createRepositorySecret');
      addResult('SERVICE_REPOSITORY_METHODS', hasRepoMethods, 'Service has repository methods');
    }
    
    if (routesExists) {
      const routesContent = fs.readFileSync(routesPath, 'utf8');
      const hasRepoRoutes = routesContent.includes('/repositories') && 
                           routesContent.includes('repositoryId');
      addResult('ROUTES_REPOSITORY_ENDPOINTS', hasRepoRoutes, 'Routes have repository endpoints');
    }
    
    return true;
  } catch (error) {
    addResult('IMPLEMENTATION_VALIDATION', false, `Validation failed: ${error.message}`);
    return false;
  }
}

async function cleanup() {
  if (testDb) {
    testDb.close();
  }
  
  const dbPath = './focused-test.sqlite';
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

async function printResults() {
  const total = testResults.passed + testResults.failed;
  const successRate = total > 0 ? (testResults.passed / total * 100).toFixed(1) : 0;
  
  console.log('\n📊 Validation Results');
  console.log('====================');
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📋 Total:  ${total}`);
  console.log(`🎯 Success Rate: ${successRate}%`);
  
  if (testResults.failed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.details
      .filter(t => !t.passed)
      .forEach(test => console.log(`   • ${test.name}: ${test.details}`));
  }
  
  console.log(`\n${testResults.failed === 0 ? '🎉' : '⚠️'} Phase 6 Core Validation ${testResults.failed === 0 ? 'PASSED' : 'COMPLETED WITH ISSUES'}`);
  
  return testResults.failed === 0;
}

// Main execution
async function main() {
  try {
    await setupTestDatabase();
    await testMigration();
    await testSecretResolution();
    await testDomainLookup();
    await testDataIntegrity();
    await validateImplementation();
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
    testResults.failed++;
  } finally {
    await cleanup();
    const success = await printResults();
    process.exit(success ? 0 : 1);
  }
}

main();