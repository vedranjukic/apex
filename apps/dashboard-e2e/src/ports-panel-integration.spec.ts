/**
 * E2E Integration Tests: Ports Panel UI
 *
 * Tests the user interface components for port relay functionality including:
 *   1. Ports panel display and interaction
 *   2. Port status indicators and real-time updates
 *   3. Localhost URL generation and copying
 *   4. Daytona preview URL button functionality
 *   5. Auto-forward toggle and configuration
 *   6. Error handling and user feedback
 *   7. Integration with WebSocket events
 *
 * Run: npx nx e2e @apex/dashboard-e2e --testPathPattern=ports-panel-integration
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:6000';

// Test data and utilities
const TEST_CONFIG = {
  timeout: 30000,
  shortTimeout: 5000,
  retryDelay: 500
};

// ── Test Utilities ──────────────────────────────────────────

/**
 * Wait for element with retry logic
 */
async function waitForElement(page: Page, selector: string, timeout = TEST_CONFIG.timeout) {
  await expect(page.locator(selector)).toBeVisible({ timeout });
}

/**
 * Wait for text content
 */
async function waitForText(page: Page, selector: string, text: string, timeout = TEST_CONFIG.timeout) {
  await expect(page.locator(selector)).toContainText(text, { timeout });
}

/**
 * Simulate project selection
 */
async function selectProject(page: Page, projectName = 'Test Project') {
  // This would depend on your actual project selection UI
  await page.click('[data-testid="project-selector"]');
  await page.click(`[data-testid="project-option"][data-project-name="${projectName}"]`);
  await waitForElement(page, '[data-testid="ports-panel"]');
}

/**
 * Mock WebSocket events for testing
 */
async function mockWebSocketEvents(page: Page, events: any[]) {
  await page.evaluate((eventsData) => {
    // Mock WebSocket or Socket.IO events
    if (window.mockSocket) {
      eventsData.forEach(event => {
        window.mockSocket.emit(event.type, event.data);
      });
    }
  }, events);
}

/**
 * Setup test project and ports
 */
async function setupTestProject(page: Page) {
  const mockProject = {
    id: 'test-project-1',
    name: 'Test Project',
    sandboxId: 'test-sandbox-1',
    provider: 'docker'
  };

  const mockPorts = [
    { port: 3000, protocol: 'http', isActive: true },
    { port: 3001, protocol: 'https', isActive: true },
    { port: 8080, protocol: 'http', isActive: false }
  ];

  await page.evaluate((data) => {
    // Set up mock data in the application state
    if (window.testHelpers) {
      window.testHelpers.setMockProject(data.project);
      window.testHelpers.setMockPorts(data.ports);
    }
  }, { project: mockProject, ports: mockPorts });

  return { mockProject, mockPorts };
}

// ── Main Test Suite ──────────────────────────────────────────

test.describe('Ports Panel Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to application
    await page.goto(BASE_URL);
    
    // Wait for application to load
    await waitForElement(page, '[data-testid="app-container"]');
    
    // Setup test project
    await setupTestProject(page);
  });

  // ── Basic Ports Panel Display ───────────────────────────────

  test.describe('Basic Ports Panel Display', () => {
    test('should display ports panel in bottom terminal section', async ({ page }) => {
      // Click on ports tab in terminal panel
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Verify ports panel is visible
      await waitForElement(page, '[data-testid="ports-panel"]');
      
      // Should have header with port count
      await waitForElement(page, '[data-testid="ports-panel-header"]');
      await waitForText(page, '[data-testid="ports-count"]', '3 ports');
    });

    test('should display individual port entries with correct information', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Check for port entries
      const portEntries = page.locator('[data-testid^="port-entry-"]');
      await expect(portEntries).toHaveCount(3);
      
      // Verify first port (3000)
      const port3000 = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000).toBeVisible();
      await expect(port3000.locator('[data-testid="port-number"]')).toContainText('3000');
      await expect(port3000.locator('[data-testid="port-protocol"]')).toContainText('HTTP');
      await expect(port3000.locator('[data-testid="port-status"]')).toContainText('Active');
      
      // Verify localhost URL is shown
      await expect(port3000.locator('[data-testid="localhost-url"]')).toContainText('http://localhost:');
    });

    test('should show correct status indicators for active and inactive ports', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Active port should have green indicator
      const activePort = page.locator('[data-testid="port-entry-3000"]');
      await expect(activePort.locator('[data-testid="status-indicator"]')).toHaveClass(/text-green|bg-green/);
      
      // Inactive port should have gray indicator  
      const inactivePort = page.locator('[data-testid="port-entry-8080"]');
      await expect(inactivePort.locator('[data-testid="status-indicator"]')).toHaveClass(/text-gray|bg-gray/);
    });

    test('should display empty state when no ports are detected', async ({ page }) => {
      // Clear ports
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setMockPorts([]);
        }
      });
      
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Should show empty state
      await waitForElement(page, '[data-testid="ports-empty-state"]');
      await waitForText(page, '[data-testid="ports-empty-message"]', 'No ports detected');
    });
  });

  // ── Localhost URL Functionality ─────────────────────────────

  test.describe('Localhost URL Functionality', () => {
    test('should generate correct localhost URLs for forwarded ports', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Mock port forwarding response
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setPortForwarding(3000, 9000);
          window.testHelpers.setPortForwarding(3001, 9001);
        }
      });
      
      // URLs should be updated to show forwarded ports
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000Entry.locator('[data-testid="localhost-url"]')).toContainText('http://localhost:9000');
      
      const port3001Entry = page.locator('[data-testid="port-entry-3001"]');
      await expect(port3001Entry.locator('[data-testid="localhost-url"]')).toContainText('https://localhost:9001');
    });

    test('should copy localhost URL to clipboard', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Mock clipboard API
      let clipboardText = '';
      await page.evaluate(() => {
        window.navigator.clipboard = {
          writeText: (text) => {
            window.lastClipboardText = text;
            return Promise.resolve();
          }
        };
      });
      
      // Click copy button for port 3000
      await page.click('[data-testid="port-entry-3000"] [data-testid="copy-url-button"]');
      
      // Should show success feedback
      await waitForElement(page, '[data-testid="copy-success-toast"]');
      
      // Verify clipboard content
      const clipboardContent = await page.evaluate(() => window.lastClipboardText);
      expect(clipboardContent).toContain('localhost:');
    });

    test('should open localhost URL in new tab', async ({ page, context }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Mock successful forwarding
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setPortForwarding(3000, 9000);
        }
      });
      
      // Listen for new tab
      const pagePromise = context.waitForEvent('page');
      
      // Click open URL button
      await page.click('[data-testid="port-entry-3000"] [data-testid="open-url-button"]');
      
      const newPage = await pagePromise;
      expect(newPage.url()).toContain('localhost:9000');
      await newPage.close();
    });

    test('should show loading state during port forwarding setup', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Simulate forwarding in progress
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setPortForwardingStatus(3000, 'pending');
        }
      });
      
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000Entry.locator('[data-testid="forwarding-spinner"]')).toBeVisible();
      await expect(port3000Entry.locator('[data-testid="localhost-url"]')).toContainText('Setting up...');
    });

    test('should show error state when port forwarding fails', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Simulate forwarding error
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setPortForwardingStatus(3000, 'failed');
          window.testHelpers.setPortForwardingError(3000, 'Port already in use');
        }
      });
      
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000Entry.locator('[data-testid="error-indicator"]')).toBeVisible();
      await expect(port3000Entry.locator('[data-testid="error-message"]')).toContainText('Port already in use');
    });
  });

  // ── Daytona Preview URL Button ──────────────────────────────

  test.describe('Daytona Preview URL Button', () => {
    test('should show Daytona preview button for Daytona provider projects', async ({ page }) => {
      // Set up Daytona project
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setMockProject({
            id: 'daytona-project',
            name: 'Daytona Project',
            sandboxId: 'daytona-sandbox',
            provider: 'daytona'
          });
        }
      });
      
      await page.click('[data-testid="terminal-tab-ports"]');
      
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000Entry.locator('[data-testid="daytona-preview-button"]')).toBeVisible();
    });

    test('should hide Daytona preview button for non-Daytona providers', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000Entry.locator('[data-testid="daytona-preview-button"]')).not.toBeVisible();
    });

    test('should generate Daytona preview URL', async ({ page }) => {
      // Set up Daytona project
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setMockProject({
            id: 'daytona-project',
            name: 'Daytona Project', 
            sandboxId: 'daytona-sandbox',
            provider: 'daytona'
          });
        }
      });
      
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Mock Daytona preview URL generation
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.mockDaytonaPreviewUrl = 'https://3000-daytona-sandbox.daytona.app';
        }
      });
      
      // Click Daytona preview button
      await page.click('[data-testid="port-entry-3000"] [data-testid="daytona-preview-button"]');
      
      // Should show generated URL
      await waitForElement(page, '[data-testid="daytona-preview-modal"]');
      await waitForText(page, '[data-testid="preview-url"]', 'https://3000-daytona-sandbox.daytona.app');
    });

    test('should copy Daytona preview URL to clipboard', async ({ page }) => {
      // Set up Daytona project
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setMockProject({
            id: 'daytona-project',
            name: 'Daytona Project',
            sandboxId: 'daytona-sandbox', 
            provider: 'daytona'
          });
          window.testHelpers.mockDaytonaPreviewUrl = 'https://3000-daytona-sandbox.daytona.app';
        }
      });
      
      // Mock clipboard
      await page.evaluate(() => {
        window.navigator.clipboard = {
          writeText: (text) => {
            window.lastClipboardText = text;
            return Promise.resolve();
          }
        };
      });
      
      await page.click('[data-testid="terminal-tab-ports"]');
      await page.click('[data-testid="port-entry-3000"] [data-testid="daytona-preview-button"]');
      
      // Copy preview URL
      await page.click('[data-testid="copy-preview-url-button"]');
      
      const clipboardContent = await page.evaluate(() => window.lastClipboardText);
      expect(clipboardContent).toBe('https://3000-daytona-sandbox.daytona.app');
    });

    test('should open Daytona preview URL in new tab', async ({ page, context }) => {
      // Set up Daytona project
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setMockProject({
            id: 'daytona-project',
            name: 'Daytona Project',
            sandboxId: 'daytona-sandbox',
            provider: 'daytona'
          });
          window.testHelpers.mockDaytonaPreviewUrl = 'https://3000-daytona-sandbox.daytona.app';
        }
      });
      
      await page.click('[data-testid="terminal-tab-ports"]');
      await page.click('[data-testid="port-entry-3000"] [data-testid="daytona-preview-button"]');
      
      const pagePromise = context.waitForEvent('page');
      await page.click('[data-testid="open-preview-url-button"]');
      
      const newPage = await pagePromise;
      expect(newPage.url()).toBe('https://3000-daytona-sandbox.daytona.app');
      await newPage.close();
    });
  });

  // ── Auto-Forward Configuration ──────────────────────────────

  test.describe('Auto-Forward Configuration', () => {
    test('should display auto-forward toggle', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      await waitForElement(page, '[data-testid="auto-forward-toggle"]');
      
      // Should be initially disabled
      const toggle = page.locator('[data-testid="auto-forward-toggle"]');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    test('should enable auto-forward when toggle is clicked', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      const toggle = page.locator('[data-testid="auto-forward-toggle"]');
      await toggle.click();
      
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      
      // Should show success notification
      await waitForElement(page, '[data-testid="auto-forward-enabled-toast"]');
    });

    test('should disable auto-forward when toggle is clicked again', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      const toggle = page.locator('[data-testid="auto-forward-toggle"]');
      
      // Enable first
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      
      // Disable
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      
      await waitForElement(page, '[data-testid="auto-forward-disabled-toast"]');
    });

    test('should show auto-forward settings modal', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Click settings button
      await page.click('[data-testid="auto-forward-settings-button"]');
      
      await waitForElement(page, '[data-testid="auto-forward-settings-modal"]');
      
      // Should show configuration options
      await expect(page.locator('[data-testid="excluded-ports-input"]')).toBeVisible();
      await expect(page.locator('[data-testid="max-forwards-input"]')).toBeVisible();
    });

    test('should save auto-forward settings', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      await page.click('[data-testid="auto-forward-settings-button"]');
      
      // Update settings
      await page.fill('[data-testid="excluded-ports-input"]', '8080, 8443, 9000');
      await page.fill('[data-testid="max-forwards-input"]', '5');
      
      // Save settings
      await page.click('[data-testid="save-settings-button"]');
      
      // Modal should close
      await expect(page.locator('[data-testid="auto-forward-settings-modal"]')).not.toBeVisible();
      
      // Should show success toast
      await waitForElement(page, '[data-testid="settings-saved-toast"]');
    });
  });

  // ── Real-time Updates and WebSocket Integration ─────────────

  test.describe('Real-time Updates', () => {
    test('should update port list when new ports are detected', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Initial port count
      await waitForText(page, '[data-testid="ports-count"]', '3 ports');
      
      // Simulate new port detection via WebSocket
      await mockWebSocketEvents(page, [{
        type: 'ports_updated',
        data: [
          { port: 3000, protocol: 'http', isActive: true },
          { port: 3001, protocol: 'https', isActive: true },
          { port: 8080, protocol: 'http', isActive: false },
          { port: 5000, protocol: 'http', isActive: true } // New port
        ]
      }]);
      
      // Should update to show 4 ports
      await waitForText(page, '[data-testid="ports-count"]', '4 ports');
      await waitForElement(page, '[data-testid="port-entry-5000"]');
    });

    test('should update port status when forwarding state changes', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      
      // Initially not forwarded
      await expect(port3000Entry.locator('[data-testid="localhost-url"]')).toContainText('Not forwarded');
      
      // Simulate forwarding started
      await mockWebSocketEvents(page, [{
        type: 'port_forwarding_updated',
        data: {
          port: 3000,
          localPort: 9000,
          status: 'active'
        }
      }]);
      
      // Should update to show forwarded URL
      await expect(port3000Entry.locator('[data-testid="localhost-url"]')).toContainText('http://localhost:9000');
    });

    test('should show real-time connection count', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      
      // Simulate connection updates
      await mockWebSocketEvents(page, [{
        type: 'port_connection_update',
        data: {
          port: 3000,
          connections: 2
        }
      }]);
      
      await expect(port3000Entry.locator('[data-testid="connection-count"]')).toContainText('2 connections');
    });

    test('should handle WebSocket disconnection gracefully', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Simulate WebSocket disconnection
      await page.evaluate(() => {
        if (window.socket) {
          window.socket.disconnect();
        }
      });
      
      // Should show connection status indicator
      await waitForElement(page, '[data-testid="connection-status-disconnected"]');
      
      // Simulate reconnection
      await page.evaluate(() => {
        if (window.socket) {
          window.socket.connect();
        }
      });
      
      await waitForElement(page, '[data-testid="connection-status-connected"]');
    });
  });

  // ── Error Handling and User Feedback ───────────────────────

  test.describe('Error Handling and User Feedback', () => {
    test('should show error when port forwarding fails', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Click to start forwarding
      await page.click('[data-testid="port-entry-3000"] [data-testid="start-forwarding-button"]');
      
      // Simulate forwarding error
      await mockWebSocketEvents(page, [{
        type: 'port_forwarding_error',
        data: {
          port: 3000,
          error: 'Port already in use'
        }
      }]);
      
      // Should show error in UI
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000Entry.locator('[data-testid="error-message"]')).toContainText('Port already in use');
      await expect(port3000Entry.locator('[data-testid="retry-button"]')).toBeVisible();
    });

    test('should allow retry after forwarding failure', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Set up error state
      await page.evaluate(() => {
        if (window.testHelpers) {
          window.testHelpers.setPortForwardingStatus(3000, 'failed');
          window.testHelpers.setPortForwardingError(3000, 'Connection timeout');
        }
      });
      
      const port3000Entry = page.locator('[data-testid="port-entry-3000"]');
      await expect(port3000Entry.locator('[data-testid="retry-button"]')).toBeVisible();
      
      // Click retry
      await page.click('[data-testid="port-entry-3000"] [data-testid="retry-button"]');
      
      // Should show loading state
      await expect(port3000Entry.locator('[data-testid="forwarding-spinner"]')).toBeVisible();
    });

    test('should show validation errors for invalid port configurations', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      await page.click('[data-testid="auto-forward-settings-button"]');
      
      // Enter invalid excluded ports
      await page.fill('[data-testid="excluded-ports-input"]', 'invalid-port');
      await page.click('[data-testid="save-settings-button"]');
      
      // Should show validation error
      await waitForElement(page, '[data-testid="validation-error"]');
      await waitForText(page, '[data-testid="validation-error"]', 'Invalid port number');
    });

    test('should handle network errors gracefully', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Simulate network error
      await page.route('**/api/ports/**', route => route.abort('failed'));
      
      // Try to perform action that requires API call
      await page.click('[data-testid="port-entry-3000"] [data-testid="start-forwarding-button"]');
      
      // Should show network error
      await waitForElement(page, '[data-testid="network-error-toast"]');
      await waitForText(page, '[data-testid="network-error-toast"]', 'Network error');
    });
  });

  // ── Accessibility and Responsive Design ────────────────────

  test.describe('Accessibility and Responsive Design', () => {
    test('should have proper ARIA labels and keyboard navigation', async ({ page }) => {
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Check ARIA labels
      const toggle = page.locator('[data-testid="auto-forward-toggle"]');
      await expect(toggle).toHaveAttribute('role', 'switch');
      await expect(toggle).toHaveAttribute('aria-labelledby');
      
      // Test keyboard navigation
      await page.keyboard.press('Tab');
      // Should focus on first interactive element
      await expect(toggle).toBeFocused();
      
      // Space should toggle
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    test('should work correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Panel should be responsive
      await waitForElement(page, '[data-testid="ports-panel"]');
      
      // Port entries should stack vertically on mobile
      const portEntries = page.locator('[data-testid^="port-entry-"]');
      const firstEntry = portEntries.first();
      const secondEntry = portEntries.nth(1);
      
      const firstBox = await firstEntry.boundingBox();
      const secondBox = await secondEntry.boundingBox();
      
      if (firstBox && secondBox) {
        // Second entry should be below first (vertical stacking)
        expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height);
      }
    });

    test('should support high contrast mode', async ({ page }) => {
      // Simulate high contrast mode
      await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
      
      await page.click('[data-testid="terminal-tab-ports"]');
      
      // Elements should be visible in high contrast
      await waitForElement(page, '[data-testid="ports-panel"]');
      
      const portEntry = page.locator('[data-testid="port-entry-3000"]');
      await expect(portEntry).toBeVisible();
      
      // Status indicators should have proper contrast
      const statusIndicator = portEntry.locator('[data-testid="status-indicator"]');
      await expect(statusIndicator).toBeVisible();
    });
  });
});