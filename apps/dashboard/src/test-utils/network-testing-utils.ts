/**
 * Testing utilities for offline mode and network state management
 * 
 * This module provides utilities to simulate network offline/online states,
 * test different offline scenarios, and validate network behavior in tests.
 */

import { useNetworkStore } from '../stores/network-store';

export type NetworkSimulationOptions = {
  /** Simulate browser offline state */
  browserOffline?: boolean;
  /** Simulate WebSocket disconnection */
  socketDisconnected?: boolean;
  /** Number of connection failures to simulate */
  connectionFailures?: number;
  /** Whether to simulate reconnecting state */
  isReconnecting?: boolean;
  /** How long ago was the last online time (in ms) */
  lastOnlineOffset?: number;
};

/**
 * Utility class for testing network states and behaviors
 */
export class NetworkTestUtils {
  private static originalNavigatorOnLine: boolean;
  private static originalAddEventListener: typeof window.addEventListener;
  private static originalRemoveEventListener: typeof window.removeEventListener;
  private static listeners: Map<string, ((event: Event) => void)[]> = new Map();

  /**
   * Mock navigator.onLine and window online/offline events for testing
   */
  static mockNavigatorOnLine(isOnline: boolean = true) {
    // Store original values
    if (this.originalNavigatorOnLine === undefined) {
      this.originalNavigatorOnLine = navigator.onLine;
      this.originalAddEventListener = window.addEventListener;
      this.originalRemoveEventListener = window.removeEventListener;
    }

    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: isOnline,
    });

    // Mock event listeners to track and trigger them manually
    window.addEventListener = jest.fn((event: string, listener: (event: Event) => void) => {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event)!.push(listener);
    });

    window.removeEventListener = jest.fn((event: string, listener: (event: Event) => void) => {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        const index = eventListeners.indexOf(listener);
        if (index > -1) {
          eventListeners.splice(index, 1);
        }
      }
    });
  }

  /**
   * Trigger online/offline events manually for testing
   */
  static triggerNetworkEvent(eventType: 'online' | 'offline') {
    // Update navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: eventType === 'online',
    });

    // Trigger the event
    const listeners = this.listeners.get(eventType) || [];
    const event = new Event(eventType);
    listeners.forEach(listener => listener(event));
  }

  /**
   * Restore original navigator.onLine and event listeners
   */
  static restoreNavigatorOnLine() {
    if (this.originalNavigatorOnLine !== undefined) {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: this.originalNavigatorOnLine,
      });
      
      window.addEventListener = this.originalAddEventListener;
      window.removeEventListener = this.originalRemoveEventListener;
      
      this.listeners.clear();
    }
  }

  /**
   * Simulate a specific network state for testing
   */
  static simulateNetworkState(options: NetworkSimulationOptions) {
    const store = useNetworkStore.getState();
    
    // Reset store first
    store.reset();
    
    // Apply simulation options
    if (options.browserOffline !== undefined) {
      this.mockNavigatorOnLine(!options.browserOffline);
      store.setOnlineStatus(!options.browserOffline);
    }
    
    if (options.socketDisconnected !== undefined) {
      store.setSocketConnected(!options.socketDisconnected);
    }
    
    if (options.connectionFailures !== undefined) {
      for (let i = 0; i < options.connectionFailures; i++) {
        store.incrementFailures();
      }
    }
    
    if (options.isReconnecting !== undefined) {
      store.setReconnecting(options.isReconnecting);
    }
    
    if (options.lastOnlineOffset !== undefined) {
      const state = useNetworkStore.getState();
      useNetworkStore.setState({
        ...state,
        lastOnlineAt: Date.now() - options.lastOnlineOffset,
      });
    }
  }

  /**
   * Create a mock WebSocket for testing
   */
  static createMockWebSocket() {
    const mockWS = {
      readyState: WebSocket.CONNECTING,
      send: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      onopen: null as ((event: Event) => void) | null,
      onclose: null as ((event: CloseEvent) => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      
      // Helper methods for testing
      triggerOpen: function() {
        this.readyState = WebSocket.OPEN;
        if (this.onopen) this.onopen(new Event('open'));
      },
      
      triggerClose: function(code = 1000, reason = '') {
        this.readyState = WebSocket.CLOSED;
        if (this.onclose) this.onclose(new CloseEvent('close', { code, reason }));
      },
      
      triggerMessage: function(data: any) {
        if (this.onmessage) {
          this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
        }
      },
      
      triggerError: function() {
        if (this.onerror) this.onerror(new Event('error'));
      },
    };

    // Mock WebSocket constructor
    (global as any).WebSocket = jest.fn(() => mockWS);
    (global as any).WebSocket.CONNECTING = 0;
    (global as any).WebSocket.OPEN = 1;
    (global as any).WebSocket.CLOSING = 2;
    (global as any).WebSocket.CLOSED = 3;

    return mockWS;
  }

  /**
   * Mock fetch for testing network connectivity checks
   */
  static mockFetch(shouldSucceed: boolean = true, delay: number = 0) {
    const originalFetch = global.fetch;
    
    global.fetch = jest.fn(() => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (shouldSucceed) {
            resolve(new Response('', { status: 200 }));
          } else {
            reject(new Error('Network request failed'));
          }
        }, delay);
      });
    });

    return originalFetch;
  }

  /**
   * Restore original fetch
   */
  static restoreFetch(originalFetch: typeof global.fetch) {
    global.fetch = originalFetch;
  }

  /**
   * Wait for network store to reach a specific state
   */
  static async waitForNetworkState(
    predicate: (state: ReturnType<typeof useNetworkStore.getState>) => boolean,
    timeout: number = 5000
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkState = () => {
        const state = useNetworkStore.getState();
        if (predicate(state)) {
          resolve();
          return;
        }
        setTimeout(checkState, 10);
      };
      
      checkState();
      
      setTimeout(() => {
        reject(new Error(`Network state condition not met within ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Get current network state for assertions
   */
  static getNetworkState() {
    return useNetworkStore.getState();
  }

  /**
   * Clean up all mocks and restore original state
   */
  static cleanup() {
    this.restoreNavigatorOnLine();
    useNetworkStore.getState().reset();
    
    // Clear any timers
    jest.clearAllTimers();
  }
}

/**
 * Test scenarios for different offline situations
 */
export const NetworkTestScenarios = {
  /** Fully online with working WebSocket */
  FULLY_ONLINE: {
    browserOffline: false,
    socketDisconnected: false,
    connectionFailures: 0,
    isReconnecting: false,
  },

  /** Browser offline */
  BROWSER_OFFLINE: {
    browserOffline: true,
    socketDisconnected: true,
    connectionFailures: 0,
    isReconnecting: false,
  },

  /** Online but WebSocket disconnected */
  SOCKET_DISCONNECTED: {
    browserOffline: false,
    socketDisconnected: true,
    connectionFailures: 1,
    isReconnecting: false,
  },

  /** Reconnecting state */
  RECONNECTING: {
    browserOffline: false,
    socketDisconnected: true,
    connectionFailures: 2,
    isReconnecting: true,
  },

  /** Intermittent connectivity issues */
  CONNECTIVITY_ISSUES: {
    browserOffline: false,
    socketDisconnected: false,
    connectionFailures: 5,
    isReconnecting: false,
  },

  /** Long offline period */
  LONG_OFFLINE: {
    browserOffline: true,
    socketDisconnected: true,
    connectionFailures: 10,
    lastOnlineOffset: 5 * 60 * 1000, // 5 minutes ago
  },
} as const;

/**
 * Helper functions for common test assertions
 */
export const NetworkAssertions = {
  /**
   * Assert that network state matches expected values
   */
  expectNetworkState(expected: Partial<NetworkSimulationOptions>) {
    const state = NetworkTestUtils.getNetworkState();
    
    if (expected.browserOffline !== undefined) {
      expect(state.isOnline).toBe(!expected.browserOffline);
    }
    
    if (expected.socketDisconnected !== undefined) {
      expect(state.socketConnected).toBe(!expected.socketDisconnected);
    }
    
    if (expected.connectionFailures !== undefined) {
      expect(state.connectionFailures).toBe(expected.connectionFailures);
    }
    
    if (expected.isReconnecting !== undefined) {
      expect(state.isReconnecting).toBe(expected.isReconnecting);
    }
  },

  /**
   * Assert that connection type is as expected
   */
  expectConnectionType(expectedType: 'online' | 'offline' | 'reconnecting') {
    const state = NetworkTestUtils.getNetworkState();
    expect(state.connectionType).toBe(expectedType);
  },

  /**
   * Assert that network indicators would show correct state
   */
  expectUIState(expected: {
    showOfflineIndicator?: boolean;
    showReconnectingIndicator?: boolean;
    showConnectionIssues?: boolean;
    canPerformOnlineActions?: boolean;
  }) {
    const state = NetworkTestUtils.getNetworkState();
    
    if (expected.showOfflineIndicator !== undefined) {
      expect(state.connectionType === 'offline').toBe(expected.showOfflineIndicator);
    }
    
    if (expected.showReconnectingIndicator !== undefined) {
      expect(state.connectionType === 'reconnecting').toBe(expected.showReconnectingIndicator);
    }
    
    if (expected.showConnectionIssues !== undefined) {
      expect(state.connectionFailures > 2).toBe(expected.showConnectionIssues);
    }
    
    if (expected.canPerformOnlineActions !== undefined) {
      const canPerform = state.isOnline && state.socketConnected;
      expect(canPerform).toBe(expected.canPerformOnlineActions);
    }
  },
};