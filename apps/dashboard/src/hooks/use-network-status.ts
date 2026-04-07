import { useEffect, useCallback } from 'react';
import { useNetworkStore } from '../stores/network-store';

export function useNetworkStatus() {
  const store = useNetworkStore();
  const {
    setOnlineStatus,
    setReconnecting,
    incrementFailures,
    resetFailures,
  } = store;

  // Monitor navigator.onLine changes
  useEffect(() => {
    const handleOnline = () => {
      console.log('[network] Browser came online');
      setOnlineStatus(true);
      resetFailures();
    };

    const handleOffline = () => {
      console.log('[network] Browser went offline');
      setOnlineStatus(false);
    };

    // Set initial state
    setOnlineStatus(navigator.onLine);

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnlineStatus, resetFailures]);

  // Additional periodic connectivity check
  useEffect(() => {
    const checkConnectivity = async () => {
      try {
        // Only check if we think we're online but might not be
        if (navigator.onLine) {
          // Simple connectivity test - try to fetch a small resource
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          await fetch('/api/health', {
            method: 'HEAD',
            signal: controller.signal,
            cache: 'no-cache',
          });
          
          clearTimeout(timeoutId);
          
          // If we reach here, we're truly online
          if (!store.isOnline) {
            console.log('[network] Connectivity restored via health check');
            setOnlineStatus(true);
            resetFailures();
          }
        }
      } catch (error) {
        console.log('[network] Connectivity check failed:', error);
        // Don't immediately mark as offline - navigator.onLine handles that
        // But we can increment failure count for tracking
        if (store.isOnline) {
          incrementFailures();
        }
      }
    };

    // Check every 30 seconds when online, every 10 seconds when offline
    const interval = setInterval(
      checkConnectivity,
      store.connectionType === 'offline' ? 10000 : 30000
    );

    return () => clearInterval(interval);
  }, [store.connectionType, store.isOnline, setOnlineStatus, resetFailures, incrementFailures]);

  // Provide helper functions for socket integration
  const handleSocketConnected = useCallback(() => {
    console.log('[network] Socket connected');
    store.setSocketConnected(true);
  }, [store]);

  const handleSocketDisconnected = useCallback(() => {
    console.log('[network] Socket disconnected');
    store.setSocketConnected(false);
  }, [store]);

  const handleSocketReconnecting = useCallback(() => {
    console.log('[network] Socket reconnecting');
    store.setReconnecting(true);
  }, [store]);

  const handleConnectionError = useCallback(() => {
    console.log('[network] Connection error occurred');
    store.incrementFailures();
  }, [store]);

  return {
    // Current state
    isOnline: store.isOnline,
    connectionType: store.connectionType,
    lastOnlineAt: store.lastOnlineAt,
    socketConnected: store.socketConnected,
    connectionFailures: store.connectionFailures,
    isReconnecting: store.isReconnecting,

    // Helper functions for socket integration
    handleSocketConnected,
    handleSocketDisconnected,
    handleSocketReconnecting,
    handleConnectionError,

    // Computed properties
    isFullyConnected: store.isOnline && store.socketConnected,
    hasConnectivityIssues: store.connectionFailures > 2,
    timeSinceLastOnline: store.lastOnlineAt 
      ? Date.now() - store.lastOnlineAt 
      : null,
  };
}