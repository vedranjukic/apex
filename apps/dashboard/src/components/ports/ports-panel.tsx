import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { Loader2, Plus, ExternalLink, Copy, Check, X, ArrowRightLeft } from 'lucide-react';
import { usePortsStore, type MergedPort } from '../../stores/ports-store';
import { cn } from '../../lib/cn';

const isElectron = !!(window as any).apex?.isElectron;

interface PortsPanelProps {
  requestPreviewUrl: (port: number) => Promise<{ url: string; token?: string }>;
  forwardPort: (port: number) => Promise<{ localPort: number; url: string }>;
  provider: string;
}

export function PortsPanel({ requestPreviewUrl, forwardPort, provider }: PortsPanelProps) {
  const allPorts = usePortsStore((s) => s.allPorts);
  const addUserPort = usePortsStore((s) => s.addUserPort);
  const closePort = usePortsStore((s) => s.closePort);
  const setPreviewUrl = usePortsStore((s) => s.setPreviewUrl);
  const merged = allPorts();

  const [loadingPort, setLoadingPort] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [portInput, setPortInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const showForward = isElectron && (provider === 'docker' || provider === 'apple-container');

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

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs text-text-secondary whitespace-nowrap">
        <thead>
          <tr className="text-left text-text-muted border-b border-border">
            <th className="px-4 py-1.5 font-medium w-[120px]">Port</th>
            <th className="px-4 py-1.5 font-medium w-[160px]">Forwarded Address</th>
            <th className="px-4 py-1.5 font-medium">Running Process</th>
            <th className="px-4 py-1.5 font-medium w-[130px]">Origin</th>
            <th className="px-4 py-1.5 font-medium">Preview URL</th>
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
      {!adding && (
        <button
          onClick={startAdding}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>Add Port</span>
        </button>
      )}
    </div>
  );
}

function PortRow({
  port,
  loading,
  onOpenPreview,
  onForward,
  onClose,
}: {
  port: MergedPort;
  loading: boolean;
  onOpenPreview: (port: number) => void;
  onForward?: (port: number) => void;
  onClose: (port: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const originLabel = port.origin === 'user' ? 'User Forwarded' : 'Auto Forwarded';

  const handleCopyUrl = useCallback(() => {
    if (!port.previewUrl) return;
    navigator.clipboard.writeText(port.previewUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [port.previewUrl]);

  return (
    <tr className="border-b border-border/50 hover:bg-terminal-bg/50 transition-colors group">
      <td className="px-4 py-1.5">
        <span className="flex items-center gap-2 font-mono">
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              port.active ? 'bg-green-500' : 'bg-text-muted/40',
            )}
          />
          {port.port}
        </span>
      </td>
      <td className="px-4 py-1.5">
        <button
          onClick={() => onOpenPreview(port.port)}
          disabled={loading}
          className="text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : null}
          <span>localhost:{port.port}</span>
        </button>
      </td>
      <td className="px-4 py-1.5 text-text-muted truncate max-w-[300px]" title={port.command}>
        {port.command || (port.process || '')}
      </td>
      <td className="px-4 py-1.5 text-text-muted">
        {originLabel}
      </td>
      <td className="px-4 py-1.5">
        <span className="flex items-center gap-1.5">
          {port.previewUrl ? (
            <>
              <a
                href={port.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate max-w-[260px] inline-block"
                title={port.previewUrl}
              >
                {port.previewUrl}
              </a>
              <button
                onClick={handleCopyUrl}
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
                title="Copy URL"
              >
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
              <a
                href={port.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
                title="Open in browser"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </>
          ) : (
            <span className="text-text-muted/50">resolving...</span>
          )}
          {onForward && (
            <button
              onClick={() => onForward(port.port)}
              disabled={loading}
              className="shrink-0 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
              title="Forward port to localhost"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
            </button>
          )}
          <button
            onClick={() => onClose(port.port)}
            className="shrink-0 ml-auto text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            title="Close port"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      </td>
    </tr>
  );
}
