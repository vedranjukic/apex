import { useState, useRef, useEffect } from 'react';
import { Loader2, AlertCircle, Play, Square, RotateCw, WifiOff } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useNetworkStore } from '../../stores/network-store';
import { getEffectiveSandboxStatus, isSandboxRunning } from '../../lib/sandbox-utils';

interface Props {
  status: string;
  sandboxId: string | null;
  statusError?: string | null;
  provider?: string;
  onStop?: () => void;
  onStart?: () => void;
  onRestart?: () => void;
}

const statusConfig: Record<
  string,
  { label: string; color: string; dotColor: string; animate?: boolean }
> = {
  creating: {
    label: 'Provisioning…',
    color: 'text-yellow-500',
    dotColor: 'bg-yellow-400',
    animate: true,
  },
  pulling_image: {
    label: 'Pulling image…',
    color: 'text-yellow-500',
    dotColor: 'bg-yellow-400',
    animate: true,
  },
  starting: {
    label: 'Starting…',
    color: 'text-yellow-500',
    dotColor: 'bg-yellow-400',
    animate: true,
  },
  stopping: {
    label: 'Stopping…',
    color: 'text-yellow-500',
    dotColor: 'bg-yellow-400',
    animate: true,
  },
  running: {
    label: 'Running',
    color: 'text-emerald-500',
    dotColor: 'bg-emerald-400',
  },
  'running-offline': {
    label: 'Running (Offline)',
    color: 'text-orange-500',
    dotColor: 'bg-orange-400',
  },
  stopped: {
    label: 'Stopped',
    color: 'text-text-muted',
    dotColor: 'bg-text-muted',
  },
  error: {
    label: 'Error',
    color: 'text-red-500',
    dotColor: 'bg-red-400',
  },
};

export function SandboxStatus({ status, sandboxId, statusError, provider, onStop, onStart, onRestart }: Props) {
  const networkStore = useNetworkStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine effective status based on network state for Daytona sandboxes
  const isDaytonaSandbox = provider === 'daytona';
  const isNetworkOffline = !networkStore.isOnline || networkStore.connectionType === 'offline';
  const effectiveStatus = getEffectiveSandboxStatus(status, provider || '', isNetworkOffline);

  const config = statusConfig[effectiveStatus] || statusConfig.stopped;

  const hasError = effectiveStatus === 'error' && !!statusError;
  const isRunning = isSandboxRunning(effectiveStatus);
  const isStopped = effectiveStatus === 'stopped' || effectiveStatus === 'error';
  const hasActions = isRunning || isStopped;
  const showOfflineIndicator = isDaytonaSandbox && isNetworkOffline && effectiveStatus === 'running-offline';

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const itemClass =
    'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-hover text-text-secondary hover:text-text-primary';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 text-xs transition-colors',
          hasActions && 'hover:text-text-primary cursor-pointer',
          menuOpen && 'text-text-primary',
        )}
        title={sandboxId ? `Sandbox: ${sandboxId}` : 'No sandbox yet'}
        onClick={() => hasActions && setMenuOpen((v) => !v)}
      >
        {config.animate ? (
          <Loader2 className={cn('w-3 h-3 animate-spin', config.color)} />
        ) : (
          <span className="relative flex h-2 w-2">
            {effectiveStatus === 'running' && (
              <span
                className={cn(
                  'absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping',
                  config.dotColor,
                )}
              />
            )}
            <span
              className={cn(
                'relative inline-flex h-2 w-2 rounded-full',
                config.dotColor,
              )}
            />
          </span>
        )}
        <span className={config.color}>{config.label}</span>
        {showOfflineIndicator && <WifiOff className="w-3 h-3 text-orange-400" />}
        {hasError && <AlertCircle className="w-3 h-3 text-red-400" />}
      </button>

      {menuOpen && (
        <div className="absolute bottom-full right-0 mb-1 w-52 rounded-lg border border-border bg-sidebar shadow-xl z-50 py-1">
          {/* Error details */}
          {hasError && (
            <>
              <div className="px-3 py-2">
                <p className="text-[11px] text-red-400 break-words whitespace-pre-wrap leading-relaxed line-clamp-4">
                  {statusError}
                </p>
              </div>
              <div className="border-t border-border my-1" />
            </>
          )}

          {/* Actions */}
          {isStopped && onStart && (
            <button
              type="button"
              className={itemClass}
              onClick={() => { setMenuOpen(false); onStart(); }}
            >
              <Play className="w-3.5 h-3.5 text-green-400" />
              Start sandbox
            </button>
          )}
          {isStopped && onRestart && (
            <button
              type="button"
              className={itemClass}
              onClick={() => { setMenuOpen(false); onRestart(); }}
            >
              <RotateCw className="w-3.5 h-3.5 text-yellow-400" />
              Restart sandbox
            </button>
          )}
          {isRunning && onRestart && (
            <button
              type="button"
              className={itemClass}
              onClick={() => { setMenuOpen(false); onRestart(); }}
            >
              <RotateCw className="w-3.5 h-3.5 text-yellow-400" />
              Restart sandbox
            </button>
          )}
          {isRunning && onStop && (
            <button
              type="button"
              className={itemClass}
              onClick={() => { setMenuOpen(false); onStop(); }}
            >
              <Square className="w-3.5 h-3.5 text-red-400" />
              Stop sandbox
            </button>
          )}
        </div>
      )}
    </div>
  );
}
