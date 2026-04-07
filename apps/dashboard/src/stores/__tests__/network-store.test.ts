/**
 * Tests for network store functionality
 */

import { renderHook, act } from '@testing-library/react';
import { useNetworkStore } from '../network-store';
import { NetworkTestUtils, NetworkTestScenarios, NetworkAssertions } from '../../test-utils/network-testing-utils';

describe('NetworkStore', () => {
  beforeEach(() => {
    NetworkTestUtils.cleanup();
  });

  afterEach(() => {
    NetworkTestUtils.cleanup();
  });

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      const { result } = renderHook(() => useNetworkStore());
      
      expect(result.current.isOnline).toBe(true);
      expect(result.current.connectionType).toBe('online');
      expect(result.current.socketConnected).toBe(false);
      expect(result.current.connectionFailures).toBe(0);
      expect(result.current.isReconnecting).toBe(false);
      expect(result.current.lastOnlineAt).toBeDefined();
    });

    it('should initialize offline when browser is offline', () => {
      NetworkTestUtils.mockNavigatorOnLine(false);
      const { result } = renderHook(() => useNetworkStore());
      
      expect(result.current.isOnline).toBe(false);
      expect(result.current.connectionType).toBe('offline');
      expect(result.current.lastOnlineAt).toBeNull();
    });
  });

  describe('setOnlineStatus', () => {
    it('should update online status and connection type', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.setOnlineStatus(false);
      });
      
      expect(result.current.isOnline).toBe(false);
      expect(result.current.connectionType).toBe('offline');
    });

    it('should set lastOnlineAt when going online', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.setOnlineStatus(false);
      });
      
      const beforeTime = Date.now();
      
      act(() => {
        result.current.setOnlineStatus(true);
      });
      
      const afterTime = Date.now();
      
      expect(result.current.isOnline).toBe(true);
      expect(result.current.lastOnlineAt).toBeGreaterThanOrEqual(beforeTime);
      expect(result.current.lastOnlineAt).toBeLessThanOrEqual(afterTime);
    });

    it('should reset failures when going online', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      // Add some failures first
      act(() => {
        result.current.incrementFailures();
        result.current.incrementFailures();
      });
      
      expect(result.current.connectionFailures).toBe(2);
      
      // Going online should reset failures
      act(() => {
        result.current.setOnlineStatus(true);
      });
      
      expect(result.current.connectionFailures).toBe(0);
    });
  });

  describe('setSocketConnected', () => {
    it('should update socket status and connection type', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      // Set online first
      act(() => {
        result.current.setOnlineStatus(true);
      });
      
      act(() => {
        result.current.setSocketConnected(true);
      });
      
      expect(result.current.socketConnected).toBe(true);
      expect(result.current.connectionType).toBe('online');
    });

    it('should reset failures and reconnecting when socket connects', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      // Set up some failures and reconnecting state
      act(() => {
        result.current.incrementFailures();
        result.current.setReconnecting(true);
      });
      
      expect(result.current.connectionFailures).toBeGreaterThan(0);
      expect(result.current.isReconnecting).toBe(true);
      
      // Connect socket
      act(() => {
        result.current.setSocketConnected(true);
      });
      
      expect(result.current.connectionFailures).toBe(0);
      expect(result.current.isReconnecting).toBe(false);
    });
  });

  describe('Connection Type Logic', () => {
    it('should set connectionType to offline when browser is offline', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.setOnlineStatus(false);
      });
      
      expect(result.current.connectionType).toBe('offline');
    });

    it('should set connectionType to reconnecting when reconnecting', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.setOnlineStatus(true);
        result.current.setReconnecting(true);
      });
      
      expect(result.current.connectionType).toBe('reconnecting');
    });

    it('should set connectionType to reconnecting when online but socket disconnected', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.setOnlineStatus(true);
        result.current.setSocketConnected(false);
      });
      
      expect(result.current.connectionType).toBe('reconnecting');
    });

    it('should set connectionType to online when fully connected', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.setOnlineStatus(true);
        result.current.setSocketConnected(true);
      });
      
      expect(result.current.connectionType).toBe('online');
    });
  });

  describe('Connection Failures', () => {
    it('should increment failures', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.incrementFailures();
      });
      
      expect(result.current.connectionFailures).toBe(1);
      
      act(() => {
        result.current.incrementFailures();
      });
      
      expect(result.current.connectionFailures).toBe(2);
    });

    it('should reset failures', () => {
      const { result } = renderHook(() => useNetworkStore());
      
      act(() => {
        result.current.incrementFailures();
        result.current.incrementFailures();
      });
      
      expect(result.current.connectionFailures).toBe(2);
      
      act(() => {
        result.current.resetFailures();
      });
      
      expect(result.current.connectionFailures).toBe(0);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset to initial state', () => {
      NetworkTestUtils.mockNavigatorOnLine(true);
      const { result } = renderHook(() => useNetworkStore());
      
      // Modify state
      act(() => {
        result.current.setOnlineStatus(false);
        result.current.setSocketConnected(false);
        result.current.incrementFailures();
        result.current.setReconnecting(true);
      });
      
      // Reset
      act(() => {
        result.current.reset();
      });
      
      expect(result.current.isOnline).toBe(true);
      expect(result.current.connectionType).toBe('online');
      expect(result.current.socketConnected).toBe(false);
      expect(result.current.connectionFailures).toBe(0);
      expect(result.current.isReconnecting).toBe(false);
    });
  });

  describe('Test Scenarios', () => {
    it('should handle FULLY_ONLINE scenario', () => {
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.FULLY_ONLINE);
      
      NetworkAssertions.expectConnectionType('online');
      NetworkAssertions.expectUIState({
        showOfflineIndicator: false,
        showReconnectingIndicator: false,
        canPerformOnlineActions: true,
      });
    });

    it('should handle BROWSER_OFFLINE scenario', () => {
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.BROWSER_OFFLINE);
      
      NetworkAssertions.expectConnectionType('offline');
      NetworkAssertions.expectUIState({
        showOfflineIndicator: true,
        canPerformOnlineActions: false,
      });
    });

    it('should handle SOCKET_DISCONNECTED scenario', () => {
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.SOCKET_DISCONNECTED);
      
      NetworkAssertions.expectConnectionType('reconnecting');
      NetworkAssertions.expectUIState({
        showReconnectingIndicator: true,
        canPerformOnlineActions: false,
      });
    });

    it('should handle RECONNECTING scenario', () => {
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.RECONNECTING);
      
      NetworkAssertions.expectConnectionType('reconnecting');
      NetworkAssertions.expectUIState({
        showReconnectingIndicator: true,
        canPerformOnlineActions: false,
      });
    });

    it('should handle CONNECTIVITY_ISSUES scenario', () => {
      NetworkTestUtils.simulateNetworkState(NetworkTestScenarios.CONNECTIVITY_ISSUES);
      
      NetworkAssertions.expectUIState({
        showConnectionIssues: true,
      });
    });
  });
});