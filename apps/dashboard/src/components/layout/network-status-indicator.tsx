import { Wifi, WifiOff, RotateCw, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useNetworkStatus } from '../../hooks/use-network-status';

interface NetworkStatusIndicatorProps {
  /** Whether to show detailed status text (default: false) */
  showText?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function NetworkStatusIndicator({ showText = false, className }: NetworkStatusIndicatorProps) {
  const {
    connectionType,
    isOnline,
    socketConnected,
    connectionFailures,
    timeSinceLastOnline,
    isReconnecting,
  } = useNetworkStatus();

  const getStatusInfo = () => {
    switch (connectionType) {
      case 'online':
        return {
          icon: Wifi,
          text: socketConnected ? 'Connected' : 'Online',
          color: 'text-green-500',
          bgColor: 'bg-green-500',
        };
      case 'reconnecting':
        return {
          icon: RotateCw,
          text: 'Reconnecting',
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-500',
          animate: 'animate-spin',
        };
      case 'offline':
        return {
          icon: WifiOff,
          text: 'Offline',
          color: 'text-red-500',
          bgColor: 'bg-red-500',
        };
      default:
        return {
          icon: AlertTriangle,
          text: 'Unknown',
          color: 'text-gray-500',
          bgColor: 'bg-gray-500',
        };
    }
  };

  const statusInfo = getStatusInfo();
  const Icon = statusInfo.icon;

  const getTooltipText = () => {
    const parts = [];
    
    if (!isOnline) {
      parts.push('Browser is offline');
    } else if (!socketConnected) {
      parts.push('WebSocket disconnected');
    } else {
      parts.push('Connected');
    }

    if (connectionFailures > 0) {
      parts.push(`${connectionFailures} connection failures`);
    }

    if (timeSinceLastOnline && timeSinceLastOnline > 60000) {
      const minutes = Math.floor(timeSinceLastOnline / 60000);
      parts.push(`Last online ${minutes}m ago`);
    }

    return parts.join(' • ');
  };

  return (
    <div 
      className={cn(
        'flex items-center gap-1.5',
        className
      )}
      title={getTooltipText()}
    >
      {/* Connection status indicator dot */}
      <div className="relative">
        <Icon 
          className={cn(
            'w-4 h-4',
            statusInfo.color,
            statusInfo.animate
          )} 
        />
        
        {/* Connection failures indicator */}
        {connectionFailures > 2 && (
          <div className={cn(
            'absolute -top-1 -right-1 w-2 h-2 rounded-full',
            'bg-red-500 border border-white'
          )} />
        )}
      </div>

      {/* Status text */}
      {showText && (
        <span className={cn(
          'text-xs font-medium',
          statusInfo.color
        )}>
          {statusInfo.text}
        </span>
      )}

      {/* Detailed connection info */}
      {showText && connectionFailures > 0 && (
        <span className="text-xs text-text-muted">
          ({connectionFailures} failures)
        </span>
      )}
    </div>
  );
}

/**
 * Banner component that shows network connectivity warnings
 */
export function NetworkStatusBanner() {
  const {
    connectionType,
    isOnline,
    hasConnectivityIssues,
    timeSinceLastOnline,
  } = useNetworkStatus();

  // Don't show banner if everything is fine
  if (connectionType === 'online' && !hasConnectivityIssues) {
    return null;
  }

  const getBannerContent = () => {
    if (!isOnline) {
      return {
        text: 'You are offline. Some features may not work properly.',
        icon: WifiOff,
        severity: 'error' as const,
      };
    }

    if (connectionType === 'reconnecting') {
      return {
        text: 'Reconnecting to server...',
        icon: RotateCw,
        severity: 'warning' as const,
        animate: true,
      };
    }

    if (hasConnectivityIssues) {
      return {
        text: 'Connection issues detected. Some features may be unstable.',
        icon: AlertTriangle,
        severity: 'warning' as const,
      };
    }

    return null;
  };

  const bannerInfo = getBannerContent();
  if (!bannerInfo) return null;

  const Icon = bannerInfo.icon;

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2 text-xs border-b',
      bannerInfo.severity === 'error' 
        ? 'bg-red-50 text-red-800 border-red-200'
        : 'bg-yellow-50 text-yellow-800 border-yellow-200'
    )}>
      <Icon 
        className={cn(
          'w-4 h-4 flex-shrink-0',
          bannerInfo.animate && 'animate-spin'
        )} 
      />
      <span className="flex-1">
        {bannerInfo.text}
      </span>
      
      {timeSinceLastOnline && timeSinceLastOnline > 300000 && (
        <span className="text-xs opacity-75">
          Last connected {Math.floor(timeSinceLastOnline / 60000)}m ago
        </span>
      )}
    </div>
  );
}