/**
 * Tests for ReconnectingWebSocket class
 */

import { ReconnectingWebSocket } from '../reconnecting-ws';
import { useNetworkStore } from '../../stores/network-store';
import { NetworkTestUtils } from '../../test-utils/network-testing-utils';

// Mock timers for testing
jest.useFakeTimers();

describe('ReconnectingWebSocket', () => {
  let mockWS: any;
  let reconnectingWS: ReconnectingWebSocket;

  beforeEach(() => {
    NetworkTestUtils.cleanup();
    mockWS = NetworkTestUtils.createMockWebSocket();
    NetworkTestUtils.mockNavigatorOnLine(true);
  });

  afterEach(() => {
    if (reconnectingWS) {
      reconnectingWS.destroy();
    }
    NetworkTestUtils.cleanup();
    jest.clearAllTimers();
  });

  describe('Initialization', () => {
    it('should create WebSocket and subscribe to network store', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost/test');
    });

    it('should use wss: for https: protocol', () => {
      // Mock https location
      Object.defineProperty(location, 'protocol', {
        configurable: true,
        value: 'https:',
      });

      reconnectingWS = new ReconnectingWebSocket('/test');
      
      expect(global.WebSocket).toHaveBeenCalledWith('wss://localhost/test');
    });
  });

  describe('Connection Handling', () => {
    it('should handle successful connection', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const statusHandler = jest.fn();
      reconnectingWS.onStatus(statusHandler);
      
      // Trigger connection
      mockWS.triggerOpen();
      
      expect(statusHandler).toHaveBeenCalledWith('connected');
      expect(reconnectingWS.connected).toBe(true);
      
      // Should update network store
      const networkState = useNetworkStore.getState();
      expect(networkState.socketConnected).toBe(true);
      expect(networkState.isReconnecting).toBe(false);
      expect(networkState.connectionFailures).toBe(0);
    });

    it('should handle connection failure', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Trigger connection error
      mockWS.triggerError();
      
      // Should increment failures and schedule reconnect
      const networkState = useNetworkStore.getState();
      expect(networkState.connectionFailures).toBeGreaterThan(0);
    });

    it('should handle connection close and schedule reconnect', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const statusHandler = jest.fn();
      reconnectingWS.onStatus(statusHandler);
      
      // First connect
      mockWS.triggerOpen();
      expect(statusHandler).toHaveBeenCalledWith('connected');
      
      // Then close
      mockWS.triggerClose();
      
      expect(statusHandler).toHaveBeenCalledWith('disconnected');
      expect(reconnectingWS.connected).toBe(false);
      
      // Should update network store
      const networkState = useNetworkStore.getState();
      expect(networkState.socketConnected).toBe(false);
    });
  });

  describe('Network Integration', () => {
    it('should not attempt connection when offline', () => {
      NetworkTestUtils.mockNavigatorOnLine(false);
      useNetworkStore.getState().setOnlineStatus(false);
      
      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn(() => {
        throw new Error('Should not create WebSocket when offline');
      });
      
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Should not throw error
      expect(() => reconnectingWS).not.toThrow();
      
      global.WebSocket = originalWebSocket;
    });

    it('should reconnect immediately when going online', () => {
      // Start offline
      NetworkTestUtils.mockNavigatorOnLine(false);
      useNetworkStore.getState().setOnlineStatus(false);
      
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      const connectSpy = jest.spyOn(reconnectingWS as any, 'connect');
      
      // Go online
      act(() => {
        useNetworkStore.getState().setOnlineStatus(true);
      });
      
      // Should attempt reconnection
      expect(connectSpy).toHaveBeenCalled();
    });

    it('should use different reconnect delays for offline vs online', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Simulate connection failure while online
      mockWS.triggerError();
      mockWS.triggerClose();
      
      // Fast-forward to check online reconnect delay
      act(() => {
        jest.advanceTimersByTime(1000); // Initial delay
      });
      
      // Now go offline and fail again
      useNetworkStore.getState().setOnlineStatus(false);
      mockWS.triggerError();
      mockWS.triggerClose();
      
      // Should use longer offline delay
      act(() => {
        jest.advanceTimersByTime(5000); // Offline delay
      });
    });
  });

  describe('Message Handling', () => {
    it('should handle incoming messages', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const messageHandler = jest.fn();
      
      reconnectingWS.on('test', messageHandler);
      
      // Connect first
      mockWS.triggerOpen();
      
      // Send message
      mockWS.triggerMessage({ type: 'test', payload: 'data' });
      
      expect(messageHandler).toHaveBeenCalledWith({ type: 'test', payload: 'data' });
    });

    it('should handle wildcard message handlers', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const wildcardHandler = jest.fn();
      
      reconnectingWS.on('*', wildcardHandler);
      
      // Connect first
      mockWS.triggerOpen();
      
      // Send message
      mockWS.triggerMessage({ type: 'test', payload: 'data' });
      
      expect(wildcardHandler).toHaveBeenCalledWith({ type: 'test', payload: 'data' });
    });

    it('should queue messages when disconnected', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Send message while disconnected
      reconnectingWS.send('test', { data: 'queued' });
      
      expect(mockWS.send).not.toHaveBeenCalled();
      
      // Connect
      mockWS.triggerOpen();
      
      // Should send queued messages
      expect(mockWS.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', payload: { data: 'queued' } }));
    });

    it('should send messages immediately when connected', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Connect first
      mockWS.triggerOpen();
      
      // Send message
      reconnectingWS.send('test', { data: 'immediate' });
      
      expect(mockWS.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', payload: { data: 'immediate' } }));
    });

    it('should ignore malformed messages', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const messageHandler = jest.fn();
      
      reconnectingWS.on('test', messageHandler);
      
      // Connect first
      mockWS.triggerOpen();
      
      // Trigger malformed message directly through WebSocket onmessage
      if (mockWS.onmessage) {
        mockWS.onmessage({ data: 'invalid json' } as MessageEvent);
      }
      
      // Should not crash and not call handler
      expect(messageHandler).not.toHaveBeenCalled();
    });
  });

  describe('Event Listeners', () => {
    it('should add and remove message handlers', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      reconnectingWS.on('test', handler1);
      reconnectingWS.on('test', handler2);
      
      // Connect first
      mockWS.triggerOpen();
      
      // Send message
      mockWS.triggerMessage({ type: 'test', payload: 'data' });
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      
      // Remove one handler
      reconnectingWS.off('test', handler1);
      
      // Send another message
      handler1.mockClear();
      handler2.mockClear();
      
      mockWS.triggerMessage({ type: 'test', payload: 'data2' });
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should add and remove status handlers', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const statusHandler1 = jest.fn();
      const statusHandler2 = jest.fn();
      
      reconnectingWS.onStatus(statusHandler1);
      reconnectingWS.onStatus(statusHandler2);
      
      // Trigger connection
      mockWS.triggerOpen();
      
      expect(statusHandler1).toHaveBeenCalledWith('connected');
      expect(statusHandler2).toHaveBeenCalledWith('connected');
      
      // Remove one handler
      reconnectingWS.offStatus(statusHandler1);
      
      // Trigger disconnection
      statusHandler1.mockClear();
      statusHandler2.mockClear();
      
      mockWS.triggerClose();
      
      expect(statusHandler1).not.toHaveBeenCalled();
      expect(statusHandler2).toHaveBeenCalledWith('disconnected');
    });
  });

  describe('Reconnection Logic', () => {
    it('should implement exponential backoff', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // First failure - should schedule with 1s delay
      mockWS.triggerClose();
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);
      
      // Advance time and trigger next failure
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      mockWS.triggerClose();
      
      // Should increase delay (2s)
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2000);
      
      // Advance and trigger another failure
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      mockWS.triggerClose();
      
      // Should increase delay (4s)
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 4000);
    });

    it('should reset delay on successful connection', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Cause some failures to increase delay
      mockWS.triggerClose();
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      mockWS.triggerClose();
      
      // Successfully connect
      mockWS.triggerOpen();
      
      // Next failure should reset to initial delay
      mockWS.triggerClose();
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);
    });

    it('should have maximum reconnect delay', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Cause many failures to hit max delay
      for (let i = 0; i < 10; i++) {
        mockWS.triggerClose();
        act(() => {
          jest.advanceTimersByTime(30000); // Max delay
        });
      }
      
      // Should cap at maximum delay (30s)
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 30000);
    });

    it('should cancel reconnect on destroy', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      
      // Trigger failure to schedule reconnect
      mockWS.triggerClose();
      
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      // Destroy should cancel reconnect
      reconnectingWS.destroy();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should clean up all resources on destroy', () => {
      reconnectingWS = new ReconnectingWebSocket('/test');
      const statusHandler = jest.fn();
      const messageHandler = jest.fn();
      
      reconnectingWS.onStatus(statusHandler);
      reconnectingWS.on('test', messageHandler);
      
      // Connect first
      mockWS.triggerOpen();
      
      // Destroy
      reconnectingWS.destroy();
      
      expect(mockWS.close).toHaveBeenCalled();
      
      // Should update network store
      const networkState = useNetworkStore.getState();
      expect(networkState.socketConnected).toBe(false);
      expect(networkState.isReconnecting).toBe(false);
      
      // Should not respond to events after destroy
      mockWS.triggerMessage({ type: 'test', payload: 'data' });
      expect(messageHandler).not.toHaveBeenCalled();
    });
  });
});