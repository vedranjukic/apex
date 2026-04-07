/**
 * Utility functions for working with sandbox status
 */

/**
 * Check if a sandbox is functionally running (including offline mode)
 */
export function isSandboxRunning(status: string): boolean {
  return status === 'running' || status === 'running-offline';
}

/**
 * Get the effective sandbox status for display, accounting for network state
 */
export function getEffectiveSandboxStatus(
  status: string,
  provider: string,
  isNetworkOffline: boolean
): string {
  const isDaytonaSandbox = provider === 'daytona';
  return isDaytonaSandbox && isNetworkOffline && status === 'running' 
    ? 'running-offline' 
    : status;
}