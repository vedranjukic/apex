/**
 * Tests for useNetworkStatus hook
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useNetworkStatus } from '../use-network-status';
import { NetworkTestUtils, NetworkTestScenarios } from '../../test-utils/network-testing-utils';

// Mock timers for testing
jest.useFakeTimers();

describe('useNetworkStatus', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    NetworkTestUtils.cleanup();
    originalFetch = NetworkTestUtils.mockFetch(true, 100);
  });

  afterEach(() => {
    NetworkTestUtils.cleanup();
    NetworkTestUtils.restoreFetch(originalFetch);
    jest.clearAllTimers();
  });

  describe('Initialization', () => {
    it('should initialize with navigator.onLine status', () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      const { result } = renderHook(() => useNetworkStatus());
      
      expect(result.current.isOnline).toBe(true);
      expect(result.current.connectionType).toBe('online');
      expect(result.current.socketConnected).toBe(false);
    });

    it('should set up event listeners for online/offline events', () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      renderHook(() => useNetworkStatus());
      
      // Check that addEventListener was called for online/offline events
      expect(window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(window.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    });
  });

  describe('Network Event Handling', () => {
    it('should handle online event', async () => {
      NetworkTestUtils.mockNavigatorOnLine(false);
      const { result } = renderHook(() => useNetworkStatus());
      
      expect(result.current.isOnline).toBe(false);
      
      // Trigger online event
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('online');
      });
      
      await waitFor(() => {
        expect(result.current.isOnline).toBe(true);
        expect(result.current.connectionFailures).toBe(0);
      });
    });

    it('should handle offline event', async () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      const { result } = renderHook(() => useNetworkStatus());
      
      expect(result.current.isOnline).toBe(true);
      
      // Trigger offline event
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
      });
      
      await waitFor(() => {
        expect(result.current.isOnline).toBe(false);
        expect(result.current.connectionType).toBe('offline');
      });
    });
  });

  describe('Periodic Connectivity Check', () => {
    it('should perform periodic connectivity check when online', async () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      NetworkTestUtils.mockFetch(true, 0);
      
      renderHook(() => useNetworkStatus());
      
      // Fast-forward 30 seconds (online check interval)
      act(() => {
        jest.advanceTimersByTime(30000);
      });
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/health', {
          method: 'HEAD',
          signal: expect.any(AbortSignal),
          cache: 'no-cache',
        });
      });
    });

    it('should check more frequently when offline', () => {
      NetworkTestUtils.mockNavigatorOnLine(false);
      const { result } = renderHook(() => useNetworkStatus());
      
      expect(result.current.isOnline).toBe(false);
      
      // Fast-forward 10 seconds (offline check interval)
      act(() => {
        jest.advanceTimersByTime(10000);
      });
      
      // Offline state should trigger more frequent checks
      expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 10000);
    });

    it('should increment failures when connectivity check fails', async () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      NetworkTestUtils.mockFetch(false);
      const { result } = renderHook(() => useNetworkStatus());
      
      const initialFailures = result.current.connectionFailures;
      
      // Fast-forward to trigger connectivity check
      act(() => {
        jest.advanceTimersByTime(30000);
      });
      
      // Wait for fetch to fail and failure to be recorded
      await waitFor(() => {
        expect(result.current.connectionFailures).toBe(initialFailures + 1);
      });
    });
  });

  describe('Socket Integration Helpers', () => {
    it('should provide socket connected handler', () => {
      const { result } = renderHook(() => useNetworkStatus());
      
      act(() => {
        result.current.handleSocketConnected();
      });
      
      expect(result.current.socketConnected).toBe(true);
    });

    it('should provide socket disconnected handler', () => {
      const { result } = renderHook(() => useNetworkStatus());
      
      // First connect
      act(() => {
        result.current.handleSocketConnected();
      });
      
      expect(result.current.socketConnected).toBe(true);
      
      // Then disconnect
      act(() => {
        result.current.handleSocketDisconnected();
      });
      
      expect(result.current.socketConnected).toBe(false);
    });

    it('should provide socket reconnecting handler', () => {
      const { result } = renderHook(() => useNetworkStatus());
      
      act(() => {
        result.current.handleSocketReconnecting();
      });
      
      expect(result.current.isReconnecting).toBe(true);
      expect(result.current.connectionType).toBe('reconnecting');
    });

    it('should provide connection error handler', () => {
      const { result } = renderHook(() => useNetworkStatus());
      
      const initialFailures = result.current.connectionFailures;
      
      act(() => {
        result.current.handleConnectionError();
      });
      
      expect(result.current.connectionFailures).toBe(initialFailures + 1);
    });
  });

  describe('Computed Properties', () => {
    it('should calculate isFullyConnected correctly', () => {
      const { result } = renderHook(() => useNetworkStatus());
      
      // Initially not fully connected (socket not connected)
      expect(result.current.isFullyConnected).toBe(false);
      
      // Set online and socket connected
      act(() => {
        result.current.handleSocketConnected();
      });
      
      expect(result.current.isFullyConnected).toBe(true);
      
      // Go offline
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
      });
      
      expect(result.current.isFullyConnected).toBe(false);
    });

    it('should calculate hasConnectivityIssues correctly', () => {
      const { result } = renderHook(() => useNetworkStatus());
      
      expect(result.current.hasConnectivityIssues).toBe(false);
      
      // Add some failures
      act(() => {
        result.current.handleConnectionError();
        result.current.handleConnectionError();
        result.current.handleConnectionError();
      });
      
      expect(result.current.hasConnectivityIssues).toBe(true);
    });

    it('should calculate timeSinceLastOnline correctly', () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      const { result } = renderHook(() => useNetworkStatus());
      
      // Initially should have recent lastOnlineAt
      expect(result.current.timeSinceLastOnline).toBeLessThan(1000);
      
      // Simulate going offline and set lastOnlineAt to 5 minutes ago
      act(() => {
        NetworkTestUtils.simulateNetworkState({
          browserOffline: true,
          lastOnlineOffset: 5 * 60 * 1000,
        });
      });
      
      expect(result.current.timeSinceLastOnline).toBeGreaterThan(4 * 60 * 1000);
    });
  });

  describe('Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      const { unmount } = renderHook(() => useNetworkStatus());
      
      unmount();
      
      expect(window.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(window.removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    });

    it('should clear interval timers on unmount', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const { unmount } = renderHook(() => useNetworkStatus());
      
      unmount();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid online/offline transitions', async () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      const { result } = renderHook(() => useNetworkStatus());
      
      // Rapid transitions
      act(() => {
        NetworkTestUtils.triggerNetworkEvent('offline');
        NetworkTestUtils.triggerNetworkEvent('online');
        NetworkTestUtils.triggerNetworkEvent('offline');
        NetworkTestUtils.triggerNetworkEvent('online');
      });
      
      await waitFor(() => {
        expect(result.current.isOnline).toBe(true);
        expect(result.current.connectionFailures).toBe(0);
      });
    });

    it('should handle fetch abortion on timeout', async () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      NetworkTestUtils.mockFetch(true, 6000); // Longer than 5s timeout
      
      const { result } = renderHook(() => useNetworkStatus());
      
      // Advance time to trigger check
      act(() => {
        jest.advanceTimersByTime(30000);
      });
      
      // Advance time to trigger abort
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      
      // Should handle the aborted request gracefully
      await waitFor(() => {
        expect(result.current.connectionFailures).toBeGreaterThan(0);
      });
    });
  });
});