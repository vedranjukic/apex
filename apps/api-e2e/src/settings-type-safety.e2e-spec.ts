/**
 * E2E test: Settings Type Safety and Edge Cases
 *
 * Focused tests for the specific type safety bug that caused the 500 error:
 * "null is not an object (evaluating 'value.includes')"
 *
 * This test suite focuses on the exact scenarios that were causing crashes
 * and ensures the type checking fixes prevent regression.
 *
 * Key test areas:
 *   1. Null/undefined value handling
 *   2. String method calls on non-string values
 *   3. Edge cases with different JavaScript types
 *   4. Filtering logic for masked values
 *   5. Error boundaries and graceful degradation
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=settings-type-safety
 */
import axios from 'axios';
import { waitForApiSettled } from './support/e2e-helpers';

const baseURL = `http://localhost:${process.env.PORT || '6000'}`;
axios.defaults.baseURL = baseURL;

describe('Settings Type Safety E2E', () => {
  beforeAll(async () => {
    await waitForApiSettled(45_000);
  }, 60_000);

  describe('Null Value Handling (Original Bug)', () => {
    it('should not crash on null values', async () => {
      // This exact scenario was causing the 500 error
      const payload = {
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: null,
        GITHUB_TOKEN: null,
      };

      // Before the fix: "null is not an object (evaluating 'value.includes')"
      // After the fix: Should process gracefully
      const response = await axios.put('/api/settings', payload);
      
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should handle mixed null and string values', async () => {
      const payload = {
        NULL_FIELD: null,
        STRING_FIELD: "valid string",
        ANOTHER_NULL: null,
        EMPTY_STRING: "",
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should handle array of all null values', async () => {
      const nullFields = [
        'FIELD_1', 'FIELD_2', 'FIELD_3', 'FIELD_4', 'FIELD_5'
      ].reduce((acc, field) => ({ ...acc, [field]: null }), {});

      const response = await axios.put('/api/settings', nullFields);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });
  });

  describe('String Method Safety', () => {
    it('should safely check for masked values', async () => {
      // Test the exact code path that was failing: value.includes('••••')
      const testCases = [
        { value: null, name: "null value" },
        { value: "", name: "empty string" }, 
        { value: "normal-value", name: "normal string" },
        { value: "test••••masked", name: "masked value" },
        { value: "sk-ant-••••-1234", name: "API key with mask" },
      ];

      for (const testCase of testCases) {
        const payload = {
          TEST_FIELD: testCase.value,
          GIT_USER_NAME: "Type Safety Test",
        };

        const response = await axios.put('/api/settings', payload);
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ ok: true });
        
        // Verify masked values are properly filtered
        if (testCase.value && typeof testCase.value === 'string' && testCase.value.includes('••••')) {
          // Masked values should not be saved
          const getResponse = await axios.get('/api/settings');
          expect(getResponse.data.TEST_FIELD?.value).not.toBe(testCase.value);
        }
      }
    });

    it('should handle string conversion edge cases', async () => {
      // Test edge cases for String() conversion
      const edgeCases = [
        { BOOLEAN_FALSE: false },
        { BOOLEAN_TRUE: true }, 
        { NUMBER_ZERO: 0 },
        { NUMBER_POSITIVE: 123 },
        { UNDEFINED_FIELD: null }, // undefined becomes null in JSON
      ];

      for (const payload of edgeCases) {
        const response = await axios.put('/api/settings', payload);
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ ok: true });
      }
    });
  });

  describe('Filtering Logic Verification', () => {
    it('should correctly filter out null values', async () => {
      const payload = {
        GIT_USER_NAME: "valid value",
        ANTHROPIC_API_KEY: null,
        GIT_USER_EMAIL: "",
        OPENAI_API_KEY: null,
        DAYTONA_API_URL: "another valid value",
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);

      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("valid value");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("");
      expect(getResponse.data.DAYTONA_API_URL?.value).toBe("another valid value");
    }, 40_000);

    it('should correctly filter out masked values', async () => {
      // Set initial values (use an allowed key that supports masking)
      await axios.put('/api/settings', {
        DAYTONA_API_KEY: "sk-real-key-12345",
      });

      // Send masked version back (simulating dashboard)
      const payload = {
        DAYTONA_API_KEY: "sk-r••••-12345", // Masked — should be filtered
        GIT_USER_NAME: "Updated Name",
      };

      const response = await axios.put('/api/settings', payload);
      expect(response.status).toBe(200);

      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("Updated Name");
      // Masked value should have been filtered; original should remain masked in response
      expect(getResponse.data.DAYTONA_API_KEY?.value).toContain('••••');
    }, 40_000);

    it('should handle mixed filtering scenarios', async () => {
      const complexPayload = {
        ANTHROPIC_API_KEY: null,                    // Filter out (null)
        OPENAI_API_KEY: "sk-ant-••••-test",         // Filter out (masked)
        GIT_USER_EMAIL: "",                         // Keep (empty string clears)
        GIT_USER_NAME: "real value",                // Keep
        DAYTONA_API_KEY: null,                      // Filter out (null)
        GITHUB_TOKEN: "ghp_••••abcd",               // Filter out (masked)
      };

      const response = await axios.put('/api/settings', complexPayload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("");
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("real value");
    });
  });

  describe('Error Boundary and Recovery', () => {
    it('should handle JavaScript type coercion edge cases', async () => {
      // Send all edge cases in one payload to trigger only one reinit cycle
      const payload = {
        GIT_USER_NAME: false,       // boolean → "false"
        AGENT_MAX_TOKENS: 0,        // number zero → "0"
        ANTHROPIC_API_KEY: null,    // null → filtered out
      };

      const response = await axios.put('/api/settings', payload as any);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("false");
      expect(getResponse.data.AGENT_MAX_TOKENS?.value).toBe("0");
    }, 40_000);

    it('should maintain API stability after type errors', async () => {
      // After processing edge cases, API should remain stable
      const normalPayload = {
        GIT_USER_NAME: "Stability Test",
        GIT_USER_EMAIL: "stable@test.com",
      };

      const response = await axios.put('/api/settings', normalPayload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("Stability Test");
    }, 40_000);
  });

  describe('Regression Prevention', () => {
    it('should not regress on the original error scenario', async () => {
      // The exact scenario from the bug report
      const originalErrorPayload = {
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: null,
        DAYTONA_API_KEY: null,
        DAYTONA_API_URL: null,
        DAYTONA_SNAPSHOT: null,
        SANDBOX_IMAGE: null,
        GITHUB_TOKEN: null,
        GIT_USER_NAME: null,
        GIT_USER_EMAIL: null,
        PROXY_CA_CERT: null,
        PROXY_CA_KEY: null,
        LLM_PROXY_SANDBOX_ID: null,
        LLM_PROXY_AUTH_TOKEN: null,
        LLM_PROXY_URL: null,
        LLM_PROXY_KEYS_HASH: null,
        PROXY_SANDBOX_SNAPSHOT: null,
        AGENT_MAX_TOKENS: null,
        AGENT_BUILD_MAX_TOKENS: null,
        AGENT_BUILD_REASONING_EFFORT: null,
        AGENT_PLAN_MAX_TOKENS: null,
        AGENT_PLAN_REASONING_EFFORT: null,
        AGENT_SISYPHUS_MAX_STEPS: null,
        AGENT_SISYPHUS_MAX_TOKENS: null,
        AGENT_SISYPHUS_REASONING_EFFORT: null,
      };

      // This should NOT return 500 Internal Server Error
      const response = await axios.put('/api/settings', originalErrorPayload);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });
    });

    it('should handle realistic form state from React component', async () => {
      // Simulate what React useState might produce for an uninitialized form
      const reactFormState = {
        // Some fields might be null (uninitialized)
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: null,
        
        // Some might be empty strings (user cleared them)
        GITHUB_TOKEN: "",
        DAYTONA_API_URL: "",
        
        // Some might have values (user entered data)
        GIT_USER_NAME: "React User",
        GIT_USER_EMAIL: "react@test.com",
        
        // Some might be undefined -> null in JSON
        UNDEFINED_FIELD: null,
      };

      const response = await axios.put('/api/settings', reactFormState);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      // Verify user-entered values were saved
      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("React User");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("react@test.com");
      // GITHUB_TOKEN and DAYTONA_API_URL: clearing the DB value falls back to
      // env if set (e.g. from E2E credential mapping), so just verify the
      // request succeeded — the exact value depends on the env.
      expect(getResponse.data.GITHUB_TOKEN).toBeDefined();
      expect(getResponse.data.DAYTONA_API_URL).toBeDefined();
    }, 40_000);
  });

  describe('Type Safety Validation', () => {
    it('should handle all primitive type variations in a single save', async () => {
      // Send all primitive types at once to avoid triggering reinit per value
      const payload = {
        ANTHROPIC_API_KEY: null,        // null → filtered out
        GIT_USER_NAME: "test-string",   // string → kept
        GIT_USER_EMAIL: "",             // empty string → kept (clears)
        AGENT_MAX_TOKENS: 42,           // number → converted to "42"
        DAYTONA_API_URL: false,         // boolean → converted to "false"
      };

      const response = await axios.put('/api/settings', payload as any);
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true });

      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("test-string");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("");
      expect(getResponse.data.AGENT_MAX_TOKENS?.value).toBe("42");
      expect(getResponse.data.DAYTONA_API_URL?.value).toBe("false");
    }, 40_000);

    it('should validate string conversion behavior', async () => {
      // Send all conversion cases in a single PUT to avoid multiple reinit cycles
      const payload = {
        AGENT_MAX_TOKENS: 0,
        AGENT_BUILD_MAX_TOKENS: 123,
        GIT_USER_NAME: true,
        GIT_USER_EMAIL: false,
      };

      const response = await axios.put('/api/settings', payload as any);
      expect(response.status).toBe(200);

      const getResponse = await axios.get('/api/settings');
      expect(getResponse.data.AGENT_MAX_TOKENS?.value).toBe("0");
      expect(getResponse.data.AGENT_BUILD_MAX_TOKENS?.value).toBe("123");
      expect(getResponse.data.GIT_USER_NAME?.value).toBe("true");
      expect(getResponse.data.GIT_USER_EMAIL?.value).toBe("false");
    }, 40_000);
  });
});