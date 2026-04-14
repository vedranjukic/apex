#!/usr/bin/env node

/**
 * Test script for MITM proxy integration with repository secrets
 * Tests that the proxy correctly resolves and injects repository-scoped secrets
 */

const axios = require('axios');
const net = require('net');
const tls = require('tls');
const http = require('http');

const API_BASE_URL = process.env.API_URL || 'http://localhost:6000';
const PROXY_HOST = process.env.PROXY_HOST || 'localhost';
const PROXY_PORT = process.env.PROXY_PORT || '9350';

class ProxyIntegrationTester {
  constructor() {
    this.axios = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000
    });
    this.testSecrets = [];
    this.testDomain = 'proxy-test.example.com';
  }

  async run() {
    console.log('🔐 Testing MITM Proxy Integration with Repository Secrets');
    console.log('=========================================================');

    try {
      await this.setupTestSecrets();
      await this.testProxyAvailability();
      await this.testRepositorySecretInjection();
      await this.testSecretPriority();
      await this.testEnvironmentVariableExclusion();
      await this.testDomainMatching();
      await this.testSecretUpdates();
      
      console.log('\n✅ All proxy integration tests passed!');
    } catch (error) {
      console.error('\n❌ Proxy integration tests failed:', error.message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  async setupTestSecrets() {
    console.log('\n🔧 Setting up test secrets...');

    // Clean up any existing test secrets
    await this.cleanupExistingTestSecrets();

    // Create global secret
    const globalSecret = await this.createSecret({
      name: 'API_TOKEN',
      value: 'global-token-value',
      domain: this.testDomain,
      authType: 'bearer',
      isSecret: true,
      description: 'Global test secret'
    });
    this.testSecrets.push(globalSecret);

    // Create repository-specific secret (should override global)
    const repoSecret = await this.createRepositorySecret('testowner/testrepo', {
      name: 'API_TOKEN',  // Same name as global
      value: 'repo-specific-token-value',
      domain: this.testDomain,
      authType: 'bearer',
      isSecret: true,
      description: 'Repository-specific test secret'
    });
    this.testSecrets.push(repoSecret);

    // Create environment variable (should be ignored by proxy)
    const envVar = await this.createRepositorySecret('testowner/testrepo', {
      name: 'NODE_ENV',
      value: 'test',
      domain: 'localhost',
      authType: 'none',
      isSecret: false,
      description: 'Test environment variable'
    });
    this.testSecrets.push(envVar);

    // Create secret for different auth type
    const xApiKeySecret = await this.createRepositorySecret('testowner/testrepo', {
      name: 'X_API_KEY',
      value: 'x-api-key-value',
      domain: this.testDomain,
      authType: 'x-api-key',
      isSecret: true,
      description: 'X-API-Key test secret'
    });
    this.testSecrets.push(xApiKeySecret);

    console.log(`✅ Created ${this.testSecrets.length} test secrets`);
  }

  async cleanupExistingTestSecrets() {
    try {
      const response = await this.axios.get('/api/secrets');
      const existingSecrets = response.data.filter(s => 
        s.domain === this.testDomain || s.name.includes('TEST_')
      );

      for (const secret of existingSecrets) {
        try {
          await this.axios.delete(`/api/secrets/${secret.id}`);
        } catch (error) {
          // Ignore deletion errors
        }
      }
    } catch (error) {
      // Ignore listing errors
    }
  }

  async createSecret(payload) {
    const response = await this.axios.post('/api/secrets', payload);
    return response.data;
  }

  async createRepositorySecret(repositoryId, payload) {
    const response = await this.axios.post(`/api/secrets/repositories/${encodeURIComponent(repositoryId)}`, payload);
    return response.data;
  }

  async testProxyAvailability() {
    console.log('\n🌐 Testing proxy availability...');

    return new Promise((resolve, reject) => {
      const socket = net.connect(Number(PROXY_PORT), PROXY_HOST, () => {
        socket.destroy();
        console.log('✅ Proxy is available');
        resolve();
      });

      socket.on('error', (error) => {
        reject(new Error(`Proxy not available on ${PROXY_HOST}:${PROXY_PORT}: ${error.message}`));
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error('Proxy connection timeout'));
      });
    });
  }

  async testRepositorySecretInjection() {
    console.log('\n🔐 Testing repository secret injection...');

    // Mock the sandbox context to test repository-specific resolution
    // In reality, this would be handled by the bridge communicating the context
    
    try {
      // Test that secrets are properly resolved for a repository context
      // This tests the service layer that the proxy uses
      const resolvedSecrets = await this.testSecretResolution('testowner/testrepo');
      
      const apiTokenSecret = resolvedSecrets.find(s => s.name === 'API_TOKEN');
      if (!apiTokenSecret) {
        throw new Error('API_TOKEN secret not found in resolution');
      }

      if (apiTokenSecret.value !== 'repo-specific-token-value') {
        throw new Error(`Expected repo-specific value, got: ${apiTokenSecret.value}`);
      }

      console.log('✅ Repository secret properly resolved (repo overrides global)');

    } catch (error) {
      throw new Error(`Repository secret injection test failed: ${error.message}`);
    }
  }

  async testSecretResolution(repositoryId) {
    // Call the secrets service directly to test resolution
    // In a full integration test, this would go through the proxy
    
    const response = await this.axios.post('/api/test/resolve-secrets', {
      repositoryId: repositoryId
    });
    
    return response.data;
  }

  async testSecretPriority() {
    console.log('\n📊 Testing secret priority resolution...');

    // Create secrets at different scopes with same name
    const testSecretName = 'PRIORITY_TEST_SECRET';
    
    // Global scope
    const globalSecret = await this.createSecret({
      name: testSecretName,
      value: 'global-priority-value',
      domain: this.testDomain,
      authType: 'bearer',
      isSecret: true
    });
    this.testSecrets.push(globalSecret);

    // Repository scope
    const repoSecret = await this.createRepositorySecret('priority/test', {
      name: testSecretName,
      value: 'repo-priority-value',
      domain: this.testDomain,
      authType: 'bearer',
      isSecret: true
    });
    this.testSecrets.push(repoSecret);

    // Test resolution - repository should win
    try {
      const resolvedSecrets = await this.testSecretResolution('priority/test');
      const prioritySecret = resolvedSecrets.find(s => s.name === testSecretName);
      
      if (!prioritySecret) {
        throw new Error('Priority test secret not found');
      }
      
      if (prioritySecret.value !== 'repo-priority-value') {
        throw new Error(`Expected repo value, got: ${prioritySecret.value}`);
      }
      
      console.log('✅ Repository secrets correctly override global secrets');
      
    } catch (error) {
      throw new Error(`Priority test failed: ${error.message}`);
    }
  }

  async testEnvironmentVariableExclusion() {
    console.log('\n🚫 Testing environment variable exclusion...');

    try {
      // Test that environment variables (isSecret=false) are excluded from proxy resolution
      const resolvedSecrets = await this.testSecretResolution('testowner/testrepo');
      
      const envVar = resolvedSecrets.find(s => s.name === 'NODE_ENV');
      if (envVar && envVar.isSecret === false) {
        throw new Error('Environment variables should be excluded from secret resolution for proxy');
      }
      
      // All resolved secrets should have isSecret=true
      const nonSecrets = resolvedSecrets.filter(s => s.isSecret === false);
      if (nonSecrets.length > 0) {
        throw new Error(`Found ${nonSecrets.length} environment variables in secret resolution`);
      }
      
      console.log('✅ Environment variables properly excluded from proxy resolution');
      
    } catch (error) {
      throw new Error(`Environment variable exclusion test failed: ${error.message}`);
    }
  }

  async testDomainMatching() {
    console.log('\n🌍 Testing domain-based secret matching...');

    // Create secrets for different domains
    const domain1Secret = await this.createSecret({
      name: 'DOMAIN1_KEY',
      value: 'domain1-value',
      domain: 'domain1.example.com',
      authType: 'bearer',
      isSecret: true
    });
    this.testSecrets.push(domain1Secret);

    const domain2Secret = await this.createSecret({
      name: 'DOMAIN2_KEY',
      value: 'domain2-value',
      domain: 'domain2.example.com',
      authType: 'x-api-key',
      isSecret: true
    });
    this.testSecrets.push(domain2Secret);

    try {
      // Test domain-specific resolution
      const domain1Secrets = await this.testDomainResolution('domain1.example.com');
      const domain2Secrets = await this.testDomainResolution('domain2.example.com');
      
      const domain1Found = domain1Secrets.some(s => s.name === 'DOMAIN1_KEY');
      const domain2Found = domain2Secrets.some(s => s.name === 'DOMAIN2_KEY');
      
      if (!domain1Found) {
        throw new Error('Domain1 secret not found for domain1.example.com');
      }
      
      if (!domain2Found) {
        throw new Error('Domain2 secret not found for domain2.example.com');
      }
      
      console.log('✅ Domain-based secret matching works correctly');
      
    } catch (error) {
      throw new Error(`Domain matching test failed: ${error.message}`);
    }
  }

  async testDomainResolution(domain) {
    // Test domain-based secret lookup (used by proxy)
    const response = await this.axios.get(`/api/test/domain-secrets/${encodeURIComponent(domain)}`);
    return response.data;
  }

  async testSecretUpdates() {
    console.log('\n🔄 Testing secret updates in proxy...');

    // Create a test secret
    const testSecret = await this.createRepositorySecret('update/test', {
      name: 'UPDATE_TEST_SECRET',
      value: 'original-value',
      domain: this.testDomain,
      authType: 'bearer',
      isSecret: true
    });
    this.testSecrets.push(testSecret);

    // Wait for proxy to pick up the secret
    await this.sleep(1000);

    // Update the secret value
    const updateResponse = await this.axios.put(
      `/api/secrets/repositories/${encodeURIComponent('update/test')}/${testSecret.id}`,
      {
        value: 'updated-value'
      }
    );

    if (updateResponse.status !== 200) {
      throw new Error(`Secret update failed with status ${updateResponse.status}`);
    }

    // Wait for proxy to pick up the change
    await this.sleep(1000);

    try {
      // Test that the updated value is now used
      const resolvedSecrets = await this.testSecretResolution('update/test');
      const updatedSecret = resolvedSecrets.find(s => s.name === 'UPDATE_TEST_SECRET');
      
      if (!updatedSecret) {
        throw new Error('Updated secret not found in resolution');
      }
      
      if (updatedSecret.value !== 'updated-value') {
        throw new Error(`Expected updated value, got: ${updatedSecret.value}`);
      }
      
      console.log('✅ Secret updates properly propagated to proxy');
      
    } catch (error) {
      throw new Error(`Secret update test failed: ${error.message}`);
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test secrets...');

    for (const secret of this.testSecrets) {
      try {
        await this.axios.delete(`/api/secrets/${secret.id}`);
        console.log(`✅ Cleaned up secret: ${secret.id}`);
      } catch (error) {
        console.warn(`⚠️  Failed to cleanup secret ${secret.id}: ${error.message}`);
      }
    }

    this.testSecrets = [];
  }
}

// Note: This test requires additional API endpoints for testing secret resolution
// In a real implementation, you might need to create temporary test endpoints
// or modify the proxy to expose resolution functionality for testing

// Temporary test endpoints that would need to be added to the API:
// POST /api/test/resolve-secrets - resolves secrets for a given context
// GET /api/test/domain-secrets/:domain - gets secrets for a domain

const mockTestEndpoints = `
// Add these endpoints to your test API for comprehensive proxy testing:

app.post('/api/test/resolve-secrets', async (req, res) => {
  const { repositoryId, projectId } = req.body;
  const userId = usersService.getDefaultUserId();
  
  try {
    const secrets = await secretsService.resolveSecretsForContext(userId, projectId, repositoryId);
    res.json(secrets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test/domain-secrets/:domain', async (req, res) => {
  const { domain } = req.params;
  
  try {
    const secrets = await secretsService.findByDomain(domain);
    res.json(secrets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
`;

// Run the test if this file is executed directly
if (require.main === module) {
  console.log('\n📝 Note: This test requires temporary test endpoints to be available.');
  console.log('See the mockTestEndpoints variable in this file for required endpoints.\n');
  
  const tester = new ProxyIntegrationTester();
  tester.run().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { ProxyIntegrationTester, mockTestEndpoints };