import { useEffect } from 'react';
import { useNetworkStatus } from './use-network-status';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';

/**
 * Hook that integrates network status monitoring with WebSocket connections.
 * This provides a centralized way to track both browser connectivity and 
 * WebSocket connection states, and provides network-aware behaviors.
 */
export function useNetworkIntegration(socketRef: { current: ReconnectingWebSocket | null }) {
  const networkStatus = useNetworkStatus();
  const {
    handleSocketConnected,
    handleSocketDisconnected,
    handleSocketReconnecting,
    handleConnectionError,
  } = networkStatus;

  useEffect(() => {
    const ws = socketRef.current;
    if (!ws) return;

    // Integrate with the socket's status callbacks
    const onStatusChange = (status: 'connecting' | 'connected' | 'disconnected') => {
      switch (status) {
        case 'connected':
          handleSocketConnected();
          break;
        case 'connecting':
          handleSocketReconnecting();
          break;
        case 'disconnected':
          handleSocketDisconnected();
          break;
      }
    };

    // Listen to socket status changes
    ws.onStatus(onStatusChange);

    return () => {
      ws.offStatus(onStatusChange);
    };
  }, [socketRef, handleSocketConnected, handleSocketDisconnected, handleSocketReconnecting]);

  // Log network state changes for debugging
  useEffect(() => {
    const { connectionType, isOnline, socketConnected } = networkStatus;
    console.log('[network] State changed:', { 
      connectionType, 
      isOnline, 
      socketConnected,
      failures: networkStatus.connectionFailures,
    });
  }, [
    networkStatus.connectionType, 
    networkStatus.isOnline, 
    networkStatus.socketConnected,
    networkStatus.connectionFailures,
  ]);

  return {
    ...networkStatus,
    
    // Helper methods for component integration
    showOfflineIndicator: networkStatus.connectionType === 'offline',
    showReconnectingIndicator: networkStatus.connectionType === 'reconnecting',
    showConnectionIssues: networkStatus.hasConnectivityIssues,
    
    // Network-aware actions
    canPerformOnlineActions: networkStatus.isFullyConnected,
    shouldShowNetworkWarning: !networkStatus.isOnline || networkStatus.hasConnectivityIssues,
  };
}

/**
 * Enhanced version of useAgentSocket that includes network status integration.
 * This demonstrates how to integrate network monitoring with existing socket hooks.
 */
export function useAgentSocketWithNetwork(projectId: string | undefined) {
  // Import the original hook (this would be imported in a real implementation)
  const { useAgentSocket } = require('./use-agent-socket');
  const socketResult = useAgentSocket(projectId);
  
  // Add network integration
  const networkIntegration = useNetworkIntegration(socketResult.socket);

  return {
    ...socketResult,
    network: networkIntegration,
  };
}