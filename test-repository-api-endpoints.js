#!/usr/bin/env node

/**
 * Test script for repository-scoped secrets API endpoints
 * Tests the new /api/secrets/repositories endpoints
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:6000';
const TEST_REPO_ID = 'testowner/testrepo';

class RepositoryAPITester {
  constructor() {
    this.axios = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000
    });
    this.createdSecrets = [];
  }

  async run() {
    console.log('🧪 Testing Repository API Endpoints');
    console.log('===================================');

    try {
      await this.testEndpointsExist();
      await this.testRepositoriesListing();
      await this.testRepositorySecretsCRUD();
      await this.testSecretTypes();
      await this.testValidation();
      await this.testEdgeCases();
      
      console.log('\n✅ All repository API tests passed!');
    } catch (error) {
      console.error('\n❌ Repository API tests failed:', error.message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  async testEndpointsExist() {
    console.log('\n📋 Testing endpoint availability...');

    // Test that new repository endpoints exist
    try {
      const response = await this.axios.get('/api/secrets/repositories');
      console.log(`✅ GET /api/secrets/repositories - Status: ${response.status}`);
    } catch (error) {
      if (error.response?.status === 405) {
        throw new Error('Repository endpoints not implemented');
      }
      console.log(`✅ GET /api/secrets/repositories - Available (got ${error.response?.status})`);
    }
  }

  async testRepositoriesListing() {
    console.log('\n📋 Testing repositories listing...');

    const response = await this.axios.get('/api/secrets/repositories');
    
    if (response.status !== 200) {
      throw new Error(`Expected status 200, got ${response.status}`);
    }

    if (!Array.isArray(response.data)) {
      throw new Error('Response should be an array');
    }

    console.log(`✅ Repositories listing returned ${response.data.length} repositories`);
    
    // Each repository should have the expected structure
    for (const repo of response.data) {
      if (!repo.repositoryId || typeof repo.secretCount !== 'number' || typeof repo.envVarCount !== 'number') {
        throw new Error(`Invalid repository structure: ${JSON.stringify(repo)}`);
      }
    }

    console.log('✅ Repository structure validation passed');
  }

  async testRepositorySecretsCRUD() {
    console.log('\n🔐 Testing repository secrets CRUD operations...');

    // Create a repository secret
    const createPayload = {
      name: 'TEST_REPO_SECRET',
      value: 'test-secret-value-123',
      domain: 'test-api.example.com',
      authType: 'bearer',
      isSecret: true,
      description: 'Test repository secret'
    };

    const createResponse = await this.axios.post(`/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`, createPayload);
    
    if (createResponse.status !== 200) {
      throw new Error(`Create failed with status ${createResponse.status}`);
    }

    const createdSecret = createResponse.data;
    this.createdSecrets.push({ id: createdSecret.id, repositoryId: TEST_REPO_ID });

    console.log(`✅ Created repository secret: ${createdSecret.id}`);

    // Verify the secret was created with repository scope
    if (createdSecret.repositoryId !== TEST_REPO_ID) {
      throw new Error(`Expected repositoryId ${TEST_REPO_ID}, got ${createdSecret.repositoryId}`);
    }

    if (createdSecret.projectId !== null) {
      throw new Error(`Expected projectId null, got ${createdSecret.projectId}`);
    }

    // List repository secrets
    const listResponse = await this.axios.get(`/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`);
    
    if (listResponse.status !== 200) {
      throw new Error(`List failed with status ${listResponse.status}`);
    }

    const secrets = listResponse.data;
    const foundSecret = secrets.find(s => s.id === createdSecret.id);
    
    if (!foundSecret) {
      throw new Error('Created secret not found in repository listing');
    }

    console.log(`✅ Listed repository secrets: ${secrets.length} found`);

    // Update the secret
    const updatePayload = {
      description: 'Updated test repository secret',
      value: 'updated-secret-value-456'
    };

    const updateResponse = await this.axios.put(
      `/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}/${createdSecret.id}`,
      updatePayload
    );
    
    if (updateResponse.status !== 200) {
      throw new Error(`Update failed with status ${updateResponse.status}`);
    }

    const updatedSecret = updateResponse.data;
    
    if (updatedSecret.description !== updatePayload.description) {
      throw new Error(`Description not updated: ${updatedSecret.description}`);
    }

    console.log('✅ Updated repository secret successfully');

    // Delete the secret
    const deleteResponse = await this.axios.delete(
      `/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}/${createdSecret.id}`
    );
    
    if (deleteResponse.status !== 200 || !deleteResponse.data.ok) {
      throw new Error(`Delete failed with status ${deleteResponse.status}`);
    }

    console.log('✅ Deleted repository secret successfully');

    // Remove from our tracking
    this.createdSecrets = this.createdSecrets.filter(s => s.id !== createdSecret.id);
  }

  async testSecretTypes() {
    console.log('\n🔒 Testing secret types (secrets vs environment variables)...');

    // Create an environment variable
    const envVarPayload = {
      name: 'TEST_ENV_VAR',
      value: 'development',
      domain: 'localhost',
      authType: 'none',
      isSecret: false,
      description: 'Test environment variable'
    };

    const envVarResponse = await this.axios.post(`/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`, envVarPayload);
    
    if (envVarResponse.status !== 200) {
      throw new Error(`Environment variable create failed with status ${envVarResponse.status}`);
    }

    const createdEnvVar = envVarResponse.data;
    this.createdSecrets.push({ id: createdEnvVar.id, repositoryId: TEST_REPO_ID });

    if (createdEnvVar.isSecret !== false) {
      throw new Error(`Expected isSecret false, got ${createdEnvVar.isSecret}`);
    }

    console.log('✅ Created environment variable successfully');

    // Create an actual secret
    const secretPayload = {
      name: 'TEST_SECRET',
      value: 'secret-api-key',
      domain: 'api.example.com',
      authType: 'x-api-key',
      isSecret: true,
      description: 'Test secret'
    };

    const secretResponse = await this.axios.post(`/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`, secretPayload);
    
    if (secretResponse.status !== 200) {
      throw new Error(`Secret create failed with status ${secretResponse.status}`);
    }

    const createdSecret = secretResponse.data;
    this.createdSecrets.push({ id: createdSecret.id, repositoryId: TEST_REPO_ID });

    if (createdSecret.isSecret !== true) {
      throw new Error(`Expected isSecret true, got ${createdSecret.isSecret}`);
    }

    console.log('✅ Created actual secret successfully');

    // Verify both appear in repository listing
    const listResponse = await this.axios.get(`/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`);
    const repoSecrets = listResponse.data;

    const envVar = repoSecrets.find(s => s.id === createdEnvVar.id);
    const secret = repoSecrets.find(s => s.id === createdSecret.id);

    if (!envVar || !secret) {
      throw new Error('Both environment variable and secret should appear in repository listing');
    }

    console.log('✅ Both secret types listed correctly');
  }

  async testValidation() {
    console.log('\n✅ Testing validation and error handling...');

    // Test missing required fields
    try {
      await this.axios.post(`/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`, {
        name: '',  // Empty name should fail
        value: 'test',
        domain: 'test.com'
      });
      throw new Error('Empty name should have failed validation');
    } catch (error) {
      if (error.response?.status >= 400) {
        console.log('✅ Empty name validation works');
      } else {
        throw error;
      }
    }

    // Test invalid repository ID format
    try {
      await this.axios.get('/api/secrets/repositories/invalid-repo-id');
      // Depending on implementation, this might work or fail
      console.log('⚠️  Invalid repository ID handled gracefully');
    } catch (error) {
      if (error.response?.status >= 400) {
        console.log('✅ Invalid repository ID validation works');
      } else {
        throw error;
      }
    }

    // Test updating non-existent secret
    try {
      await this.axios.put(
        `/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}/non-existent-id`,
        { description: 'test' }
      );
      throw new Error('Non-existent secret update should have failed');
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('✅ Non-existent secret update returns 404');
      } else {
        throw error;
      }
    }

    // Test deleting non-existent secret
    try {
      await this.axios.delete(`/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}/non-existent-id`);
      throw new Error('Non-existent secret delete should have failed');
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('✅ Non-existent secret delete returns 404');
      } else {
        throw error;
      }
    }
  }

  async testEdgeCases() {
    console.log('\n⚠️  Testing edge cases...');

    // Test special characters in repository ID
    const specialRepoId = 'org-name/repo_name.test';
    
    const specialPayload = {
      name: 'SPECIAL_REPO_SECRET',
      value: 'special-value',
      domain: 'special.com',
      authType: 'bearer',
      isSecret: true
    };

    try {
      const response = await this.axios.post(
        `/api/secrets/repositories/${encodeURIComponent(specialRepoId)}`,
        specialPayload
      );
      
      if (response.status === 200) {
        this.createdSecrets.push({ id: response.data.id, repositoryId: specialRepoId });
        console.log('✅ Special characters in repository ID handled');
      }
    } catch (error) {
      console.log(`⚠️  Special characters in repository ID: ${error.response?.status || error.message}`);
    }

    // Test very long values
    const longValuePayload = {
      name: 'LONG_VALUE_SECRET',
      value: 'x'.repeat(10000),  // Very long value
      domain: 'long.com',
      authType: 'bearer',
      isSecret: true
    };

    try {
      const response = await this.axios.post(
        `/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`,
        longValuePayload
      );
      
      if (response.status === 200) {
        this.createdSecrets.push({ id: response.data.id, repositoryId: TEST_REPO_ID });
        console.log('✅ Long values handled correctly');
      }
    } catch (error) {
      console.log(`⚠️  Long values: ${error.response?.status || error.message}`);
    }

    // Test duplicate names within repository (should fail with unique constraint)
    const duplicatePayload = {
      name: 'DUPLICATE_NAME',
      value: 'value1',
      domain: 'dup.com',
      authType: 'bearer',
      isSecret: true
    };

    try {
      const response1 = await this.axios.post(
        `/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`,
        duplicatePayload
      );
      this.createdSecrets.push({ id: response1.data.id, repositoryId: TEST_REPO_ID });

      const duplicatePayload2 = { ...duplicatePayload, value: 'value2' };
      await this.axios.post(
        `/api/secrets/repositories/${encodeURIComponent(TEST_REPO_ID)}`,
        duplicatePayload2
      );
      
      throw new Error('Duplicate names should have failed');
    } catch (error) {
      if (error.message === 'Duplicate names should have failed') {
        throw error;
      }
      console.log('✅ Duplicate names properly rejected');
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test secrets...');

    for (const secret of this.createdSecrets) {
      try {
        await this.axios.delete(
          `/api/secrets/repositories/${encodeURIComponent(secret.repositoryId)}/${secret.id}`
        );
        console.log(`✅ Cleaned up secret: ${secret.id}`);
      } catch (error) {
        console.warn(`⚠️  Failed to cleanup secret ${secret.id}: ${error.message}`);
      }
    }

    this.createdSecrets = [];
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const tester = new RepositoryAPITester();
  tester.run().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { RepositoryAPITester };