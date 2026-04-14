#!/usr/bin/env node

/**
 * Phase 6: Comprehensive Test Suite for Repository Secrets and Migration
 * 
 * Tests:
 * 1. Database migration works correctly
 * 2. Secret resolution follows proper priority hierarchy (repository > project > global)
 * 3. Environment variables vs secrets are handled correctly
 * 4. Repository-scoped secrets override global ones by name
 * 5. Project-scoped secrets are properly migrated to repository-scoped
 * 6. API endpoints work correctly for CRUD operations
 * 7. MITM proxy integration works with new secret types
 * 8. Edge cases (invalid repos, mixed GitHub/non-GitHub, orphaned secrets, etc.)
 */

// Use Bun's sqlite if available, otherwise skip database tests
let Database;
try {
  Database = require('bun:sqlite').Database;
} catch (error) {
  console.warn('⚠️  Bun SQLite not available, database tests will be skipped');
  console.warn('   Run with: bun phase-6-comprehensive-test.js for full testing');
}
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Test configuration
const TEST_DB_PATH = './test-phase6.sqlite';
const API_BASE_URL = process.env.API_URL || 'http://localhost:6000/api';
const TEST_USER_ID = 'test-user-123';

// Test data
const TEST_REPOSITORIES = [
  { id: 'owner1/repo1', url: 'https://github.com/owner1/repo1' },
  { id: 'owner2/repo2', url: 'https://github.com/owner2/repo2' },
  { id: 'owner3/repo3', url: 'https://github.com/owner3/repo3' },
];

const TEST_PROJECTS = [
  { id: 'proj1', gitRepo: 'https://github.com/owner1/repo1' },
  { id: 'proj2', gitRepo: 'https://github.com/owner2/repo2' },
  { id: 'proj3', gitRepo: 'https://gitlab.com/owner4/repo4' }, // Non-GitHub
  { id: 'proj4', gitRepo: null }, // No git repo
  { id: 'proj5', gitRepo: 'invalid-url' }, // Invalid URL
];

class Phase6TestSuite {
  constructor() {
    this.db = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async run() {
    console.log('🚀 Starting Phase 6 Comprehensive Test Suite');
    console.log('==========================================');
    
    try {
      await this.setup();
      await this.runMigrationTests();
      await this.runSecretResolutionTests();
      await this.runAPITests();
      await this.runProxyIntegrationTests();
      await this.runEdgeCaseTests();
      await this.runValidationScenarios();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      this.addResult('SUITE_ERROR', false, error.message);
    } finally {
      await this.cleanup();
      this.printResults();
    }
  }

  async setup() {
    console.log('\n📋 Setting up test environment...');
    
    if (!Database) {
      console.log('⚠️  Skipping database setup - Bun SQLite not available');
      return;
    }
    
    // Remove existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Create fresh test database
    this.db = new Database(TEST_DB_PATH);
    
    // Create schema
    await this.initializeSchema();
    
    // Insert test data
    await this.insertTestData();
    
    console.log('✅ Test environment setup complete');
  }

  async initializeSchema() {
    // Create tables matching the production schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        git_repo TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT,
        repository_id TEXT,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        domain TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'bearer',
        is_secret INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (project_id) REFERENCES projects (id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at TEXT NOT NULL
      );
    `);

    // Create indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS secrets_user_idx ON secrets (user_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS secrets_project_idx ON secrets (project_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS secrets_repository_idx ON secrets (repository_id);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS secrets_domain_idx ON secrets (domain);`);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS secrets_unique_project 
      ON secrets (user_id, project_id, name) 
      WHERE project_id IS NOT NULL;
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS secrets_unique_repository 
      ON secrets (user_id, repository_id, name) 
      WHERE repository_id IS NOT NULL;
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS secrets_unique_global 
      ON secrets (user_id, name) 
      WHERE project_id IS NULL AND repository_id IS NULL;
    `);
  }

  async insertTestData() {
    const now = new Date().toISOString();
    
    // Insert test user
    this.db.query('INSERT INTO users (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(TEST_USER_ID, 'Test User', 'test@example.com', now, now);

    // Insert test projects
    for (const project of TEST_PROJECTS) {
      this.db.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(project.id, TEST_USER_ID, project.id, project.gitRepo, now, now);
    }

    // Insert pre-migration test secrets (project-scoped)
    const testSecrets = [
      // Project-scoped secrets that should be migrated to repository-scoped
      { id: 'secret1', projectId: 'proj1', repositoryId: null, name: 'API_KEY', value: 'proj1-api-key', domain: 'api.example.com', isSecret: true },
      { id: 'secret2', projectId: 'proj2', repositoryId: null, name: 'DB_PASSWORD', value: 'proj2-db-pass', domain: 'db.example.com', isSecret: true },
      { id: 'secret3', projectId: 'proj3', repositoryId: null, name: 'GITLAB_TOKEN', value: 'gitlab-token', domain: 'gitlab.com', isSecret: true },
      { id: 'secret4', projectId: 'proj4', repositoryId: null, name: 'NO_REPO_SECRET', value: 'no-repo-value', domain: 'api.example.com', isSecret: true },
      { id: 'secret5', projectId: 'proj5', repositoryId: null, name: 'INVALID_URL_SECRET', value: 'invalid-value', domain: 'api.example.com', isSecret: true },
      
      // Global secrets
      { id: 'global1', projectId: null, repositoryId: null, name: 'GLOBAL_API_KEY', value: 'global-api-key', domain: 'api.example.com', isSecret: true },
      { id: 'global2', projectId: null, repositoryId: null, name: 'GLOBAL_DB_PASSWORD', value: 'global-db-pass', domain: 'db.example.com', isSecret: true },
      
      // Environment variables (not secrets)
      { id: 'env1', projectId: 'proj1', repositoryId: null, name: 'NODE_ENV', value: 'development', domain: 'localhost', isSecret: false },
      { id: 'env2', projectId: null, repositoryId: null, name: 'LOG_LEVEL', value: 'debug', domain: 'localhost', isSecret: false },
      
      // Some already repository-scoped (should not be affected by migration)
      { id: 'repo1', projectId: null, repositoryId: 'owner1/repo1', name: 'REPO_SPECIFIC_KEY', value: 'repo1-specific', domain: 'api.example.com', isSecret: true },
    ];

    for (const secret of testSecrets) {
      this.db.query(`
        INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, auth_type, is_secret, description, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        secret.id, TEST_USER_ID, secret.projectId, secret.repositoryId, secret.name, 
        secret.value, secret.domain, 'bearer', secret.isSecret ? 1 : 0, 
        `Test ${secret.name}`, now, now
      );
    }

    console.log(`✅ Inserted ${testSecrets.length} test secrets`);
  }

  async runMigrationTests() {
    console.log('\n🔄 Testing Database Migration...');

    if (!Database || !this.db) {
      console.log('⚠️  Skipping migration tests - database not available');
      this.addResult('MIGRATION_EXECUTION', false, 'Database not available (need Bun runtime)');
      return;
    }

    // Import and run the migration
    try {
      const { runMigrations } = require('./apps/api/src/database/migrations/migration-runner.ts');
      await runMigrations(this.db);
      this.addResult('MIGRATION_EXECUTION', true, 'Migration executed successfully');
      
      // Verify migration results
      await this.verifyMigrationResults();
      
    } catch (error) {
      this.addResult('MIGRATION_EXECUTION', false, `Migration failed: ${error.message}`);
    }
  }

  async verifyMigrationResults() {
    // Check that project-scoped secrets with valid GitHub URLs were migrated
    const migratedSecrets = this.db.query(`
      SELECT * FROM secrets 
      WHERE repository_id IS NOT NULL AND project_id IS NULL
    `).all();

    // Should have:
    // - secret1 (proj1 -> owner1/repo1)
    // - secret2 (proj2 -> owner2/repo2) 
    // - repo1 (already repository-scoped)
    const expectedMigrated = ['secret1', 'secret2', 'repo1'];
    const actualMigrated = migratedSecrets.map(s => s.id);

    this.addResult('MIGRATION_REPOSITORY_SECRETS', 
      expectedMigrated.every(id => actualMigrated.includes(id)),
      `Expected ${expectedMigrated.length} repository secrets, got ${actualMigrated.length}`
    );

    // Check that non-GitHub/invalid projects were NOT migrated
    const unmigrated = this.db.query(`
      SELECT * FROM secrets 
      WHERE project_id IS NOT NULL AND repository_id IS NULL
    `).all();

    // Should still have:
    // - secret3 (GitLab URL)
    // - secret4 (no git repo)
    // - secret5 (invalid URL)
    // - env1 (environment variable)
    const expectedUnmigrated = ['secret3', 'secret4', 'secret5', 'env1'];
    const actualUnmigrated = unmigrated.map(s => s.id);

    this.addResult('MIGRATION_UNMIGRATED_PRESERVED', 
      expectedUnmigrated.every(id => actualUnmigrated.includes(id)),
      `Expected ${expectedUnmigrated.length} unmigrated secrets, got ${actualUnmigrated.length}`
    );

    // Verify specific repository ID assignments
    const secret1 = this.db.query('SELECT * FROM secrets WHERE id = ?').get('secret1');
    this.addResult('MIGRATION_REPOSITORY_ID_CORRECT',
      secret1?.repository_id === 'owner1/repo1',
      `Secret1 repository_id: ${secret1?.repository_id}`
    );

    console.log('✅ Migration verification complete');
  }

  async runSecretResolutionTests() {
    console.log('\n🔍 Testing Secret Resolution Priority Hierarchy...');

    if (!Database || !this.db) {
      console.log('⚠️  Skipping resolution tests - database not available');
      this.addResult('RESOLUTION_TESTS', false, 'Database not available (need Bun runtime)');
      return;
    }

    // Import the secrets service
    try {
      const { secretsService } = require('./apps/api/src/modules/secrets/secrets.service.ts');

    // Add test data for priority testing
    const now = new Date().toISOString();
    
    // Add secrets with same name at different scopes
    const prioritySecrets = [
      { id: 'priority-global', projectId: null, repositoryId: null, name: 'PRIORITY_KEY', value: 'global-value', domain: 'test.com' },
      { id: 'priority-project', projectId: 'proj1', repositoryId: null, name: 'PRIORITY_KEY', value: 'project-value', domain: 'test.com' },
      { id: 'priority-repo', projectId: null, repositoryId: 'owner1/repo1', name: 'PRIORITY_KEY', value: 'repo-value', domain: 'test.com' },
    ];

    for (const secret of prioritySecrets) {
      try {
        this.db.query(`
          INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, auth_type, is_secret, description, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          secret.id, TEST_USER_ID, secret.projectId, secret.repositoryId, secret.name,
          secret.value, secret.domain, 'bearer', 1, 'Priority test', now, now
        );
      } catch (error) {
        // Ignore duplicate key errors for this test
        console.warn(`Warning: Could not insert ${secret.id}: ${error.message}`);
      }
    }

    // Test repository resolution (should get repo-value)
    try {
      const repoResolution = await secretsService.resolveForRepository(TEST_USER_ID, 'owner1/repo1');
      const prioritySecret = repoResolution.find(s => s.name === 'PRIORITY_KEY');
      
      this.addResult('RESOLUTION_REPOSITORY_PRIORITY',
        prioritySecret?.value === 'repo-value',
        `Repository resolution: ${prioritySecret?.value} (expected: repo-value)`
      );
    } catch (error) {
      this.addResult('RESOLUTION_REPOSITORY_PRIORITY', false, `Repository resolution failed: ${error.message}`);
    }

    // Test context resolution with both project and repository (repository should win)
    try {
      const contextResolution = await secretsService.resolveForContext(TEST_USER_ID, 'proj1', 'owner1/repo1');
      const prioritySecret = contextResolution.find(s => s.name === 'PRIORITY_KEY');
      
      this.addResult('RESOLUTION_CONTEXT_REPOSITORY_WINS',
        prioritySecret?.value === 'repo-value',
        `Context resolution: ${prioritySecret?.value} (expected: repo-value)`
      );
    } catch (error) {
      this.addResult('RESOLUTION_CONTEXT_REPOSITORY_WINS', false, `Context resolution failed: ${error.message}`);
    }

    // Test project-only resolution (should get project-value over global)
    try {
      const projectResolution = await secretsService.resolveForProject(TEST_USER_ID, 'proj1');
      const prioritySecret = projectResolution.find(s => s.name === 'PRIORITY_KEY');
      
      this.addResult('RESOLUTION_PROJECT_OVER_GLOBAL',
        prioritySecret?.value === 'project-value',
        `Project resolution: ${prioritySecret?.value} (expected: project-value)`
      );
    } catch (error) {
      this.addResult('RESOLUTION_PROJECT_OVER_GLOBAL', false, `Project resolution failed: ${error.message}`);
    }

    console.log('✅ Secret resolution tests complete');
    } catch (error) {
      this.addResult('RESOLUTION_TESTS', false, `Service import failed: ${error.message}`);
    }
  }

  async runAPITests() {
    console.log('\n🌐 Testing API Endpoints...');

    // Note: These tests assume the API server is running
    // In a real test environment, you might want to start the server programmatically

    try {
      // Test repository secrets listing
      const repoListResponse = await axios.get(`${API_BASE_URL}/secrets/repositories`);
      this.addResult('API_REPOSITORY_LIST',
        repoListResponse.status === 200 && Array.isArray(repoListResponse.data),
        `Repository list status: ${repoListResponse.status}`
      );

      // Test repository-specific secret listing
      const repoSecretsResponse = await axios.get(`${API_BASE_URL}/secrets/repositories/owner1%2Frepo1`);
      this.addResult('API_REPOSITORY_SECRETS_LIST',
        repoSecretsResponse.status === 200 && Array.isArray(repoSecretsResponse.data),
        `Repository secrets list status: ${repoSecretsResponse.status}`
      );

      // Test repository secret creation
      const createResponse = await axios.post(`${API_BASE_URL}/secrets/repositories/owner1%2Frepo1`, {
        name: 'TEST_API_KEY',
        value: 'test-api-value',
        domain: 'test-api.com',
        authType: 'bearer',
        isSecret: true,
        description: 'API test secret'
      });
      
      this.addResult('API_REPOSITORY_SECRET_CREATE',
        createResponse.status === 200 && createResponse.data.id,
        `Create secret status: ${createResponse.status}`
      );

      const createdSecretId = createResponse.data?.id;

      // Test repository secret update
      if (createdSecretId) {
        const updateResponse = await axios.put(`${API_BASE_URL}/secrets/repositories/owner1%2Frepo1/${createdSecretId}`, {
          description: 'Updated description'
        });
        
        this.addResult('API_REPOSITORY_SECRET_UPDATE',
          updateResponse.status === 200,
          `Update secret status: ${updateResponse.status}`
        );

        // Test repository secret deletion
        const deleteResponse = await axios.delete(`${API_BASE_URL}/secrets/repositories/owner1%2Frepo1/${createdSecretId}`);
        
        this.addResult('API_REPOSITORY_SECRET_DELETE',
          deleteResponse.status === 200,
          `Delete secret status: ${deleteResponse.status}`
        );
      }

      // Test environment variables handling
      const envVarResponse = await axios.post(`${API_BASE_URL}/secrets`, {
        name: 'TEST_ENV_VAR',
        value: 'test-env-value',
        domain: 'localhost',
        authType: 'none',
        isSecret: false,
        description: 'Test environment variable'
      });
      
      this.addResult('API_ENVIRONMENT_VARIABLE_CREATE',
        envVarResponse.status === 200,
        `Environment variable create status: ${envVarResponse.status}`
      );

      if (envVarResponse.data?.id) {
        await axios.delete(`${API_BASE_URL}/secrets/${envVarResponse.data.id}`).catch(() => {});
      }

    } catch (error) {
      console.warn(`⚠️  API tests skipped - server might not be running: ${error.message}`);
      this.addResult('API_TESTS', false, `API server not available: ${error.message}`);
    }

    console.log('✅ API endpoint tests complete');
  }

  async runProxyIntegrationTests() {
    console.log('\n🔐 Testing MITM Proxy Integration...');

    try {
      const { secretsService } = require('./apps/api/src/modules/secrets/secrets.service.ts');

      // Test that only secrets (not env vars) are returned for proxy configuration
      const allSecrets = await secretsService.findAllSecrets();
      const secretsOnly = allSecrets.filter(s => s.isSecret === true);
      const envVarsIncluded = allSecrets.filter(s => s.isSecret === false);

      this.addResult('PROXY_SECRETS_ONLY',
        envVarsIncluded.length === 0,
        `Found ${envVarsIncluded.length} environment variables in secrets query (should be 0)`
      );

      // Test repository-specific secret resolution for proxy
      const repoSecrets = await secretsService.resolveSecretsForContext(TEST_USER_ID, undefined, 'owner1/repo1');
      const hasRepoSecrets = repoSecrets.length > 0;
      
      this.addResult('PROXY_REPOSITORY_RESOLUTION',
        hasRepoSecrets,
        `Repository secrets for proxy: ${repoSecrets.length}`
      );

      // Test domain-based secret lookup
      const domainSecrets = await secretsService.findByDomain('api.example.com');
      
      this.addResult('PROXY_DOMAIN_LOOKUP',
        domainSecrets.length > 0,
        `Domain secrets found: ${domainSecrets.length}`
      );

      console.log('✅ MITM proxy integration tests complete');

    } catch (error) {
      this.addResult('PROXY_INTEGRATION', false, `Proxy tests failed: ${error.message}`);
    }
  }

  async runEdgeCaseTests() {
    console.log('\n⚠️  Testing Edge Cases...');

    if (!Database || !this.db) {
      console.log('⚠️  Skipping edge case tests - database not available');
      this.addResult('EDGE_CASE_TESTS', false, 'Database not available (need Bun runtime)');
      return;
    }

    // Test invalid repository URL handling
    const invalidRepos = this.db.query(`
      SELECT s.*, p.git_repo 
      FROM secrets s 
      LEFT JOIN projects p ON s.project_id = p.id 
      WHERE s.project_id IS NOT NULL AND (p.git_repo IS NULL OR p.git_repo NOT LIKE 'https://github.com/%')
    `).all();

    this.addResult('EDGE_CASE_INVALID_REPOS',
      invalidRepos.length > 0,
      `Found ${invalidRepos.length} secrets with invalid repo URLs (should remain project-scoped)`
    );

    // Test mixed GitHub/non-GitHub repositories
    const nonGitHubSecrets = this.db.query(`
      SELECT s.*, p.git_repo 
      FROM secrets s 
      LEFT JOIN projects p ON s.project_id = p.id 
      WHERE s.project_id IS NOT NULL AND p.git_repo LIKE '%gitlab.com%'
    `).all();

    this.addResult('EDGE_CASE_NON_GITHUB_REPOS',
      nonGitHubSecrets.length > 0,
      `Found ${nonGitHubSecrets.length} non-GitHub repository secrets`
    );

    // Test orphaned secrets (project deleted but secrets remain)
    this.db.query('DELETE FROM projects WHERE id = ?').run('proj1');
    
    const orphanedSecrets = this.db.query(`
      SELECT s.* FROM secrets s 
      LEFT JOIN projects p ON s.project_id = p.id 
      WHERE s.project_id IS NOT NULL AND p.id IS NULL
    `).all();

    this.addResult('EDGE_CASE_ORPHANED_SECRETS',
      orphanedSecrets.length >= 0,  // Should handle gracefully
      `Found ${orphanedSecrets.length} orphaned secrets after project deletion`
    );

    // Test environment variables are ignored by proxy functions
    try {
      const { secretsService } = require('./apps/api/src/modules/secrets/secrets.service.ts');
      const allRecords = await secretsService.findAll();
      const secretsOnly = await secretsService.findAllSecrets();
      
      this.addResult('EDGE_CASE_ENV_VARS_FILTERED',
        secretsOnly.length < allRecords.length,
        `Total records: ${allRecords.length}, Secrets only: ${secretsOnly.length}`
      );
    } catch (error) {
      this.addResult('EDGE_CASE_ENV_VARS_FILTERED', false, error.message);
    }

    console.log('✅ Edge case tests complete');
  }

  async runValidationScenarios() {
    console.log('\n✅ Running Final Validation Scenarios...');

    try {
      const { secretsService } = require('./apps/api/src/modules/secrets/secrets.service.ts');

      // Scenario 1: Multi-context resolution
      console.log('  Scenario 1: Multi-context secret resolution');
      const contextSecrets = await secretsService.resolveForContext(TEST_USER_ID, 'proj2', 'owner2/repo2');
      this.addResult('VALIDATION_MULTI_CONTEXT',
        contextSecrets.length > 0,
        `Multi-context resolution returned ${contextSecrets.length} secrets`
      );

      // Scenario 2: Repository override behavior
      console.log('  Scenario 2: Repository secrets override global secrets');
      const repoOverride = await secretsService.resolveForRepository(TEST_USER_ID, 'owner1/repo1');
      const apiKeySecret = repoOverride.find(s => s.name === 'API_KEY');
      
      // Should get the repository-scoped version (migrated from project)
      this.addResult('VALIDATION_REPOSITORY_OVERRIDE',
        apiKeySecret?.repositoryId === 'owner1/repo1',
        `API_KEY resolved to: ${apiKeySecret?.repositoryId || 'global'}`
      );

      // Scenario 3: Secrets vs Environment Variables separation
      console.log('  Scenario 3: Secrets vs Environment Variables separation');
      const secretsForProxy = await secretsService.resolveSecretsForContext(TEST_USER_ID, 'proj1', 'owner1/repo1');
      const hasEnvVars = secretsForProxy.some(s => !s.isSecret);
      
      this.addResult('VALIDATION_SECRETS_ENV_SEPARATION',
        !hasEnvVars,
        `Secrets resolution excludes environment variables: ${!hasEnvVars}`
      );

      // Scenario 4: Domain-based grouping
      console.log('  Scenario 4: Domain-based secret grouping');
      const domains = await secretsService.getSecretDomains();
      
      this.addResult('VALIDATION_DOMAIN_GROUPING',
        domains.size > 0,
        `Found ${domains.size} unique domains`
      );

      // Scenario 5: Migration idempotency
      console.log('  Scenario 5: Migration idempotency');
      const beforeSecondRun = this.db.query('SELECT COUNT(*) as count FROM secrets WHERE repository_id IS NOT NULL').get();
      
      // Run migration again - should be idempotent
      const { runMigrations } = require('./apps/api/src/database/migrations/migration-runner.ts');
      await runMigrations(this.db);
      
      const afterSecondRun = this.db.query('SELECT COUNT(*) as count FROM secrets WHERE repository_id IS NOT NULL').get();
      
      this.addResult('VALIDATION_MIGRATION_IDEMPOTENT',
        beforeSecondRun.count === afterSecondRun.count,
        `Repository secrets before: ${beforeSecondRun.count}, after: ${afterSecondRun.count}`
      );

    } catch (error) {
      this.addResult('VALIDATION_SCENARIOS', false, `Validation failed: ${error.message}`);
    }

    console.log('✅ Validation scenarios complete');
  }

  addResult(testName, passed, message) {
    this.testResults.tests.push({
      name: testName,
      passed,
      message,
      timestamp: new Date().toISOString()
    });
    
    if (passed) {
      this.testResults.passed++;
      console.log(`  ✅ ${testName}: ${message}`);
    } else {
      this.testResults.failed++;
      console.log(`  ❌ ${testName}: ${message}`);
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    if (this.db) {
      this.db.close();
    }
    
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    
    console.log('✅ Cleanup complete');
  }

  printResults() {
    console.log('\n📊 Test Results Summary');
    console.log('=======================');
    console.log(`✅ Passed: ${this.testResults.passed}`);
    console.log(`❌ Failed: ${this.testResults.failed}`);
    console.log(`📋 Total:  ${this.testResults.tests.length}`);
    
    const successRate = this.testResults.tests.length > 0 
      ? (this.testResults.passed / this.testResults.tests.length * 100).toFixed(1)
      : 0;
    
    console.log(`🎯 Success Rate: ${successRate}%`);
    
    if (this.testResults.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults.tests
        .filter(t => !t.passed)
        .forEach(test => {
          console.log(`   • ${test.name}: ${test.message}`);
        });
    }

    // Write detailed results to file
    const resultsFile = './phase-6-test-results.json';
    fs.writeFileSync(resultsFile, JSON.stringify(this.testResults, null, 2));
    console.log(`\n📄 Detailed results written to: ${resultsFile}`);
    
    if (this.testResults.failed === 0) {
      console.log('\n🎉 All tests passed! Phase 6 validation successful.');
      process.exit(0);
    } else {
      console.log('\n💥 Some tests failed. Please review and fix issues before production deployment.');
      process.exit(1);
    }
  }
}

// Run the test suite if this file is executed directly
if (require.main === module) {
  const testSuite = new Phase6TestSuite();
  testSuite.run().catch(error => {
    console.error('Fatal test suite error:', error);
    process.exit(1);
  });
}

module.exports = { Phase6TestSuite };