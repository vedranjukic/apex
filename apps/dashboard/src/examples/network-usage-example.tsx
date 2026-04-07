/**
 * Example file demonstrating how to use the new network state store and hooks.
 * This file shows various integration patterns and is not meant to be imported
 * in the actual application - it's for reference and testing purposes.
 */

import React, { useEffect } from 'react';
import { useNetworkStatus } from '../hooks/use-network-status';
import { useNetworkStore } from '../stores/network-store';
import { NetworkStatusIndicator, NetworkStatusBanner } from '../components/layout/network-status-indicator';

// Example 1: Basic network status display component
export function NetworkStatusExample() {
  const networkStatus = useNetworkStatus();

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Network Status</h2>
      
      {/* Show current status */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Connection Type:</label>
          <p className="text-sm text-text-muted">{networkStatus.connectionType}</p>
        </div>
        <div>
          <label className="text-sm font-medium">Browser Online:</label>
          <p className="text-sm text-text-muted">{networkStatus.isOnline ? 'Yes' : 'No'}</p>
        </div>
        <div>
          <label className="text-sm font-medium">Socket Connected:</label>
          <p className="text-sm text-text-muted">{networkStatus.socketConnected ? 'Yes' : 'No'}</p>
        </div>
        <div>
          <label className="text-sm font-medium">Connection Failures:</label>
          <p className="text-sm text-text-muted">{networkStatus.connectionFailures}</p>
        </div>
      </div>

      {/* Show network status indicators */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Status Indicators:</p>
        <div className="flex items-center gap-4">
          <NetworkStatusIndicator />
          <NetworkStatusIndicator showText />
        </div>
      </div>

      {/* Show network banner */}
      <div>
        <p className="text-sm font-medium mb-2">Network Banner:</p>
        <NetworkStatusBanner />
      </div>
    </div>
  );
}

// Example 2: Component that reacts to network changes
export function NetworkAwareComponent() {
  const { isFullyConnected, canPerformOnlineActions, shouldShowNetworkWarning } = useNetworkStatus();

  useEffect(() => {
    if (isFullyConnected) {
      console.log('Network is fully connected - can sync data');
    } else {
      console.log('Network issues detected - enabling offline mode');
    }
  }, [isFullyConnected]);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Network-Aware Actions</h2>
      
      {shouldShowNetworkWarning && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            Network connectivity issues detected. Some features may not work properly.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <button
          disabled={!canPerformOnlineActions}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            canPerformOnlineActions
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Sync Data (Requires Connection)
        </button>

        <button
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-500"
        >
          Work Offline (Always Available)
        </button>
      </div>
    </div>
  );
}

// Example 3: Direct store usage (outside React components)
export function demonstrateStoreUsage() {
  // Access store state directly
  const store = useNetworkStore.getState();
  
  console.log('Current network state:', {
    isOnline: store.isOnline,
    connectionType: store.connectionType,
    socketConnected: store.socketConnected,
    failures: store.connectionFailures,
  });

  // Manually update network state (normally done by the hook)
  store.setOnlineStatus(false);
  store.setSocketConnected(false);
  
  console.log('Updated network state:', {
    isOnline: store.isOnline,
    connectionType: store.connectionType,
  });
}

// Example 4: Integration with existing socket hooks
export function ExampleSocketIntegration({ projectId }: { projectId: string }) {
  const networkStatus = useNetworkStatus();
  
  // This would be replaced with actual socket hook like useAgentSocket
  const mockSocket = { current: null };
  
  useEffect(() => {
    // Example of how to integrate with existing socket status
    const handleSocketStatus = (status: 'connecting' | 'connected' | 'disconnected') => {
      switch (status) {
        case 'connected':
          networkStatus.handleSocketConnected();
          break;
        case 'connecting':
          networkStatus.handleSocketReconnecting();
          break;
        case 'disconnected':
          networkStatus.handleSocketDisconnected();
          break;
      }
    };

    // In real implementation, you would attach this to your socket's status events
    // socket.onStatus(handleSocketStatus);
    
    return () => {
      // socket.offStatus(handleSocketStatus);
    };
  }, [networkStatus]);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Socket Integration Example</h2>
      <p className="text-sm text-text-muted">
        This shows how to integrate network status with existing socket hooks.
        Check the console for network state changes.
      </p>
      <NetworkStatusIndicator showText className="mt-2" />
    </div>
  );
}