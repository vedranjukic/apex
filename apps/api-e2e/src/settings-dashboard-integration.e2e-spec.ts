/**
 * E2E test: Settings Dashboard Integration
 *
 * Tests the full settings page workflow from the dashboard perspective,
 * including the Vite proxy configuration and port setup that was part
 * of the 500 error fix.
 *
 * This test simulates the actual user interactions that were failing:
 *   1. Dashboard loads settings from API
 *   2. User modifies form fields (including null/empty scenarios)
 *   3. User clicks "Save" button
 *   4. Dashboard sends PUT request through Vite proxy
 *   5. API processes request without 500 error
 *   6. Dashboard receives success response
 *   7. Settings are re-fetched and updated in UI
 *
 * Environment:
 *   ANTHROPIC_API_KEY     - Required for realistic settings scenarios
 *   PORT                  - Should be 6000 to match Vite proxy config
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=settings-dashboard-integration
 */
import axios from 'axios';
import { waitForApiSettled } from './support/e2e-helpers';

const apiPort = process.env.PORT || '6000';
const baseURL = `http://localhost:${apiPort}`;
axios.defaults.baseURL = baseURL;

// Dashboard would normally proxy through port 4200 to API on port 6000
// For E2E, we test the API directly but simulate the request patterns

describe('Settings Dashboard Integration E2E', () => {
  let initialSettings: Record<string, any> = {};

  beforeAll(async () => {
    await waitForApiSettled(45_000);
    
    // Capture initial settings state
    const response = await axios.get('/api/settings');
    initialSettings = response.data;
  }, 60_000);

  describe('Settings Page Load Workflow', () => {
    it('should load settings successfully (simulating dashboard mount)', async () => {
      // Simulate what happens when settings page loads in dashboard
      const [visibilityResponse, settingsResponse] = await Promise.all([
        axios.get('/api/settings/visible'),
        axios.get('/api/settings'),
      ]);

      expect(visibilityResponse.status).toBe(200);
      expect(visibilityResponse.data.visible).toBe(true);

      expect(settingsResponse.status).toBe(200);
      expect(typeof settingsResponse.data).toBe('object');

      // Should have all expected settings fields
      const expectedFields = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'GITHUB_TOKEN',
        'GIT_USER_NAME', 
        'GIT_USER_EMAIL',
        'DAYTONA_API_KEY',
        'DAYTONA_API_URL',
      ];

      for (const field of expectedFields) {
        expect(settingsResponse.data).toHaveProperty(field);
        expect(settingsResponse.data[field]).toHaveProperty('value');
        expect(settingsResponse.data[field]).toHaveProperty('source');
      }
    });

    it('should correctly mask secret values in GET response', async () => {
      const response = await axios.get('/api/settings');
      const settings = response.data;

      // Secret fields should be masked if they have values
      const secretFields = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DAYTONA_API_KEY', 'GITHUB_TOKEN'];
      
      for (const field of secretFields) {
        const setting = settings[field];
        if (setting && setting.value && setting.value.length > 0) {
          // Should either be masked or empty
          expect(
            setting.value === '' || 
            setting.value.includes('••••') ||
            setting.source === 'none'
          ).toBe(true);
        }
      }
    });
  });

  describe('User Form Interaction Scenarios', () => {
    it('should handle first-time user saving empty form', async () => {
      // Simulate new user clicking save with empty form
      // This represents all fields being null/undefined in the form state
      const emptyFormData = {
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: null,
        GITHUB_TOKEN: null,
        GIT_USER_NAME: null,
        GIT_USER_EMAIL: null,
        DAYTONA_API_KEY: null,
        DAYTONA_API_URL: null,
        DAYTONA_SNAPSHOT: null,
        SANDBOX_IMAGE: null,
        AGENT_MAX_TOKENS: null,
        AGENT_BUILD_MAX_TOKENS: null,
        AGENT_BUILD_REASONING_EFFORT: null,
        AGENT_PLAN_MAX_TOKENS: null,
        AGENT_PLAN_REASONING_EFFORT: null,
        AGENT_SISYPHUS_MAX_STEPS: null,
        AGENT_SISYPHUS_MAX_TOKENS: null,
        AGENT_SISYPHUS_REASONING_EFFORT: null,
      };

      const response = await axios.put('/api/settings', emptyFormData);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should handle partial form completion', async () => {
      // Simulate user filling in just name and email
      const partialFormData = {
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: null,
        GITHUB_TOKEN: "",
        GIT_USER_NAME: "Dashboard User",
        GIT_USER_EMAIL: "dashboard@test.com",
        DAYTONA_API_KEY: null,
        DAYTONA_API_URL: "",
      };

      const response = await axios.put('/api/settings', partialFormData);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      // Verify the values were saved
      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("Dashboard User");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("dashboard@test.com");
    }, 40_000);

    it('should handle user clearing existing values', async () => {
      // First set some values
      await axios.put('/api/settings', {
        GIT_USER_NAME: "Original User",
        GIT_USER_EMAIL: "original@test.com",
      });

      // Then simulate user clearing the fields (empty strings)
      const clearedFormData = {
        GIT_USER_NAME: "",
        GIT_USER_EMAIL: "",
      };

      const response = await axios.put('/api/settings', clearedFormData);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      // Values should be cleared
      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("");
    }, 40_000);

    it('should preserve existing masked values when not changed', async () => {
      // Simulate the common case where user saves form without changing API keys
      // Dashboard sends masked values for fields user didn't modify
      const formDataWithMaskedValues = {
        ANTHROPIC_API_KEY: "sk-ant-••••-existing", // Masked, should be filtered
        OPENAI_API_KEY: "sk-proj-••••-existing", // Masked, should be filtered  
        GITHUB_TOKEN: "ghp_••••existing", // Masked, should be filtered
        GIT_USER_NAME: "Updated User",
        GIT_USER_EMAIL: "updated@test.com",
      };

      const response = await axios.put('/api/settings', formDataWithMaskedValues);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      // Only non-masked values should have been updated
      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("Updated User");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("updated@test.com");
      
      // Masked values should remain unchanged (still masked)
      if (getResponse.data.ANTHROPIC_API_KEY?.value) {
        expect(getResponse.data.ANTHROPIC_API_KEY.value).toMatch(/••••/);
      }
    }, 40_000);
  });

  describe('Dashboard Response Handling', () => {
    it('should complete settings refresh workflow after save', async () => {
      // Simulate the full dashboard workflow:
      // 1. Save settings
      // 2. Refresh settings from API
      // 3. Update UI state

      const settingsToSave = {
        GIT_USER_NAME: "Workflow User", 
        GIT_USER_EMAIL: "workflow@test.com",
        AGENT_MAX_TOKENS: "4096",
      };

      const saveResponse = await axios.put('/api/settings', settingsToSave);
      expect(saveResponse.status).toBe(200);
      expect(saveResponse.data).toEqual({ ok: true });

      const refreshResponse = await axios.get('/api/settings');
      expect(refreshResponse.status).toBe(200);

      const settings = refreshResponse.data;
      expect(settings.GIT_USER_NAME?.value).toBe("Workflow User");
      expect(settings.GIT_USER_EMAIL?.value).toBe("workflow@test.com");
      expect(settings.AGENT_MAX_TOKENS?.value).toBe("4096");
      
      expect(settings.GIT_USER_NAME?.source).toBe("settings");
      expect(settings.GIT_USER_EMAIL?.source).toBe("settings");
      expect(settings.AGENT_MAX_TOKENS?.source).toBe("settings");
    }, 40_000);

    it('should handle concurrent requests gracefully', async () => {
      // Simulate multiple save attempts (user clicking save multiple times)
      const promises = Array.from({ length: 3 }, (_, i) => 
        axios.put('/api/settings', {
          GIT_USER_NAME: `Concurrent User ${i}`,
        })
      );

      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ ok: true });
      });

      // Final state should be consistent
      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toMatch(/^Concurrent User \d$/);
    }, 60_000);
  });

  describe('Error Boundary and Recovery', () => {
    it('should handle network-like errors gracefully', async () => {
      // Test malformed requests that might come from buggy frontend code
      const malformedRequests = [
        {},
        { invalidField: "value" },
        { ANTHROPIC_API_KEY: null, OPENAI_API_KEY: null },
      ];

      for (const request of malformedRequests) {
        const response = await axios.put('/api/settings', request);
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ ok: true });
      }
    });

    it('should maintain API responsiveness after errors', async () => {
      // After any errors, API should still work normally
      const response = await axios.get('/api/settings');
      expect(response.status).toBe(200);
      
      const normalSave = await axios.put('/api/settings', {
        GIT_USER_NAME: "Recovery Test",
      });
      expect(normalSave.status).toBe(200);
    }, 40_000);
  });

  describe('Performance Benchmarks', () => {
    it('should complete save operations within acceptable timeframes', async () => {
      const testCases = [
        {
          name: "No changes (null values)",
          data: { FIELD_1: null, FIELD_2: null },
          maxTime: 2000, // Should be very fast
        },
        {
          name: "Simple text changes",
          data: { GIT_USER_NAME: "Perf Test" },
          maxTime: 35000, // May trigger re-init
        },
        {
          name: "Empty strings",
          data: { GIT_USER_NAME: "", GIT_USER_EMAIL: "" },
          maxTime: 35000, // May trigger re-init
        },
      ];

      for (const testCase of testCases) {
        const startTime = Date.now();
        const response = await axios.put('/api/settings', testCase.data);
        const duration = Date.now() - startTime;

        expect(response.status).toBe(200);
        expect(duration).toBeLessThan(testCase.maxTime);
        console.log(`[perf] ${testCase.name}: ${duration}ms`);
      }
    }, 120_000);
  });

  // Restore initial state
  afterAll(async () => {
    try {
      // Reset to initial state
      const resetData: Record<string, string> = {};
      
      for (const [key, setting] of Object.entries(initialSettings)) {
        if (setting && typeof setting === 'object' && 'source' in setting) {
          resetData[key] = setting.source === 'settings' ? setting.value : '';
        }
      }
      
      if (Object.keys(resetData).length > 0) {
        await axios.put('/api/settings', resetData);
      }
    } catch {
      // Ignore cleanup errors
    }
  });
});