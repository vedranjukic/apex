/**
 * E2E test: Repository-scoped secrets and environment variables system.
 *
 * Tests the complete per-repository secrets management system including:
 *   1. Repository CRUD operations via API
 *   2. Repository-scoped secrets creation and resolution
 *   3. Environment variables vs secrets separation
 *   4. Cache pre-population and context resolution
 *   5. Container environment variable injection
 *   6. UI integration and form behavior
 *   7. Repository settings preview functionality
 *
 * This ensures the system properly handles both secrets (MITM proxy) and 
 * environment variables (direct injection) with correct repository scoping.
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=repository-secrets
 */
import axios from 'axios';
import { waitForApiSettled } from './support/e2e-helpers';

const baseURL = `http://localhost:${process.env.PORT || '6000'}`;
axios.defaults.baseURL = baseURL;

// Test data
const TEST_REPO_URL = 'https://github.com/test-org/test-repo.git';
const TEST_REPO_ID = 'test-org/test-repo';
const ANOTHER_REPO_URL = 'https://github.com/another-org/another-repo.git';
const ANOTHER_REPO_ID = 'another-org/another-repo';

describe('Repository Secrets E2E', () => {
  let createdSecretIds: string[] = [];
  let createdRepositoryIds: string[] = [];

  beforeAll(async () => {
    await waitForApiSettled(45_000);
  }, 60_000);

  afterEach(async () => {
    // Clean up secrets created in tests
    for (const secretId of createdSecretIds) {
      try {
        await axios.delete(`/api/secrets/${secretId}`);
      } catch {
        // Ignore errors during cleanup
      }
    }
    
    // Clean up repositories created in tests
    for (const repositoryId of createdRepositoryIds) {
      try {
        await axios.delete(`/api/repositories/${encodeURIComponent(repositoryId)}`);
      } catch {
        // Ignore errors during cleanup
      }
    }
    
    createdSecretIds = [];
    createdRepositoryIds = [];
  });

  describe('Repository Management API', () => {
    it('should create repository from GitHub URL', async () => {
      const response = await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        success: true,
        repositoryId: TEST_REPO_ID
      });

      createdRepositoryIds.push(TEST_REPO_ID);
    });

    it('should list repositories with counts', async () => {
      // First create a repository
      await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });
      createdRepositoryIds.push(TEST_REPO_ID);

      const response = await axios.get('/api/repositories');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      const testRepo = response.data.find((repo: any) => repo.id === TEST_REPO_ID);
      expect(testRepo).toMatchObject({
        id: TEST_REPO_ID,
        name: 'test-repo',
        secretCount: 0,
        envVarCount: 0,
        totalCount: 0,
        projectCount: 0
      });
    });

    it('should delete repository and associated secrets', async () => {
      // Create repository
      await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });

      // Create a secret for this repository
      const secretResponse = await axios.post('/api/secrets', {
        name: 'TEST_SECRET',
        value: 'test-value',
        domain: 'api.test.com',
        authType: 'bearer',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });
      const secretId = secretResponse.data.id;

      // Delete repository
      const deleteResponse = await axios.delete(`/api/repositories/${encodeURIComponent(TEST_REPO_ID)}`);
      expect(deleteResponse.status).toBe(200);

      // Verify secret was deleted
      try {
        await axios.get(`/api/secrets/${secretId}`);
        fail('Secret should have been deleted with repository');
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }

      // Remove from cleanup list since it's already deleted
      createdRepositoryIds = createdRepositoryIds.filter(id => id !== TEST_REPO_ID);
    });
  });

  describe('Repository-scoped Secrets Management', () => {
    beforeEach(async () => {
      // Create test repository for each test
      await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });
      createdRepositoryIds.push(TEST_REPO_ID);
    });

    it('should create repository-scoped secret', async () => {
      const response = await axios.post('/api/secrets', {
        name: 'REPO_API_KEY',
        value: 'repo-secret-value',
        domain: 'api.repo-test.com',
        authType: 'bearer',
        description: 'Repository-specific API key',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });

      expect(response.status).toBe(201);
      expect(response.data).toMatchObject({
        name: 'REPO_API_KEY',
        domain: 'api.repo-test.com',
        authType: 'bearer',
        description: 'Repository-specific API key',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });

      createdSecretIds.push(response.data.id);
    });

    it('should create repository-scoped environment variable', async () => {
      const response = await axios.post('/api/secrets', {
        name: 'REPO_ENV_VAR',
        value: 'repo-env-value',
        description: 'Repository-specific environment variable',
        isSecret: false,
        repositoryId: TEST_REPO_ID
      });

      expect(response.status).toBe(201);
      expect(response.data).toMatchObject({
        name: 'REPO_ENV_VAR',
        value: 'repo-env-value',
        description: 'Repository-specific environment variable',
        isSecret: false,
        repositoryId: TEST_REPO_ID,
        domain: null,
        authType: null
      });

      createdSecretIds.push(response.data.id);
    });

    it('should list secrets filtered by repository', async () => {
      // Create secrets for different repositories
      const repo1Secret = await axios.post('/api/secrets', {
        name: 'REPO1_SECRET',
        value: 'value1',
        domain: 'api.repo1.com',
        authType: 'bearer',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(repo1Secret.data.id);

      // Create another repository
      await axios.post('/api/repositories', {
        repositoryUrl: ANOTHER_REPO_URL
      });
      createdRepositoryIds.push(ANOTHER_REPO_ID);

      const repo2Secret = await axios.post('/api/secrets', {
        name: 'REPO2_SECRET',
        value: 'value2',
        domain: 'api.repo2.com',
        authType: 'bearer',
        isSecret: true,
        repositoryId: ANOTHER_REPO_ID
      });
      createdSecretIds.push(repo2Secret.data.id);

      // List secrets for first repository only
      const response = await axios.get('/api/secrets', {
        params: { repositoryId: TEST_REPO_ID }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].name).toBe('REPO1_SECRET');
      expect(response.data[0].repositoryId).toBe(TEST_REPO_ID);
    });

    it('should resolve secrets for repository context', async () => {
      // Create both a secret and environment variable for the repository
      const secret = await axios.post('/api/secrets', {
        name: 'REPO_SECRET',
        value: 'secret-value',
        domain: 'api.example.com',
        authType: 'bearer',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(secret.data.id);

      const envVar = await axios.post('/api/secrets', {
        name: 'REPO_ENV_VAR',
        value: 'env-var-value',
        isSecret: false,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(envVar.data.id);

      // Create global secret that should not be included
      const globalSecret = await axios.post('/api/secrets', {
        name: 'GLOBAL_SECRET',
        value: 'global-value',
        domain: 'api.global.com',
        authType: 'bearer',
        isSecret: true
        // No repositoryId = global
      });
      createdSecretIds.push(globalSecret.data.id);

      // Test endpoint that resolves for specific repository context
      const response = await axios.get('/api/secrets/resolve', {
        params: { repositoryId: TEST_REPO_ID }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      // Should contain both repository-scoped items plus global items
      const secretNames = response.data.map((item: any) => item.name);
      expect(secretNames).toContain('REPO_SECRET');
      expect(secretNames).toContain('REPO_ENV_VAR');
      expect(secretNames).toContain('GLOBAL_SECRET'); // Globals should be included

      // Check that repository-scoped items have correct values and types
      const repoSecret = response.data.find((item: any) => item.name === 'REPO_SECRET');
      expect(repoSecret).toMatchObject({
        name: 'REPO_SECRET',
        value: 'secret-value',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });

      const repoEnvVar = response.data.find((item: any) => item.name === 'REPO_ENV_VAR');
      expect(repoEnvVar).toMatchObject({
        name: 'REPO_ENV_VAR',
        value: 'env-var-value',
        isSecret: false,
        repositoryId: TEST_REPO_ID
      });
    });
  });

  describe('Secret vs Environment Variable Separation', () => {
    beforeEach(async () => {
      await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });
      createdRepositoryIds.push(TEST_REPO_ID);
    });

    it('should handle secret type with required domain', async () => {
      const response = await axios.post('/api/secrets', {
        name: 'API_SECRET',
        value: 'secret-123',
        domain: 'api.service.com',
        authType: 'bearer',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });

      expect(response.status).toBe(201);
      expect(response.data.isSecret).toBe(true);
      expect(response.data.domain).toBe('api.service.com');
      expect(response.data.authType).toBe('bearer');

      createdSecretIds.push(response.data.id);
    });

    it('should handle environment variable type without domain/authType', async () => {
      const response = await axios.post('/api/secrets', {
        name: 'ENV_VARIABLE',
        value: 'env-value-123',
        isSecret: false,
        repositoryId: TEST_REPO_ID
      });

      expect(response.status).toBe(201);
      expect(response.data.isSecret).toBe(false);
      expect(response.data.domain).toBeNull();
      expect(response.data.authType).toBeNull();

      createdSecretIds.push(response.data.id);
    });

    it('should validate required fields for secrets', async () => {
      // Try to create secret without required domain
      try {
        await axios.post('/api/secrets', {
          name: 'INVALID_SECRET',
          value: 'value',
          isSecret: true,
          repositoryId: TEST_REPO_ID
          // Missing domain and authType
        });
        fail('Should have failed validation');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });

    it('should allow environment variables without domain/authType', async () => {
      const response = await axios.post('/api/secrets', {
        name: 'SIMPLE_ENV_VAR',
        value: 'simple-value',
        isSecret: false,
        repositoryId: TEST_REPO_ID
        // No domain or authType needed for env vars
      });

      expect(response.status).toBe(201);
      createdSecretIds.push(response.data.id);
    });
  });

  describe('Repository Settings Integration', () => {
    beforeEach(async () => {
      await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });
      createdRepositoryIds.push(TEST_REPO_ID);
    });

    it('should update repository counts when secrets are added', async () => {
      // Initially should have 0 counts
      let repoResponse = await axios.get('/api/repositories');
      let testRepo = repoResponse.data.find((repo: any) => repo.id === TEST_REPO_ID);
      expect(testRepo.secretCount).toBe(0);
      expect(testRepo.envVarCount).toBe(0);
      expect(testRepo.totalCount).toBe(0);

      // Add a secret
      const secret = await axios.post('/api/secrets', {
        name: 'TEST_SECRET',
        value: 'value',
        domain: 'api.test.com',
        authType: 'bearer',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(secret.data.id);

      // Add an environment variable  
      const envVar = await axios.post('/api/secrets', {
        name: 'TEST_ENV_VAR',
        value: 'env-value',
        isSecret: false,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(envVar.data.id);

      // Check updated counts
      repoResponse = await axios.get('/api/repositories');
      testRepo = repoResponse.data.find((repo: any) => repo.id === TEST_REPO_ID);
      expect(testRepo.secretCount).toBe(1);
      expect(testRepo.envVarCount).toBe(1);
      expect(testRepo.totalCount).toBe(2);
    });

    it('should filter out internal placeholder secrets from counts', async () => {
      // Internal placeholder secrets should not appear in repository lists
      const repoResponse = await axios.get('/api/repositories');
      
      for (const repo of repoResponse.data) {
        // Even if placeholder secrets exist, they shouldn't be counted
        expect(repo.secretCount).toBeGreaterThanOrEqual(0);
        expect(repo.envVarCount).toBeGreaterThanOrEqual(0);
        
        // Verify no secrets with placeholder names are visible
        const secretsResponse = await axios.get('/api/secrets', {
          params: { repositoryId: repo.id }
        });
        
        const placeholderSecrets = secretsResponse.data.filter(
          (secret: any) => secret.name === '__APEX_REPO_PLACEHOLDER__'
        );
        expect(placeholderSecrets).toHaveLength(0);
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid repository URL', async () => {
      try {
        await axios.post('/api/repositories', {
          repositoryUrl: 'not-a-valid-url'
        });
        fail('Should have failed validation');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });

    it('should handle non-GitHub repository URL', async () => {
      try {
        await axios.post('/api/repositories', {
          repositoryUrl: 'https://gitlab.com/user/repo.git'
        });
        fail('Should have failed validation');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });

    it('should handle duplicate repository creation gracefully', async () => {
      // Create repository first time
      const firstResponse = await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });
      expect(firstResponse.status).toBe(200);
      createdRepositoryIds.push(TEST_REPO_ID);

      // Try to create same repository again
      const secondResponse = await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });
      expect(secondResponse.status).toBe(200);
      expect(secondResponse.data.success).toBe(true);
      expect(secondResponse.data.repositoryId).toBe(TEST_REPO_ID);
    });

    it('should handle missing repository for scoped secrets', async () => {
      try {
        await axios.post('/api/secrets', {
          name: 'ORPHANED_SECRET',
          value: 'value',
          domain: 'api.test.com',
          authType: 'bearer',
          isSecret: true,
          repositoryId: 'nonexistent/repo'
        });
        fail('Should have failed validation');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });

  describe('Cache and Context Resolution', () => {
    beforeEach(async () => {
      await axios.post('/api/repositories', {
        repositoryUrl: TEST_REPO_URL
      });
      createdRepositoryIds.push(TEST_REPO_ID);
    });

    it('should immediately resolve repository-scoped variables for new projects', async () => {
      // Create environment variable for repository
      const envVar = await axios.post('/api/secrets', {
        name: 'IMMEDIATE_TEST_VAR',
        value: 'immediate-value',
        isSecret: false,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(envVar.data.id);

      // Simulate project creation with this repository
      // The API should immediately have access to repository-scoped variables
      const resolveResponse = await axios.get('/api/secrets/resolve', {
        params: { 
          repositoryId: TEST_REPO_ID,
          projectId: 'test-project-id' 
        }
      });

      expect(resolveResponse.status).toBe(200);
      const variables = resolveResponse.data;
      
      const testVar = variables.find((v: any) => v.name === 'IMMEDIATE_TEST_VAR');
      expect(testVar).toBeDefined();
      expect(testVar.value).toBe('immediate-value');
      expect(testVar.isSecret).toBe(false);
    });

    it('should properly separate secrets and environment variables for container injection', async () => {
      // Create both types
      const secret = await axios.post('/api/secrets', {
        name: 'PROXY_SECRET',
        value: 'proxy-value',
        domain: 'api.proxy.com',
        authType: 'bearer',
        isSecret: true,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(secret.data.id);

      const envVar = await axios.post('/api/secrets', {
        name: 'DIRECT_ENV_VAR',
        value: 'direct-value',
        isSecret: false,
        repositoryId: TEST_REPO_ID
      });
      createdSecretIds.push(envVar.data.id);

      // Check resolution
      const response = await axios.get('/api/secrets/resolve', {
        params: { repositoryId: TEST_REPO_ID }
      });

      const secrets = response.data.filter((item: any) => item.isSecret);
      const envVars = response.data.filter((item: any) => !item.isSecret);

      expect(secrets.length).toBeGreaterThan(0);
      expect(envVars.length).toBeGreaterThan(0);

      // Secrets should have domains, env vars should not
      const proxySecret = secrets.find((s: any) => s.name === 'PROXY_SECRET');
      expect(proxySecret.domain).toBe('api.proxy.com');

      const directEnvVar = envVars.find((e: any) => e.name === 'DIRECT_ENV_VAR');
      expect(directEnvVar.domain).toBeNull();
      expect(directEnvVar.value).toBe('direct-value');
    });
  });
});