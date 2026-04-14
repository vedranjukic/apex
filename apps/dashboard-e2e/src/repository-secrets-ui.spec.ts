import { test, expect } from '@playwright/test';

/**
 * E2E UI tests for the per-repository secrets and environment variables system.
 * 
 * Tests the complete user experience including:
 * - Repositories page navigation and management
 * - Repository creation flow with auto-refresh
 * - Repository-specific secrets page functionality  
 * - Secret vs environment variable form behavior
 * - Repository settings preview in project creation
 * - Modal popup for repository settings details
 * - UI consistency and accessibility
 */

test.describe('Repository Secrets UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the repositories page
    await page.goto('/');
    // Assuming we need to navigate to repositories from the main dashboard
    // This might need adjustment based on actual navigation structure
    await page.goto('/repositories');
  });

  test.describe('Repositories Page', () => {
    test('should display repositories list page', async ({ page }) => {
      await expect(page.locator('h1')).toContainText('Repositories');
      await expect(page.locator('text=Manage repository-scoped secrets')).toBeVisible();
      await expect(page.locator('button', { hasText: 'Add' })).toBeVisible();
    });

    test('should show repository creation dialog when Add button clicked', async ({ page }) => {
      await page.click('button:has-text("Add")');
      
      // Check that dialog appeared
      await expect(page.locator('text=Add')).toBeVisible();
      await expect(page.locator('input[placeholder*="github.com"]')).toBeVisible();
      await expect(page.locator('text=GitHub Repository URL')).toBeVisible();
    });

    test('should validate GitHub URL in creation dialog', async ({ page }) => {
      await page.click('button:has-text("Add")');
      
      // Enter invalid URL
      await page.fill('input[placeholder*="github.com"]', 'not-a-valid-url');
      
      // Should show validation error
      await expect(page.locator('text=Enter a GitHub repository URL')).toBeVisible();
      
      // Enter valid URL
      await page.fill('input[placeholder*="github.com"]', 'https://github.com/test-org/test-repo');
      
      // Should show validation success
      await expect(page.locator('text=Valid GitHub repository')).toBeVisible();
      await expect(page.locator('text=test-org/test-repo')).toBeVisible();
    });

    test('should create repository and show in list', async ({ page }) => {
      const testRepoUrl = 'https://github.com/e2e-test/demo-repo';
      
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder*="github.com"]', testRepoUrl);
      
      // Submit form
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Should show success message
      await expect(page.locator('text=added successfully')).toBeVisible();
      
      // Repository should appear in list
      await expect(page.locator('text=e2e-test/demo-repo')).toBeVisible();
      await expect(page.locator('text=0 items')).toBeVisible();
      
      // Should have manage button (gear icon)
      await expect(page.locator('button[title*="Manage"]')).toBeVisible();
    });

    test('should show manage button as gear icon only', async ({ page }) => {
      // Check that repository management buttons use gear icons
      const manageButtons = page.locator('button[title*="Manage"]');
      await expect(manageButtons.first()).toBeVisible();
      
      // Should not contain text, only icon
      const buttonText = await manageButtons.first().textContent();
      expect(buttonText?.trim()).toBe('');
      
      // Should have gear icon
      await expect(manageButtons.first().locator('svg')).toBeVisible();
    });
  });

  test.describe('Repository-specific Secrets Page', () => {
    test.beforeEach(async ({ page }) => {
      // Create a test repository first
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder*="github.com"]', 'https://github.com/e2e-test/secrets-repo');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Wait for success and navigate to manage
      await expect(page.locator('text=added successfully')).toBeVisible();
      await page.click('button[title*="Manage"]');
    });

    test('should display repository-specific secrets page', async ({ page }) => {
      await expect(page.locator('h1')).toContainText('e2e-test/secrets-repo - Secrets');
      await expect(page.locator('text=Repository-scoped secrets')).toBeVisible();
      await expect(page.locator('button:has-text("Add")')).toBeVisible();
    });

    test('should show repository scope field at top of form', async ({ page }) => {
      await page.click('button:has-text("Add")');
      
      // Check form structure
      const form = page.locator('form');
      await expect(form).toBeVisible();
      
      // Repository scope should be first field and show current repository
      const repositoryField = form.locator('text=e2e-test/secrets-repo').first();
      await expect(repositoryField).toBeVisible();
    });

    test('should display toggle switch for secret type', async ({ page }) => {
      await page.click('button:has-text("Add")');
      
      // Should see toggle switch not checkbox
      await expect(page.locator('text=Secret (secure)')).toBeVisible();
      
      // Should see toggle button (not checkbox)
      const toggle = page.locator('button[role="switch"], button:has([class*="toggle"], [class*="switch"])');
      await expect(toggle).toBeVisible();
      
      // Label should always show "Secret (secure)" regardless of toggle state
      await expect(page.locator('text=Secret (secure)')).toBeVisible();
    });

    test('should show dynamic form fields based on secret type', async ({ page }) => {
      await page.click('button:has-text("Add")');
      
      // Initially should be in secret mode (toggle on)
      await expect(page.locator('label:has-text("Domain")')).toBeVisible();
      await expect(page.locator('label:has-text("Auth Type")')).toBeVisible();
      await expect(page.locator('label:has-text("Description")')).toBeVisible();
      
      // Toggle to environment variable mode
      await page.click('button[role="switch"], button:has([class*="toggle"], [class*="switch"])');
      
      // Should hide secret-specific fields
      await expect(page.locator('label:has-text("Domain")')).not.toBeVisible();
      await expect(page.locator('label:has-text("Auth Type")')).not.toBeVisible();
      
      // Should still show name, value, and description
      await expect(page.locator('label:has-text("Name")')).toBeVisible();
      await expect(page.locator('label:has-text("Value")')).toBeVisible();
    });

    test('should create and display secret', async ({ page }) => {
      await page.click('button:has-text("Add")');
      
      // Fill secret form
      await page.fill('input[placeholder="STRIPE_KEY"]', 'TEST_API_KEY');
      await page.fill('input[placeholder="api.stripe.com"]', 'api.test.com');
      await page.fill('input[placeholder*="sk_live"]', 'test-secret-value');
      await page.selectOption('select', 'bearer');
      await page.fill('textarea', 'Test API key for e2e testing');
      
      // Submit
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Should appear in list
      await expect(page.locator('text=TEST_API_KEY')).toBeVisible();
      await expect(page.locator('text=api.test.com')).toBeVisible();
      await expect(page.locator('text=Test API key for e2e testing')).toBeVisible();
    });

    test('should create and display environment variable', async ({ page }) => {
      await page.click('button:has-text("Add")');
      
      // Toggle to environment variable mode
      await page.click('button[role="switch"], button:has([class*="toggle"], [class*="switch"])');
      
      // Fill environment variable form
      await page.fill('input[placeholder="NODE_ENV"]', 'TEST_ENV_VAR');
      await page.fill('input[placeholder="production"]', 'test-value');
      await page.fill('textarea', 'Test environment variable');
      
      // Submit
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Should appear in list with env var styling
      await expect(page.locator('text=TEST_ENV_VAR')).toBeVisible();
      await expect(page.locator('text=Test environment variable')).toBeVisible();
      
      // Should not show domain (since it's an env var)
      await expect(page.locator('text=api.')).not.toBeVisible();
    });

    test('should edit existing secret', async ({ page }) => {
      // First create a secret
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder="STRIPE_KEY"]', 'EDIT_TEST');
      await page.fill('input[placeholder="api.stripe.com"]', 'api.edit.com');
      await page.fill('input[placeholder*="sk_live"]', 'edit-value');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Edit the secret
      await page.click('button[title="Edit"]');
      
      // Should pre-fill form
      await expect(page.locator('input[value="EDIT_TEST"]')).toBeVisible();
      await expect(page.locator('input[value="api.edit.com"]')).toBeVisible();
      
      // Modify description
      await page.fill('textarea', 'Updated description');
      await page.click('button:has-text("Save")');
      
      // Should show updated description
      await expect(page.locator('text=Updated description')).toBeVisible();
    });

    test('should delete secret with confirmation', async ({ page }) => {
      // Create a secret first
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder="STRIPE_KEY"]', 'DELETE_TEST');
      await page.fill('input[placeholder="api.stripe.com"]', 'api.delete.com');
      await page.fill('input[placeholder*="sk_live"]', 'delete-value');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Delete the secret
      await page.click('button[title="Delete"]');
      
      // Should show confirmation dialog
      await expect(page.locator('text=Are you sure')).toBeVisible();
      await page.click('button:has-text("Delete")');
      
      // Should be removed from list
      await expect(page.locator('text=DELETE_TEST')).not.toBeVisible();
    });
  });

  test.describe('Project Creation Integration', () => {
    test('should show repository settings preview in project creation', async ({ page }) => {
      // Create a repository with secrets first
      await page.goto('/repositories');
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder*="github.com"]', 'https://github.com/test/project-integration');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Add a secret to the repository
      await page.click('button[title*="Manage"]');
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder="STRIPE_KEY"]', 'PROJECT_SECRET');
      await page.fill('input[placeholder="api.stripe.com"]', 'api.project.com');
      await page.fill('input[placeholder*="sk_live"]', 'project-value');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Navigate to project creation
      await page.goto('/');
      await page.click('button:has-text("Create Project")');
      
      // Enter the same repository URL
      await page.fill('input[placeholder*="repository"]', 'https://github.com/test/project-integration');
      
      // Should show repository settings preview
      await expect(page.locator('text=Repository Settings')).toBeVisible();
      await expect(page.locator('text=1 setting')).toBeVisible();
      
      // Should have "View details" button
      await expect(page.locator('button:has-text("View details")')).toBeVisible();
    });

    test('should open repository settings modal with details', async ({ page }) => {
      // Assuming we have repository with settings from previous test
      await page.goto('/');
      await page.click('button:has-text("Create Project")');
      await page.fill('input[placeholder*="repository"]', 'https://github.com/test/project-integration');
      
      // Click view details
      await page.click('button:has-text("View details")');
      
      // Should open modal
      await expect(page.locator('text=Repository Settings')).toBeVisible();
      await expect(page.locator('text=PROJECT_SECRET')).toBeVisible();
      await expect(page.locator('text=api.project.com')).toBeVisible();
      
      // Should have close button
      await expect(page.locator('button[aria-label="Close"], button:has(svg)')).toBeVisible();
    });

    test('should close repository settings modal', async ({ page }) => {
      // Open modal (same setup as previous test)
      await page.goto('/');
      await page.click('button:has-text("Create Project")');
      await page.fill('input[placeholder*="repository"]', 'https://github.com/test/project-integration');
      await page.click('button:has-text("View details")');
      
      // Close modal
      await page.click('button[aria-label="Close"], button:has(svg)');
      
      // Modal should be gone
      await expect(page.locator('text=Repository Settings')).not.toBeVisible();
    });
  });

  test.describe('Accessibility and UX', () => {
    test('should have proper form labels and ARIA attributes', async ({ page }) => {
      await page.goto('/repositories');
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder*="github.com"]', 'https://github.com/test/a11y-repo');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      await page.click('button[title*="Manage"]');
      await page.click('button:has-text("Add")');
      
      // Check form accessibility
      await expect(page.locator('label[for="is-secret"], label:has-text("Secret")')).toBeVisible();
      await expect(page.locator('label:has-text("Name")')).toBeVisible();
      await expect(page.locator('label:has-text("Value")')).toBeVisible();
      
      // Toggle should be accessible
      const toggle = page.locator('button[role="switch"], button:has([class*="toggle"])');
      await expect(toggle).toBeVisible();
    });

    test('should show helpful tooltips and descriptions', async ({ page }) => {
      await page.goto('/repositories');
      await page.click('button:has-text("Add")');
      
      // Should show helpful description
      await expect(page.locator('text=Enter a GitHub repository URL')).toBeVisible();
      
      // Fill and submit
      await page.fill('input[placeholder*="github.com"]', 'https://github.com/test/tooltip-repo');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      await page.click('button[title*="Manage"]');
      await page.click('button:has-text("Add")');
      
      // Should show field descriptions
      await expect(page.locator('text=Secret name')).toBeVisible();
      await expect(page.locator('text=Upstream API domain')).toBeVisible();
    });

    test('should handle form validation properly', async ({ page }) => {
      await page.goto('/repositories');
      await page.click('button:has-text("Add")');
      await page.fill('input[placeholder*="github.com"]', 'https://github.com/test/validation-repo');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      await page.click('button[title*="Manage"]');
      await page.click('button:has-text("Add")');
      
      // Try to submit empty form
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Should not submit and show validation
      await expect(page.locator('form')).toBeVisible(); // Form still visible
      
      // Fill required fields
      await page.fill('input[placeholder="STRIPE_KEY"]', 'VALID_NAME');
      await page.fill('input[placeholder*="sk_live"]', 'valid-value');
      
      // For secrets, domain should be required
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      // Should still be in form (domain required)
      
      await page.fill('input[placeholder="api.stripe.com"]', 'api.valid.com');
      await page.click('button:has-text("Add"):not(:has-text("Repository"))');
      
      // Should succeed and return to list
      await expect(page.locator('text=VALID_NAME')).toBeVisible();
    });
  });

  test.afterEach(async ({ page }) => {
    // Clean up any test repositories
    await page.goto('/repositories');
    
    // Delete any test repositories by finding delete buttons and clicking them
    const deleteButtons = page.locator('button[title*="Delete"]');
    const count = await deleteButtons.count();
    
    for (let i = 0; i < count; i++) {
      try {
        await deleteButtons.nth(i).click({ timeout: 1000 });
        await page.click('button:has-text("Delete")', { timeout: 1000 });
      } catch {
        // Ignore errors during cleanup
      }
    }
  });
});