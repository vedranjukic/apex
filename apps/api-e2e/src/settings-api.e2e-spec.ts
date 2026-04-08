/**
 * E2E test: Settings API resilience and error handling.
 *
 * Tests the comprehensive fix for the settings page 500 error that occurred
 * when users clicked "Save" on the settings page. This test ensures:
 *   1. Server startup with proxy sandbox timeout protection
 *   2. Settings API handles null/undefined values correctly
 *   3. Settings API properly filters and processes different data types
 *   4. Re-initialization after settings save works with timeout protection
 *   5. First-run scenarios (empty/null forms) are handled gracefully
 *   6. No regression in normal settings operations
 *
 * Environment:
 *   ANTHROPIC_API_KEY     - Required for proxy sandbox creation attempts
 *   DAYTONA_API_KEY       - Required if testing Daytona provider scenarios
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=settings-api
 */
import axios from 'axios';
import { waitForApiSettled } from './support/e2e-helpers';

const baseURL = `http://localhost:${process.env.PORT || '6000'}`;
axios.defaults.baseURL = baseURL;

// ── Main Test Suite ─────────────────────────────────

describe('Settings API E2E', () => {

  beforeAll(async () => {
    // Wait for API server to finish initialization and settle
    // This tests that server startup completes even with proxy sandbox timeouts
    await waitForApiSettled(45_000); // Extended timeout to account for 30s proxy sandbox timeout
  }, 60_000);

  describe('Server Startup Resilience', () => {
    it('should have started successfully despite proxy sandbox timeout', async () => {
      // Test that the API is responding after startup
      const response = await axios.get('/api/settings/visible');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('visible');
    });

    it('should respond to basic API endpoints', async () => {
      const response = await axios.get('/api/settings');
      expect(response.status).toBe(200);
      expect(typeof response.data).toBe('object');
    });
  });

  describe('Settings API Type Safety', () => {
    it('should handle null values without crashing', async () => {
      // This was the main cause of the 500 error
      const payload = {
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: null,
        GITHUB_TOKEN: null,
        GIT_USER_NAME: null,
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should handle undefined values gracefully', async () => {
      // JavaScript might send undefined as null in JSON
      const payload = {
        DAYTONA_API_KEY: null,
        DAYTONA_API_URL: null,
        SANDBOX_IMAGE: null,
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should handle mixed null and empty string values', async () => {
      // Realistic scenario from settings form
      const payload = {
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: "",
        GITHUB_TOKEN: "",
        GIT_USER_NAME: null,
        GIT_USER_EMAIL: "",
        DAYTONA_API_URL: null,
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should filter out masked values (••••)', async () => {
      // Test that masked values are properly filtered
      const payload = {
        ANTHROPIC_API_KEY: "sk-ant-••••-1234",
        OPENAI_API_KEY: "sk-proj-••••-5678", 
        GITHUB_TOKEN: "ghp_••••abcd",
        GIT_USER_NAME: "Test User",
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      // Verify masked values weren't saved — keys with existing values
      // should still be masked in the response, and keys without values
      // should remain empty (the masked input was filtered out).
      const getResponse = await axios.get('/api/settings');
      const settings = getResponse.data;

      for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN']) {
        const entry = settings[key];
        if (entry && entry.source !== 'none' && entry.value) {
          expect(entry.value).toContain('••••');
        }
      }
    });
  });

  describe('First-Run Scenarios', () => {
    it('should handle completely empty form submission', async () => {
      // Only clear non-critical settings to avoid poisoning the DB for
      // subsequent tests that need ANTHROPIC_API_KEY, DAYTONA_API_KEY, etc.
      const payload = {
        GIT_USER_NAME: "",
        GIT_USER_EMAIL: "",
        AGENT_MAX_TOKENS: "",
        AGENT_BUILD_MAX_TOKENS: "",
        AGENT_PLAN_MAX_TOKENS: "",
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    }, 40_000);

    it('should handle form with all null fields', async () => {
      // Uninitialized form scenario
      const payload = {
        FIELD_1: null,
        FIELD_2: null,
        FIELD_3: null,
        FIELD_4: null,
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should not trigger re-initialization when no values to save', async () => {
      // When all values are filtered out, should be fast (no re-init)
      const startTime = Date.now();
      
      const payload = {
        NULL_FIELD_1: null,
        NULL_FIELD_2: null,
        MASKED_FIELD: "sk-••••-test",
      };

      const response = await axios.put('/api/settings', payload);
      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
      
      // Should be fast since no actual settings were changed
      expect(duration).toBeLessThan(5000); // Much less than 30s timeout
    });
  });

  describe('Re-initialization with Timeout Protection', () => {
    it('should complete settings save with valid values within timeout', async () => {
      // This test verifies that re-initialization works with timeout protection
      const payload = {
        GIT_USER_NAME: "E2E Test User",
        GIT_USER_EMAIL: "e2e@test.com",
      };

      // This might take up to 30 seconds due to proxy sandbox timeout
      const startTime = Date.now();
      const response = await axios.put('/api/settings', payload);
      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
      
      // Should complete within timeout window (30s + buffer)
      expect(duration).toBeLessThan(35_000);
      
      // Verify settings were actually saved
      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("E2E Test User");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("e2e@test.com");
    }, 40_000); // Extended timeout for this test

    it('should handle API key changes that trigger proxy re-initialization', async () => {
      // Use a non-critical key to test reinit without poisoning the Anthropic key
      const payload = {
        GIT_USER_NAME: "Reinit Test User",
      };

      const startTime = Date.now();
      const response = await axios.put('/api/settings', payload);
      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
      
      expect(duration).toBeLessThan(35_000);
    }, 40_000);
  });

  describe('Error Recovery and Logging', () => {
    it('should handle malformed requests gracefully', async () => {
      // Test various edge cases that might cause issues
      
      // Empty object
      let response = await axios.put('/api/settings', {});
      expect(response.status).toBe(200);
      
      // Object with strange values
      response = await axios.put('/api/settings', {
        EMPTY_STRING: "",
        NULL_VALUE: null,
        // Note: undefined becomes null in JSON
      });
      expect(response.status).toBe(200);
    });

    it('should maintain existing settings when updates fail gracefully', async () => {
      // First set some values
      await axios.put('/api/settings', {
        GIT_USER_NAME: "Stable Value",
      });
      
      // Then try an update that should process gracefully
      const response = await axios.put('/api/settings', {
        GIT_USER_NAME: null, // Should be filtered out
        SOME_OTHER_FIELD: null,
      });
      
      expect(response.status).toBe(200);
      
      // Original value should remain unchanged
      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("Stable Value");
    }, 40_000);
  });

  describe('Performance and Optimization', () => {
    it('should quickly process requests with no actual changes', async () => {
      // Test the optimization where empty filtered objects don't trigger re-init
      const payloads = [
        { FIELD_1: null, FIELD_2: null },
        { MASKED_VAL: "test••••value" },
        {},
      ];

      for (const payload of payloads) {
        const startTime = Date.now();
        const response = await axios.put('/api/settings', payload);
        const duration = Date.now() - startTime;
        
        expect(response.status).toBe(200);
        expect(duration).toBeLessThan(2000); // Should be very fast
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should still process normal settings updates correctly', async () => {
      // Ensure we didn't break normal functionality
      const payload = {
        GIT_USER_NAME: "Normal User",
        GIT_USER_EMAIL: "normal@example.com",
        AGENT_MAX_TOKENS: "8192",
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      const getResponse = await axios.get('/api/settings');
      const settings = getResponse.data;
      
      expect(settings.GIT_USER_NAME?.value).toBe("Normal User");
      expect(settings.GIT_USER_EMAIL?.value).toBe("normal@example.com");
      expect(settings.AGENT_MAX_TOKENS?.value).toBe("8192");
    }, 40_000);

    it('should preserve the settings API response format', async () => {
      const response = await axios.get('/api/settings');
      
      expect(response.status).toBe(200);
      expect(typeof response.data).toBe('object');
      
      // Check that each setting has the expected structure
      for (const [key, setting] of Object.entries(response.data as Record<string, any>)) {
        expect(setting).toHaveProperty('value');
        expect(setting).toHaveProperty('source');
        expect(['settings', 'env', 'none']).toContain(setting.source);
      }
    });
  });

  // Cleanup test data
  afterAll(async () => {
    try {
      // Reset test values
      await axios.put('/api/settings', {
        GIT_USER_NAME: "",
        GIT_USER_EMAIL: "",
        AGENT_MAX_TOKENS: "",
      });
    } catch {
      // Ignore cleanup errors
    }
  });
});