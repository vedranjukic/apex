/**
 * Integration tests for offline mode functionality
 * 
 * These tests verify that all components (network store, hooks, UI components)
 * work together properly and provide the expected offline behavior.
 */

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import React from 'react';

import { useNetworkStatus } from '../../hooks/use-network-status';
import { NetworkStatusIndicator, NetworkStatusBanner } from '../../components/layout/network-status-indicator';
import { NetworkTestUtils, NetworkTestScenarios, NetworkAssertions } from '../../test-utils/network-testing-utils';
import { ReconnectingWebSocket } from '../../lib/reconnecting-ws';

// Mock timers for testing
jest.useFakeTimers();

// Test component that uses network integration
const TestNetworkAwareComponent: React.FC = () => {
  const {
    isOnline,
    connectionType,
    socketConnected,
    isFullyConnected,
    canPerformOnlineActions,
    shouldShowNetworkWarning,
    connectionFailures,
    timeSinceLastOnline,
  } = useNetworkStatus();

  return (
    <div data-testid="network-component">
      <div data-testid="is-online">{isOnline.toString()}</div>
      <div data-testid="connection-type">{connectionType}</div>
      <div data-testid="socket-connected">{socketConnected.toString()}</div>
      <div data-testid="is-fully-connected">{isFullyConnected.toString()}</div>
      <div data-testid="can-perform-actions">{canPerformOnlineActions.toString()}</div>
      <div data-testid="should-show-warning">{shouldShowNetworkWarning.toString()}</div>
      <div data-testid="connection-failures">{connectionFailures}</div>
      <div data-testid="time-since-online">{timeSinceLastOnline || 'null'}</div>
      
      {/* Network UI components */}
      <NetworkStatusIndicator data-testid="status-indicator" />
      <NetworkStatusIndicator showText data-testid="status-indicator-with-text" />
      <NetworkStatusBanner data-testid="status-banner" />
      
      {/* Action buttons */}
      <button 
        disabled={!canPerformOnlineActions}
        data-testid="online-action-button"
      >
        Online Action
      </button>
      
      <button data-testid="offline-action-button">
        Offline Action
      </button>
    </div>
  );
};

describe('Offline Mode Integration', () => {
  let originalFetch: typeof global.fetch;
  let mockWS: any;

  beforeEach(() => {
    NetworkTestUtils.cleanup();
    originalFetch = NetworkTestUtils.mockFetch(true, 100);
    mockWS = NetworkTestUtils.createMockWebSocket();
  });

  afterEach(() => {
    NetworkTestUtils.cleanup();
    NetworkTestUtils.restoreFetch(originalFetch);
    jest.clearAllTimers();
  });

  describe('Full Integration Flow', () => {
    it('should handle complete offline to online flow', async () => {
      // Start offline
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.BROWSER_OFFLINE);
      
      const { rerender } = render(<TestNetworkAwareComponent />);
      
      // Verify offline state
      expect(screen.getByTestId('is-online')).toHaveTextContent('false');
      expect(screen.getByTestId('connection-type')).toHaveTextContent('offline');
      expect(screen.getByTestId('can-perform-actions')).toHaveTextContent('false');
      expect(screen.getByTestId('online-action-button')).toBeDisabled();
      
      // Should show offline banner
      expect(screen.getByTestId('status-banner')).toBeInTheDocument();
      expect(screen.getByText('You are offline. Some features may not work properly.')).toBeInTheDocument();
      
      // Go online (browser)
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('online');
      });
      
      rerender(<TestNetworkAwareComponent />);
      
      // Should be in reconnecting state
      await waitFor(() => {
        expect(screen.getByTestId('connection-type')).toHaveTextContent('reconnecting');
        expect(screen.getByTestId('can-perform-actions')).toHaveTextContent('false');
      });
      
      // Connect socket
      const reconnectingWS = new ReconnectingWebSocket('/test');
      act(() => {
        mockWS.triggerOpen();
      });
      
      rerender(<TestNetworkAwareComponent />);
      
      // Should be fully online
      await waitFor(() => {
        expect(screen.getByTestId('is-online')).toHaveTextContent('true');
        expect(screen.getByTestId('connection-type')).toHaveTextContent('online');
        expect(screen.getByTestId('socket-connected')).toHaveTextContent('true');
        expect(screen.getByTestId('can-perform-actions')).toHaveTextContent('true');
        expect(screen.getByTestId('online-action-button')).not.toBeDisabled();
      });
      
      // Banner should be hidden
      expect(screen.queryByTestId('status-banner')).toBeEmptyDOMElement();
      
      reconnectingWS.destroy();
    });

    it('should handle socket disconnection while browser is online', async () => {
      // Start fully online
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.FULLY_ONLINE);
      
      render(<TestNetworkAwareComponent />);
      
      // Verify fully online state
      await waitFor(() => {
        expect(screen.getByTestId('connection-type')).toHaveTextContent('online');
        expect(screen.getByTestId('can-perform-actions')).toHaveTextContent('true');
      });
      
      // Create WebSocket and connect
      const reconnectingWS = new ReconnectingWebSocket('/test');
      act(() => {
        mockWS.triggerOpen();
      });
      
      // Disconnect socket
      act(() => {
        mockWS.triggerClose();
      });
      
      // Should enter reconnecting state
      await waitFor(() => {
        expect(screen.getByTestId('connection-type')).toHaveTextContent('reconnecting');
        expect(screen.getByTestId('can-perform-actions')).toHaveTextContent('false');
      });
      
      // Should show reconnecting banner
      expect(screen.getByText('Reconnecting to server...')).toBeInTheDocument();
      
      reconnectingWS.destroy();
    });

    it('should handle connectivity issues and recovery', async () => {
      // Start with connectivity issues
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.CONNECTIVITY_ISSUES);
      
      render(<TestNetworkAwareComponent />);
      
      // Should show connectivity issues
      await waitFor(() => {
        expect(screen.getByTestId('connection-failures')).toHaveTextContent('5');
      });
      
      // Should show warning banner
      expect(screen.getByText('Connection issues detected. Some features may be unstable.')).toBeInTheDocument();
      
      // Recovery - reset failures by successful connection
      act(() => {
        const { result } = renderHook(() => useNetworkStatus());
        result.current.handleSocketConnected();
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('connection-failures')).toHaveTextContent('0');
      });
    });
  });

  describe('UI Component Integration', () => {
    it('should show correct status indicators for different states', async () => {
      const testCases = [
        {
          scenario: NetworkTestScenarios.FULLY_ONLINE,
          expectedType: 'online',
          expectedIcon: 'Wifi',
          expectedText: 'Connected',
        },
        {
          scenario: NetworkTestScenarios.RECONNECTING,
          expectedType: 'reconnecting',
          expectedIcon: 'RotateCw',
          expectedText: 'Reconnecting',
        },
        {
          scenario: NetworkTestScenarios.BROWSER_OFFLINE,
          expectedType: 'offline',
          expectedIcon: 'WifiOff',
          expectedText: 'Offline',
        },
      ];

      for (const testCase of testCases) {
        NetworkTestUtils.simulateNetworkState(testCase.scenario);
        
        const { rerender } = render(<TestNetworkAwareComponent />);
        
        await waitFor(() => {
          expect(screen.getByTestId('connection-type')).toHaveTextContent(testCase.expectedType);
        });
        
        // Check that the status indicator with text shows the expected text
        const indicatorWithText = screen.getByTestId('status-indicator-with-text');
        expect(indicatorWithText).toHaveTextContent(testCase.expectedText);
        
        rerender(<div />); // Unmount before next test
      }
    });

    it('should handle tooltip information correctly', async () => {
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.CONNECTIVITY_ISSUES);
      
      render(<TestNetworkAwareComponent />);
      
      const statusIndicator = screen.getByTestId('status-indicator');
      
      // Should have tooltip with failure information
      expect(statusIndicator).toHaveAttribute('title');
      const title = statusIndicator.getAttribute('title');
      expect(title).toContain('5 connection failures');
    });

    it('should show/hide banners appropriately', async () => {
      // Test different scenarios and their banner visibility
      const scenarios = [
        { scenario: NetworkTestScenarios.FULLY_ONLINE, shouldShowBanner: false },
        { scenario: NetworkTestScenarios.BROWSER_OFFLINE, shouldShowBanner: true },
        { scenario: NetworkTestScenarios.RECONNECTING, shouldShowBanner: true },
        { scenario: NetworkTestScenarios.CONNECTIVITY_ISSUES, shouldShowBanner: true },
      ];

      for (const { scenario, shouldShowBanner } of scenarios) {
        NetworkTestUtils.simulateNetworkState(scenario);
        
        const { rerender } = render(<TestNetworkAwareComponent />);
        
        const banner = screen.getByTestId('status-banner');
        
        if (shouldShowBanner) {
          expect(banner).not.toBeEmptyDOMElement();
        } else {
          expect(banner).toBeEmptyDOMElement();
        }
        
        rerender(<div />); // Unmount before next test
      }
    });
  });

  describe('Action Button States', () => {
    it('should enable/disable action buttons based on network state', async () => {
      const scenarios = [
        { scenario: NetworkTestScenarios.FULLY_ONLINE, shouldEnableOnlineActions: true },
        { scenario: NetworkTestScenarios.BROWSER_OFFLINE, shouldEnableOnlineActions: false },
        { scenario: NetworkTestScenarios.SOCKET_DISCONNECTED, shouldEnableOnlineActions: false },
        { scenario: NetworkTestScenarios.RECONNECTING, shouldEnableOnlineActions: false },
      ];

      for (const { scenario, shouldEnableOnlineActions } of scenarios) {
        NetworkTestUtils.simulateNetworkState(scenario);
        
        const { rerender } = render(<TestNetworkAwareComponent />);
        
        const onlineActionButton = screen.getByTestId('online-action-button');
        const offlineActionButton = screen.getByTestId('offline-action-button');
        
        if (shouldEnableOnlineActions) {
          expect(onlineActionButton).not.toBeDisabled();
        } else {
          expect(onlineActionButton).toBeDisabled();
        }
        
        // Offline actions should always be enabled
        expect(offlineActionButton).not.toBeDisabled();
        
        rerender(<div />); // Unmount before next test
      }
    });
  });

  describe('Real-time Updates', () => {
    it('should update UI in real-time as network state changes', async () => {
      render(<TestNetworkAwareComponent />);
      
      // Start online
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.FULLY_ONLINE);
      
      await waitFor(() => {
        expect(screen.getByTestId('connection-type')).toHaveTextContent('online');
      });
      
      // Go offline
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('connection-type')).toHaveTextContent('offline');
      });
      
      // Go back online
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('online');
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('connection-type')).toHaveTextContent('reconnecting');
      });
    });

    it('should handle rapid state changes without errors', async () => {
      render(<TestNetworkAwareComponent />);
      
      // Rapid state changes
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
        NetworkTestUtils.triggerNetworkEvent('online');
        NetworkTestUtils.triggerNetworkEvent('offline');
        NetworkTestUtils.triggerNetworkEvent('online');
      });
      
      // Should settle in correct final state
      await waitFor(() => {
        expect(screen.getByTestId('is-online')).toHaveTextContent('true');
      });
      
      // Component should not crash
      expect(screen.getByTestId('network-component')).toBeInTheDocument();
    });
  });

  describe('Memory and Performance', () => {
    it('should clean up timers and listeners on unmount', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const { unmount } = render(<TestNetworkAwareComponent />);
      
      unmount();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(window.removeEventListener).toHaveBeenCalled();
    });

    it('should handle multiple component instances correctly', () => {
      // Render multiple instances
      const { container } = render(
        <div>
          <TestNetworkAwareComponent />
          <TestNetworkAwareComponent />
          <TestNetworkAwareComponent />
        </div>
      );
      
      // All should show the same state
      const connectionTypes = container.querySelectorAll('[data-testid="connection-type"]');
      expect(connectionTypes).toHaveLength(3);
      
      connectionTypes.forEach(element => {
        expect(element).toHaveTextContent('online');
      });
      
      // Change state
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
      });
      
      // All should update
      connectionTypes.forEach(element => {
        expect(element).toHaveTextContent('offline');
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle WebSocket creation failure gracefully', () => {
      // Mock WebSocket constructor to throw
      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn(() => {
        throw new Error('WebSocket creation failed');
      });
      
      expect(() => {
        const reconnectingWS = new ReconnectingWebSocket('/test');
        reconnectingWS.destroy();
      }).not.toThrow();
      
      global.WebSocket = originalWebSocket;
    });

    it('should handle malformed WebSocket messages gracefully', () => {
      const reconnectingWS = new ReconnectingWebSocket('/test');
      const messageHandler = jest.fn();
      
      reconnectingWS.on('test', messageHandler);
      
      // Connect
      act(() => {
        mockWS.triggerOpen();
      });
      
      // Send malformed message
      expect(() => {
        if (mockWS.onmessage) {
          mockWS.onmessage({ data: 'not json' } as MessageEvent);
        }
      }).not.toThrow();
      
      expect(messageHandler).not.toHaveBeenCalled();
      
      reconnectingWS.destroy();
    });

    it('should handle fetch timeout and errors gracefully', async () => {
      NetworkTestUtils.mockFetch(false, 6000); // Will fail and timeout
      
      render(<TestNetworkAwareComponent />);
      
      // Advance time to trigger connectivity check and timeout
      act(() => {
        jest.advanceTimersByTime(35000); // 30s interval + 5s timeout
      });
      
      // Should not crash and should handle the error
      await waitFor(() => {
        expect(screen.getByTestId('network-component')).toBeInTheDocument();
      });
    });
  });

  describe('Backward Compatibility', () => {
    it('should not break existing code that does not use network features', () => {
      // Simple component without network awareness
      const SimpleComponent = () => <div data-testid="simple">Works</div>;
      
      const { rerender } = render(<SimpleComponent />);
      
      // Change network state
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
      });
      
      rerender(<SimpleComponent />);
      
      // Should still work
      expect(screen.getByTestId('simple')).toHaveTextContent('Works');
    });

    it('should maintain existing WebSocket behavior when not using ReconnectingWebSocket', () => {
      // Test that regular WebSocket still works
      const ws = new WebSocket('ws://localhost/test');
      expect(ws).toBeDefined();
    });
  });
});