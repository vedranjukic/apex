import { create } from 'zustand';

export type ConnectionType = 'online' | 'offline' | 'reconnecting';

interface NetworkState {
  /** Current network connection status */
  isOnline: boolean;
  /** Connection type with reconnecting state */
  connectionType: ConnectionType;
  /** Last time we were online */
  lastOnlineAt: number | null;
  /** Whether the WebSocket connection is established */
  socketConnected: boolean;
  /** Number of consecutive connection failures */
  connectionFailures: number;
  /** True when actively attempting to reconnect */
  isReconnecting: boolean;

  // Actions
  /** Set online/offline status based on navigator.onLine */
  setOnlineStatus: (isOnline: boolean) => void;
  /** Set WebSocket connection status */
  setSocketConnected: (connected: boolean) => void;
  /** Mark as reconnecting state */
  setReconnecting: (reconnecting: boolean) => void;
  /** Increment connection failure count */
  incrementFailures: () => void;
  /** Reset connection failure count */
  resetFailures: () => void;
  /** Update connection type based on current state */
  updateConnectionType: () => void;
  /** Reset all state */
  reset: () => void;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  isOnline: navigator.onLine,
  connectionType: navigator.onLine ? 'online' : 'offline',
  lastOnlineAt: navigator.onLine ? Date.now() : null,
  socketConnected: false,
  connectionFailures: 0,
  isReconnecting: false,

  setOnlineStatus: (isOnline) => {
    const current = get();
    set({
      isOnline,
      lastOnlineAt: isOnline ? Date.now() : current.lastOnlineAt,
      connectionFailures: isOnline ? 0 : current.connectionFailures,
    });
    get().updateConnectionType();
  },

  setSocketConnected: (connected) => {
    set({ socketConnected: connected });
    if (connected) {
      set({ connectionFailures: 0, isReconnecting: false });
    }
    get().updateConnectionType();
  },

  setReconnecting: (reconnecting) => {
    set({ isReconnecting: reconnecting });
    get().updateConnectionType();
  },

  incrementFailures: () => {
    set({ connectionFailures: get().connectionFailures + 1 });
    get().updateConnectionType();
  },

  resetFailures: () => {
    set({ connectionFailures: 0 });
    get().updateConnectionType();
  },

  updateConnectionType: () => {
    const { isOnline, socketConnected, isReconnecting } = get();
    
    let connectionType: ConnectionType;
    if (!isOnline) {
      connectionType = 'offline';
    } else if (isReconnecting || (!socketConnected && isOnline)) {
      connectionType = 'reconnecting';
    } else {
      connectionType = 'online';
    }
    
    set({ connectionType });
  },

  reset: () =>
    set({
      isOnline: navigator.onLine,
      connectionType: navigator.onLine ? 'online' : 'offline',
      lastOnlineAt: navigator.onLine ? Date.now() : null,
      socketConnected: false,
      connectionFailures: 0,
      isReconnecting: false,
    }),
}));