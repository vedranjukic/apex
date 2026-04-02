import { useEffect, useCallback } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import { usePortsStore } from '../stores/ports-store';
import { getPortForwardingConfig, resolvePortConflict } from '../lib/port-utils';

/**
 * Hook to integrate port forwarding settings with the ports system
 * This hook ensures that the port forwarding behavior respects user preferences
 */
export function usePortForwardingIntegration() {
  const {
    autoForwardEnabled,
    portRange,
    maxConcurrentForwards,
    excludedPorts,
    notificationsEnabled,
  } = useSettingsStore();
  
  const portRelays = usePortsStore((s) => s.portRelays);
  const allPorts = usePortsStore((s) => s.allPorts);

  // Get currently forwarded ports
  const getForwardedPorts = useCallback(() => {
    return Object.keys(portRelays)
      .map(key => parseInt(key, 10))
      .filter(port => portRelays[port]?.status === 'forwarding');
  }, [portRelays]);

  // Check if a port should be auto-forwarded
  const shouldAutoForward = useCallback((port: number): boolean => {
    if (!autoForwardEnabled) return false;
    if (excludedPorts.includes(port)) return false;
    if (port < portRange.start || port > portRange.end) return false;
    
    const forwardedPorts = getForwardedPorts();
    if (forwardedPorts.length >= maxConcurrentForwards) return false;
    
    return true;
  }, [autoForwardEnabled, excludedPorts, portRange, maxConcurrentForwards, getForwardedPorts]);

  // Get the best port for forwarding with conflict resolution
  const getBestPortForForwarding = useCallback((preferredPort: number): number | null => {
    const forwardedPorts = getForwardedPorts();
    return resolvePortConflict(preferredPort, forwardedPorts);
  }, [getForwardedPorts]);

  // Show desktop notification for port events
  const showPortNotification = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (!notificationsEnabled || typeof window === 'undefined') return;
    
    // Check if notifications are supported and permitted
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Port Forwarding', {
        body: message,
        icon: '/favicon.ico',
        tag: 'port-forwarding',
      });
    } else if ('Notification' in window && Notification.permission === 'default') {
      // Request permission if not already decided
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification('Port Forwarding', {
            body: message,
            icon: '/favicon.ico',
            tag: 'port-forwarding',
          });
        }
      });
    }
  }, [notificationsEnabled]);

  // Monitor port changes and apply auto-forwarding logic
  useEffect(() => {
    if (!autoForwardEnabled) return;
    
    const ports = allPorts();
    const forwardedPorts = getForwardedPorts();
    
    // Check for new ports that should be auto-forwarded
    for (const port of ports) {
      if (port.active && !port.relay && shouldAutoForward(port.port)) {
        // This port should be auto-forwarded but isn't yet
        // The actual forwarding will be handled by the component that calls forwardPort
        console.log(`Port ${port.port} should be auto-forwarded`);
      }
    }
    
    // Check if we've exceeded the maximum concurrent forwards
    if (forwardedPorts.length > maxConcurrentForwards) {
      console.warn(`Exceeded maximum concurrent forwards (${maxConcurrentForwards}). Consider increasing the limit or stopping unused forwards.`);
      showPortNotification(
        `Warning: ${forwardedPorts.length} ports forwarded (max: ${maxConcurrentForwards})`,
        'error'
      );
    }
  }, [autoForwardEnabled, allPorts, getForwardedPorts, shouldAutoForward, maxConcurrentForwards, showPortNotification]);

  // Request notification permission on first load
  useEffect(() => {
    if (notificationsEnabled && typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, [notificationsEnabled]);

  return {
    shouldAutoForward,
    getBestPortForForwarding,
    showPortNotification,
    getPortForwardingConfig,
    isAutoForwardEnabled: autoForwardEnabled,
    maxConcurrentForwards,
    availablePortRange: portRange,
    excludedPorts,
  };
}