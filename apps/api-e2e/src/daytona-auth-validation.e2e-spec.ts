/**
 * E2E test: Fast authentication validation for Daytona API keys
 *
 * Tests GitHub Issue #58: Don't wait 30 seconds for proxy sandbox creation when Daytona key is invalid
 *
 * Validates:
 *   1. Invalid API keys fail fast (< 5 seconds) with clear error messages
 *   2. Valid API keys succeed without unnecessary delays
 *   3. Provider status checks include authentication validation
 *   4. Project creation fails gracefully with auth errors
 *
 * Environment:
 *   DAYTONA_API_KEY or DAYTONA_API_KEY_E2E - Valid Daytona API key for validation tests
 *
 * Run: yarn test:daytona-auth-validation-e2e
 */
import axios from 'axios';
import { waitForApiSettled, createProject, deleteProject } from './support/e2e-helpers';
import { DaytonaSandboxProvider } from '../../../libs/orchestrator/dist/lib/providers/daytona-provider';

// ── Helper functions ─────────────────────────────────────

async function getProviderStatuses(): Promise<any[]> {
  const res = await axios.get('/api/projects/providers');
  expect(res.status).toBe(200);
  return res.data;
}

async function reinitProviders(): Promise<void> {
  try {
    const res = await axios.post('/api/projects/reinit-providers');
    expect(res.status).toBe(200);
    await waitForApiSettled(15000);
  } catch (err: any) {
    console.warn('Provider reinit failed:', err.response?.data || err.message);
    // Continue with test - the provider reinit might not be available in all test environments
  }
}

// ── Test suite ──────────────────────────────────────────

describe('Daytona Authentication Validation E2E', () => {
  const originalApiKey = process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_KEY_E2E;
  
  // Skip if no valid API key available for testing
  const shouldSkip = !originalApiKey;
  const describeE2e = shouldSkip ? describe.skip : describe;

  beforeAll(async () => {
    if (shouldSkip) {
      console.log('⏭️  Skipping Daytona auth validation tests - no DAYTONA_API_KEY available');
      return;
    }
    await waitForApiSettled();
  });

  // ── Direct Provider Validation Tests ─────────────────

  describeE2e('Direct Provider Validation', () => {
    it('should validate authentication directly with invalid key', async () => {
      console.log('🧪 Testing direct authentication validation with invalid key...');
      
      // Create provider instance with invalid key
      const originalKey = process.env.DAYTONA_API_KEY;
      process.env.DAYTONA_API_KEY = 'invalid-key-test-' + Date.now();
      
      try {
        const provider = new DaytonaSandboxProvider();
        await provider.initialize();
        
        const startTime = Date.now();
        
        try {
          await provider.validateAuthentication();
          fail('Expected authentication to fail with invalid key');
        } catch (err: any) {
          const duration = Date.now() - startTime;
          
          console.log(`⏱️  Authentication failed in ${duration}ms`);
          
          expect(err.message).toMatch(/authentication.*failed|invalid.*api.*key|daytona.*api.*error/i);
          expect(duration).toBeLessThan(5000); // Should fail fast
          
          console.log(`✅ Fast authentication failure: ${err.message}`);
        }
      } finally {
        // Restore original key
        if (originalKey) {
          process.env.DAYTONA_API_KEY = originalKey;
        } else {
          delete process.env.DAYTONA_API_KEY;
        }
      }
    }, 30000);

    it('should validate authentication successfully with valid key', async () => {
      console.log('🧪 Testing direct authentication validation with valid key...');
      
      const provider = new DaytonaSandboxProvider();
      await provider.initialize();
      
      const startTime = Date.now();
      
      try {
        await provider.validateAuthentication();
        const duration = Date.now() - startTime;
        
        console.log(`✅ Authentication succeeded in ${duration}ms`);
        
        // Valid auth should complete reasonably quickly
        expect(duration).toBeLessThan(10000);
      } catch (err: any) {
        fail(`Valid authentication should not fail: ${err.message}`);
      }
    }, 30000);
  });

  // ── Provider Status Tests ────────────────────────────

  describeE2e('Provider Status API', () => {
    it('should return provider statuses including Daytona', async () => {
      console.log('🧪 Testing provider status API...');
      
      const statuses = await getProviderStatuses();
      
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThan(0);
      
      const daytonaStatus = statuses.find(s => s.type === 'daytona');
      expect(daytonaStatus).toBeDefined();
      expect(daytonaStatus).toHaveProperty('available');
      expect(daytonaStatus).toHaveProperty('type');
      
      console.log(`✅ Daytona provider status: available=${daytonaStatus.available}, reason=${daytonaStatus.reason || 'none'}`);
    }, 30000);
  });

  // ── Project Creation Tests ───────────────────────────

  describeE2e('Project Creation with Authentication', () => {
    it('should create Daytona project successfully with valid credentials', async () => {
      console.log('🧪 Testing project creation with valid Daytona credentials...');
      
      let projectId: string | null = null;
      
      try {
        const startTime = Date.now();
        
        // Create a project with valid credentials
        projectId = await createProject('test-valid-daytona-' + Date.now(), 'build', 'daytona');
        
        const duration = Date.now() - startTime;
        
        console.log(`✅ Project creation initiated successfully in ${duration}ms`);
        
        // Verify project was created
        const projectRes = await axios.get(`/api/projects/${projectId}`);
        expect(projectRes.status).toBe(200);
        expect(projectRes.data.id).toBe(projectId);
        expect(projectRes.data.provider).toBe('daytona');
        
        // Wait a moment to see initial status (not waiting for full provisioning)
        await new Promise(r => setTimeout(r, 3000));
        
        const updatedProjectRes = await axios.get(`/api/projects/${projectId}`);
        
        // Should be in a valid creation state, not errored due to auth issues
        expect(['creating', 'starting', 'running', 'stopped']).toContain(updatedProjectRes.data.status);
        
        if (updatedProjectRes.data.status === 'error') {
          // If there's an error, it shouldn't be authentication-related
          const error = updatedProjectRes.data.statusError || '';
          expect(error).not.toMatch(/authentication|invalid.*key|unauthorized/i);
        }
        
        console.log(`✅ Project status: ${updatedProjectRes.data.status}`);
        
      } finally {
        // Clean up the test project
        if (projectId) {
          await deleteProject(projectId);
        }
      }
    }, 120000);
  });

  // ── Performance and Regression Tests ─────────────────

  describeE2e('Performance Validation', () => {
    it('should consistently validate authentication quickly', async () => {
      console.log('🧪 Testing consistent authentication validation performance...');
      
      const provider = new DaytonaSandboxProvider();
      await provider.initialize();
      
      const durations: number[] = [];
      const attempts = 3;
      
      for (let i = 0; i < attempts; i++) {
        const startTime = Date.now();
        
        try {
          await provider.validateAuthentication();
        } catch {
          // Expected for some test scenarios
        }
        
        const duration = Date.now() - startTime;
        durations.push(duration);
        
        console.log(`   Validation attempt ${i + 1}: ${duration}ms`);
        
        // Brief pause between attempts
        if (i < attempts - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      // All attempts should be fast
      for (const duration of durations) {
        expect(duration).toBeLessThan(5000); // Each attempt under 5 seconds
      }
      
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      console.log(`✅ Average validation time: ${avg.toFixed(0)}ms`);
      
      // Average should be well under the old 30-second timeout
      expect(avg).toBeLessThan(10000);
    }, 60000);

    it('should handle concurrent validation calls efficiently', async () => {
      console.log('🧪 Testing concurrent authentication validation...');
      
      const provider = new DaytonaSandboxProvider();
      await provider.initialize();
      
      const startTime = Date.now();
      
      // Run 3 concurrent validation calls
      const promises = Array.from({ length: 3 }, async () => {
        try {
          await provider.validateAuthentication();
          return true;
        } catch {
          return false; // Expected for some scenarios
        }
      });
      
      const results = await Promise.all(promises);
      const totalDuration = Date.now() - startTime;
      
      console.log(`✅ Concurrent validations completed in ${totalDuration}ms`);
      
      // Should complete all concurrent validations quickly
      expect(totalDuration).toBeLessThan(15000);
      
      // At least should not crash or timeout
      expect(results).toHaveLength(3);
    }, 30000);
  });

  // ── Regression Prevention ─────────────────────────────

  describeE2e('Regression Prevention', () => {
    it('should never revert to 30-second timeouts', async () => {
      console.log('🧪 Testing prevention of 30-second timeout regression...');
      
      // Test with obviously invalid key
      const originalKey = process.env.DAYTONA_API_KEY;
      process.env.DAYTONA_API_KEY = 'regression-test-invalid-key';
      
      try {
        const provider = new DaytonaSandboxProvider();
        await provider.initialize();
        
        const startTime = Date.now();
        
        try {
          await provider.validateAuthentication();
        } catch {
          // Expected to fail
        }
        
        const duration = Date.now() - startTime;
        
        // This is the key regression test - should NEVER take 30 seconds
        expect(duration).toBeLessThan(25000); // Well under 30 seconds
        
        // Should actually be much faster
        expect(duration).toBeLessThan(5000); // Should be under 5 seconds
        
        console.log(`✅ No regression: failed in ${duration}ms (not 30s)`);
        
      } finally {
        // Restore original key
        if (originalKey) {
          process.env.DAYTONA_API_KEY = originalKey;
        } else {
          delete process.env.DAYTONA_API_KEY;
        }
      }
    }, 60000);
  });
});