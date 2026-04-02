import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { Loader2, Plus, ExternalLink, Copy, Check, X, ArrowRightLeft, Settings } from 'lucide-react';
import { usePortsStore, type MergedPort } from '../../stores/ports-store';
import { SettingsDialog } from '../settings/settings-dialog';
import { cn } from '../../lib/cn';

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
  setPortRelay 
}: PortsPanelProps) {
  const allPorts = usePortsStore((s) => s.allPorts);
  const addUserPort = usePortsStore((s) => s.addUserPort);
  const closePort = usePortsStore((s) => s.closePort);
  const setPreviewUrl = usePortsStore((s) => s.setPreviewUrl);
  const merged = allPorts();

  const [loadingPort, setLoadingPort] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [portInput, setPortInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs text-text-secondary whitespace-nowrap">
        <thead>
          <tr className="text-left text-text-muted border-b border-border">
            <th className="px-4 py-1.5 font-medium w-[80px]">Port</th>
            <th className="px-4 py-1.5 font-medium">Localhost</th>
            <th className="px-4 py-1.5 font-medium">Running Process</th>
            <th className="px-4 py-1.5 font-medium w-[100px]">Status</th>
            <th className="px-4 py-1.5 font-medium w-[80px]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {merged.map((p) => (
            <PortRow
              key={p.port}
              port={p}
              loading={loadingPort === p.port}
              onForward={handleForward}
              onClose={closePort}
              onSetPortRelay={setPortRelay}
            />
          ))}
          {adding && (
            <tr className="border-b border-border/50">
              <td className="px-4 py-1.5" colSpan={5}>
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

      {/* Footer: Add Port + Settings */}
      <div className="flex items-center justify-between">
        {!adding ? (
          <button
            onClick={startAdding}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Add Port</span>
          </button>
        ) : (
          <div />
        )}
        <button
          onClick={() => setShowSettings(true)}
          className="px-4 py-1.5 text-text-muted hover:text-text-primary transition-colors"
          title="Port forwarding settings"
        >
          <Settings className="w-3 h-3" />
        </button>
      </div>

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
  onForward,
  onClose,
  onSetPortRelay,
}: {
  port: MergedPort;
  loading: boolean;
  onForward?: (port: number) => void;
  onClose: (port: number) => void;
  onSetPortRelay?: (port: number, enabled: boolean) => Promise<{ success: boolean; localPort?: number; error?: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  
  const getPortStatus = () => {
    if (port.relay) {
      switch (port.relay.status) {
        case 'forwarding':
          return { text: 'Forwarded', color: 'text-green-400', bgColor: 'bg-green-500/20', icon: 'bg-green-500' };
        case 'failed':
          return { text: 'Failed', color: 'text-red-400', bgColor: 'bg-red-500/20', icon: 'bg-red-500' };
        case 'stopped':
          return { text: 'Stopped', color: 'text-text-muted', bgColor: 'bg-text-muted/10', icon: 'bg-text-muted/40' };
        default:
          return { text: 'Unknown', color: 'text-text-muted', bgColor: 'bg-text-muted/10', icon: 'bg-text-muted/40' };
      }
    }
    if (port.active) {
      return { text: 'Detected', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', icon: 'bg-yellow-500' };
    }
    return { text: 'Inactive', color: 'text-text-muted', bgColor: 'bg-text-muted/10', icon: 'bg-text-muted/40' };
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

  const urlInfo = port.relay && port.relay.status === 'forwarding'
    ? { url: `http://${port.relay.localhostUrl}`, label: port.relay.localhostUrl }
    : null;

  return (
    <tr className="border-b border-border/50 hover:bg-terminal-bg/50 transition-colors group">
      <td className="px-4 py-1.5">
        <span className="flex items-center gap-2 font-mono">
          <span className={cn('w-2 h-2 rounded-full shrink-0', status.icon)} />
          {port.port}
        </span>
      </td>
      
      <td className="px-4 py-1.5">
        {urlInfo ? (
          <div className="flex items-center gap-1.5">
            <a
              href={urlInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-mono text-xs truncate max-w-[200px]"
              title={urlInfo.url}
            >
              {urlInfo.label}
            </a>
            <button
              onClick={() => handleCopyUrl(urlInfo.url)}
              className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
              title="Copy URL"
            >
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        ) : (
          <span className="text-text-muted/50 text-xs">Not forwarded</span>
        )}
      </td>
      
      <td className="px-4 py-1.5 text-text-muted truncate max-w-[200px]" title={port.command}>
        {port.command || port.process || '—'}
      </td>
      
      <td className="px-4 py-1.5">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          status.color, status.bgColor
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', status.icon)} />
          {status.text}
        </span>
      </td>
      
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-1.5">
          {onSetPortRelay && (
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
                <ArrowRightLeft className={cn("w-3 h-3", port.relay?.status === 'forwarding' && "text-green-400")} />
              )}
            </button>
          )}
          
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
          
          {urlInfo && (
            <a
              href={urlInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
              title="Open in browser"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          
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
