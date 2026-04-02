import { useSettingsStore } from '../stores/settings-store';

/**
 * Utility functions for port management and conflict resolution
 */

/**
 * Find the next available port in the configured range
 * @param excludeList Additional ports to exclude
 * @returns Next available port or null if none available
 */
export function getNextAvailablePort(excludeList: number[] = []): number | null {
  const { portRange, excludedPorts } = useSettingsStore.getState();
  const allExcluded = new Set([...excludedPorts, ...excludeList]);
  
  for (let port = portRange.start; port <= portRange.end; port++) {
    if (!allExcluded.has(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Check if a port is within the configured range
 * @param port Port number to check
 * @returns True if port is in range
 */
export function isPortInConfiguredRange(port: number): boolean {
  const { portRange } = useSettingsStore.getState();
  return port >= portRange.start && port <= portRange.end;
}

/**
 * Get a port with conflict resolution applied
 * @param preferredPort Preferred port number
 * @param excludeList Additional ports to exclude
 * @returns Resolved port number or null if no port available
 */
export function resolvePortConflict(preferredPort: number, excludeList: number[] = []): number | null {
  const { portRange, excludedPorts, preferredPortOffset } = useSettingsStore.getState();
  const allExcluded = new Set([...excludedPorts, ...excludeList]);
  
  // Try the preferred port first
  if (preferredPort >= portRange.start && preferredPort <= portRange.end && !allExcluded.has(preferredPort)) {
    return preferredPort;
  }
  
  // Try with offset applied
  const offsetPort = preferredPort + preferredPortOffset;
  if (offsetPort >= portRange.start && offsetPort <= portRange.end && !allExcluded.has(offsetPort)) {
    return offsetPort;
  }
  
  // Fall back to any available port in range
  return getNextAvailablePort(excludeList);
}

/**
 * Get port forwarding configuration for use by external services
 * @returns Port forwarding configuration object
 */
export function getPortForwardingConfig() {
  const { 
    portRange, 
    maxConcurrentForwards, 
    excludedPorts, 
    preferredPortOffset 
  } = useSettingsStore.getState();
  
  return {
    portRange: {
      start: portRange.start,
      end: portRange.end,
    },
    maxConcurrentForwards,
    excludedPorts: [...excludedPorts],
    preferredPortOffset,
  };
}

/**
 * Generate a list of suggested ports based on common service patterns
 * @param serviceType Type of service (e.g., 'web', 'api', 'dev')
 * @returns Array of suggested port numbers
 */
export function getSuggestedPorts(serviceType?: string): number[] {
  const { portRange, excludedPorts } = useSettingsStore.getState();
  const allExcluded = new Set(excludedPorts);
  
  const suggestions: number[] = [];
  
  // Common port patterns
  const commonPorts = {
    web: [3000, 3001, 3002, 8000, 8001, 8080, 8081],
    api: [3000, 4000, 5000, 8000, 8001, 8080],
    dev: [3000, 3001, 5173, 5174, 8000, 8080, 8081],
    database: [3306, 5432, 6379, 27017],
  };
  
  const servicePorts = serviceType && serviceType in commonPorts 
    ? commonPorts[serviceType as keyof typeof commonPorts]
    : commonPorts.web;
  
  // Add service-specific ports if they're in range and not excluded
  for (const port of servicePorts) {
    if (port >= portRange.start && port <= portRange.end && !allExcluded.has(port)) {
      suggestions.push(port);
    }
  }
  
  // Fill remaining suggestions from range
  let count = 0;
  for (let port = portRange.start; port <= portRange.end && count < 10; port++) {
    if (!allExcluded.has(port) && !suggestions.includes(port)) {
      suggestions.push(port);
      count++;
    }
  }
  
  return suggestions.slice(0, 10); // Limit to 10 suggestions
}

/**
 * Validate if a port number is valid and available
 * @param port Port number to validate
 * @param excludeList Additional ports to exclude
 * @returns Validation result with error message if invalid
 */
export function validatePort(port: number, excludeList: number[] = []): { valid: boolean; error?: string } {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }
  
  const { portRange, excludedPorts } = useSettingsStore.getState();
  const allExcluded = new Set([...excludedPorts, ...excludeList]);
  
  if (port < 1024) {
    return { valid: false, error: 'Ports below 1024 require system privileges' };
  }
  
  if (port < portRange.start || port > portRange.end) {
    return { valid: false, error: `Port must be within configured range (${portRange.start}-${portRange.end})` };
  }
  
  if (allExcluded.has(port)) {
    return { valid: false, error: 'Port is in excluded list' };
  }
  
  return { valid: true };
}

/**
 * Format port range as a human-readable string
 * @param range Port range object
 * @returns Formatted string like "8000-9000"
 */
export function formatPortRange(range: { start: number; end: number }): string {
  return `${range.start}-${range.end}`;
}

/**
 * Calculate how many ports are available in the configured range
 * @param excludeList Additional ports to exclude
 * @returns Number of available ports
 */
export function getAvailablePortCount(excludeList: number[] = []): number {
  const { portRange, excludedPorts } = useSettingsStore.getState();
  const allExcluded = new Set([...excludedPorts, ...excludeList]);
  
  let count = 0;
  for (let port = portRange.start; port <= portRange.end; port++) {
    if (!allExcluded.has(port)) {
      count++;
    }
  }
  
  return count;
}