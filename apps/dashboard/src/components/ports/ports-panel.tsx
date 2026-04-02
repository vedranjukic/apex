import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { Loader2, Plus, ExternalLink, Copy, Check, X, ArrowRightLeft, ToggleLeft, ToggleRight, Wifi, WifiOff, Settings } from 'lucide-react';
import { usePortsStore, type MergedPort } from '../../stores/ports-store';
import { useSettingsStore, usePortForwardingSettings } from '../../stores/settings-store';
import { usePortForwardingIntegration } from '../../hooks/use-port-forwarding-integration';
import { DaytonaPreviewButton } from './daytona-preview-button';
import { SettingsDialog } from '../settings/settings-dialog';
import { cn } from '../../lib/cn';

const isElectron = !!(window as any).apex?.isElectron;

interface PortsPanelProps {
  requestPreviewUrl: (port: number) => Promise<{ url: string; token?: string }>;
  forwardPort: (port: number) => Promise<{ localPort: number; url: string }>;
  provider: string;
  enableAutoForward?: () => Promise<{ success: boolean; error?: string }>;
  disableAutoForward?: () => Promise<{ success: boolean; error?: string }>;
  setPortRelay?: (port: number, enabled: boolean) => Promise<{ success: boolean; localPort?: number; error?: string }>;
}

export function PortsPanel({ 
  requestPreviewUrl, 
  forwardPort, 
  provider, 
  enableAutoForward, 
  disableAutoForward, 
  setPortRelay 
}: PortsPanelProps) {
  const allPorts = usePortsStore((s) => s.allPorts);
  const addUserPort = usePortsStore((s) => s.addUserPort);
  const closePort = usePortsStore((s) => s.closePort);
  const setPreviewUrl = usePortsStore((s) => s.setPreviewUrl);
  // Use settings store for auto-forward preferences
  const { autoForwardEnabled } = usePortForwardingSettings();
  const setAutoForwardEnabled = useSettingsStore((s) => s.setAutoForwardEnabled);
  const { shouldAutoForward, getBestPortForForwarding, showPortNotification } = usePortForwardingIntegration();
  const merged = allPorts();

  const [loadingPort, setLoadingPort] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [portInput, setPortInput] = useState('');
  const [autoForwardLoading, setAutoForwardLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const showForward = isElectron && (provider === 'docker' || provider === 'apple-container' || provider === 'local');
  const isDaytona = provider === 'daytona';
  const isDesktop = isElectron;

  const handleOpenPreview = useCallback(
    async (port: number) => {
      setLoadingPort(port);
      try {
        const { url } = await requestPreviewUrl(port);
        window.open(url, '_blank', 'noopener');
      } catch (err) {
        console.error('Failed to get preview URL:', err);
      } finally {
        setLoadingPort(null);
      }
    },
    [requestPreviewUrl],
  );

  const handleForward = useCallback(
    async (port: number) => {
      setLoadingPort(port);
      try {
        const { url } = await forwardPort(port);
        setPreviewUrl(port, url);
        window.open(url, '_blank', 'noopener');
      } catch (err) {
        console.error('Failed to forward port:', err);
      } finally {
        setLoadingPort(null);
      }
    },
    [forwardPort, setPreviewUrl],
  );

  const handleAddPort = useCallback(() => {
    const num = parseInt(portInput, 10);
    if (!num || num < 1 || num > 65535) return;
    addUserPort(num);
    setPortInput('');
    setAdding(false);
    requestPreviewUrl(num).catch(() => {});
  }, [portInput, addUserPort, requestPreviewUrl]);

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleAddPort();
      if (e.key === 'Escape') {
        setAdding(false);
        setPortInput('');
      }
    },
    [handleAddPort],
  );

  const startAdding = useCallback(() => {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleToggleAutoForward = useCallback(async () => {
    if (autoForwardLoading || !enableAutoForward || !disableAutoForward) return;
    
    setAutoForwardLoading(true);
    try {
      if (autoForwardEnabled) {
        await disableAutoForward();
        setAutoForwardEnabled(false);
      } else {
        await enableAutoForward();
        setAutoForwardEnabled(true);
      }
    } catch (error) {
      console.error('Failed to toggle auto-forward:', error);
    } finally {
      setAutoForwardLoading(false);
    }
  }, [autoForwardEnabled, enableAutoForward, disableAutoForward, autoForwardLoading, setAutoForwardEnabled]);

  return (
    <div className="h-full overflow-auto">
      {/* Header with settings */}
      <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-secondary">Ports</h3>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 text-text-muted hover:text-text-primary hover:bg-background-hover rounded-md transition-colors"
          title="Port forwarding settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Auto-forward toggle for desktop environments */}
      {isDesktop && showForward && (enableAutoForward && disableAutoForward) && (
        <div className="px-4 py-2 border-b border-border/50">
          <button
            onClick={handleToggleAutoForward}
            disabled={autoForwardLoading}
            className={cn(
              "flex items-center gap-2 text-xs transition-colors",
              autoForwardEnabled 
                ? "text-green-400 hover:text-green-300" 
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {autoForwardLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : autoForwardEnabled ? (
              <Wifi className="w-4 h-4" />
            ) : (
              <WifiOff className="w-4 h-4" />
            )}
            <span>Auto-forward detected ports</span>
            {autoForwardEnabled ? (
              <ToggleRight className="w-5 h-5" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
          </button>
        </div>
      )}
      
      <table className="w-full text-xs text-text-secondary whitespace-nowrap">
        <thead>
          <tr className="text-left text-text-muted border-b border-border">
            <th className="px-4 py-1.5 font-medium w-[80px]">Port</th>
            {isDesktop && <th className="px-4 py-1.5 font-medium w-[140px]">Localhost</th>}
            <th className="px-4 py-1.5 font-medium">Running Process</th>
            <th className="px-4 py-1.5 font-medium w-[100px]">Status</th>
            <th className="px-4 py-1.5 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {merged.map((p) => (
            <PortRow
              key={p.port}
              port={p}
              loading={loadingPort === p.port}
              onOpenPreview={handleOpenPreview}
              onForward={showForward ? handleForward : undefined}
              onClose={closePort}
              onRequestPreviewUrl={requestPreviewUrl}
              onSetPortRelay={setPortRelay}
              isDesktop={isDesktop}
              isDaytona={isDaytona}
              showForward={showForward}
            />
          ))}
          {adding && (
            <tr className="border-b border-border/50">
              <td className="px-4 py-1.5" colSpan={isDesktop ? 5 : 4}>
                <input
                  ref={inputRef}
                  type="number"
                  min={1}
                  max={65535}
                  value={portInput}
                  onChange={(e) => setPortInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  onBlur={() => {
                    if (!portInput) {
                      setAdding(false);
                    }
                  }}
                  placeholder="Enter port number..."
                  className="bg-transparent border border-border rounded px-2 py-0.5 text-xs text-text-primary outline-none focus:border-primary w-[200px]"
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!adding && (
        <button
          onClick={startAdding}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>Add Port</span>
        </button>
      )}

      {/* Settings Dialog */}
      <SettingsDialog 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
}

function PortRow({
  port,
  loading,
  onOpenPreview,
  onForward,
  onClose,
  onRequestPreviewUrl,
  onSetPortRelay,
  isDesktop,
  isDaytona,
  showForward,
}: {
  port: MergedPort;
  loading: boolean;
  onOpenPreview: (port: number) => void;
  onForward?: (port: number) => void;
  onClose: (port: number) => void;
  onRequestPreviewUrl: (port: number) => Promise<{ url: string; token?: string }>;
  onSetPortRelay?: (port: number, enabled: boolean) => Promise<{ success: boolean; localPort?: number; error?: string }>;
  isDesktop: boolean;
  isDaytona: boolean;
  showForward: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  
  // Determine port status
  const getPortStatus = () => {
    if (port.relay) {
      switch (port.relay.status) {
        case 'forwarding':
          return {
            text: 'Forwarded',
            color: 'text-green-400',
            bgColor: 'bg-green-500/20',
            icon: 'bg-green-500',
          };
        case 'failed':
          return {
            text: 'Failed',
            color: 'text-red-400',
            bgColor: 'bg-red-500/20',
            icon: 'bg-red-500',
          };
        case 'stopped':
          return {
            text: 'Stopped',
            color: 'text-text-muted',
            bgColor: 'bg-text-muted/10',
            icon: 'bg-text-muted/40',
          };
        default:
          return {
            text: 'Unknown',
            color: 'text-text-muted',
            bgColor: 'bg-text-muted/10',
            icon: 'bg-text-muted/40',
          };
      }
    }
    
    if (port.active) {
      return {
        text: 'Detected',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/20',
        icon: 'bg-yellow-500',
      };
    }
    
    return {
      text: 'Inactive',
      color: 'text-text-muted',
      bgColor: 'bg-text-muted/10',
      icon: 'bg-text-muted/40',
    };
  };

  const status = getPortStatus();

  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const handleToggleRelay = useCallback(async () => {
    if (!onSetPortRelay || relayLoading) return;
    
    setRelayLoading(true);
    setRelayError(null);
    try {
      const enabled = !port.relay || port.relay.status !== 'forwarding';
      const result = await onSetPortRelay(port.port, enabled);
      if (!result.success && result.error) {
        setRelayError(result.error);
      }
    } catch (error) {
      console.error('Failed to toggle port relay:', error);
      setRelayError(error instanceof Error ? error.message : 'Failed to toggle port forwarding');
    } finally {
      setRelayLoading(false);
    }
  }, [port.port, port.relay, onSetPortRelay, relayLoading]);

  return (
    <tr className="border-b border-border/50 hover:bg-terminal-bg/50 transition-colors group">
      {/* Port number with status indicator */}
      <td className="px-4 py-1.5">
        <span className="flex items-center gap-2 font-mono">
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              status.icon
            )}
          />
          {port.port}
        </span>
      </td>
      
      {/* Localhost URL for desktop */}
      {isDesktop && (
        <td className="px-4 py-1.5">
          {port.relay && port.relay.status === 'forwarding' ? (
            <div className="flex items-center gap-1.5">
              <a
                href={`http://${port.relay.localhostUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-mono text-xs"
                title={`Open ${port.relay.localhostUrl}`}
              >
                {port.relay.localhostUrl}
              </a>
              <button
                onClick={() => handleCopyUrl(`http://${port.relay.localhostUrl}`)}
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
                title="Copy localhost URL"
              >
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          ) : (
            <span className="text-text-muted/50 text-xs">Not forwarded</span>
          )}
        </td>
      )}
      
      {/* Process info */}
      <td className="px-4 py-1.5 text-text-muted truncate max-w-[200px]" title={port.command}>
        {port.command || port.process || '—'}
      </td>
      
      {/* Status badge */}
      <td className="px-4 py-1.5">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          status.color,
          status.bgColor
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', status.icon)} />
          {status.text}
        </span>
      </td>
      
      {/* Actions */}
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-1.5">
          {/* Port forwarding toggle for desktop */}
          {isDesktop && onSetPortRelay && (
            <button
              onClick={handleToggleRelay}
              disabled={relayLoading}
              className={cn(
                "shrink-0 text-text-muted hover:text-primary transition-colors disabled:opacity-50",
                port.relay?.status === 'forwarding' && "text-green-400 hover:text-green-300",
                relayError && "text-red-400"
              )}
              title={
                relayError ? `Error: ${relayError}` :
                port.relay?.status === 'forwarding' ? "Stop forwarding" : "Start forwarding"
              }
            >
              {relayLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowRightLeft className={cn(
                  "w-3 h-3",
                  port.relay?.status === 'forwarding' && "text-green-400"
                )} />
              )}
            </button>
          )}
          
          {/* Legacy forward button for older implementations */}
          {onForward && !onSetPortRelay && (
            <button
              onClick={() => onForward(port.port)}
              disabled={loading}
              className="shrink-0 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
              title="Forward port to localhost"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
            </button>
          )}
          
          {/* Daytona preview URL button */}
          {isDaytona && (
            <DaytonaPreviewButton
              port={port.port}
              onRequestPreviewUrl={onRequestPreviewUrl}
              disabled={loading}
            />
          )}
          
          {/* Preview URL for non-Daytona */}
          {!isDaytona && port.previewUrl && (
            <>
              <a
                href={port.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
                title="Open preview URL"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={() => handleCopyUrl(port.previewUrl)}
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
                title="Copy preview URL"
              >
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </>
          )}
          
          {/* Close button */}
          <button
            onClick={() => onClose(port.port)}
            className="shrink-0 ml-auto text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            title="Close port"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
