import { useState, useRef, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

interface Props {
  status: string;
  sandboxId: string | null;
  statusError?: string | null;
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
  running: {
    label: 'Running',
    color: 'text-emerald-500',
    dotColor: 'bg-emerald-400',
  },
  stopped: {
    label: 'Stopped',
    color: 'text-gray-400',
    dotColor: 'bg-gray-400',
  },
  error: {
    label: 'Error',
    color: 'text-red-500',
    dotColor: 'bg-red-400',
  },
};

export function SandboxStatus({ status, sandboxId, statusError }: Props) {
  const config = statusConfig[status] || statusConfig.stopped;
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPopover) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPopover]);

  const hasError = status === 'error' && !!statusError;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 text-xs',
          hasError && 'cursor-pointer hover:underline',
        )}
        title={
          hasError
            ? 'Click to view error details'
            : sandboxId
              ? `Sandbox: ${sandboxId}`
              : 'No sandbox yet'
        }
        onClick={() => hasError && setShowPopover((v) => !v)}
      >
        {config.animate ? (
          <Loader2 className={cn('w-3 h-3 animate-spin', config.color)} />
        ) : (
          <span className="relative flex h-2 w-2">
            {status === 'running' && (
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
        {hasError && <AlertCircle className="w-3 h-3 text-red-400" />}
      </button>

      {showPopover && hasError && (
        <div className="absolute bottom-full right-0 mb-2 w-80 max-w-[90vw] rounded-lg border border-red-500/30 bg-surface shadow-lg z-50">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-xs font-medium text-red-400">Sandbox Error</span>
          </div>
          <div className="px-3 py-2">
            <p className="text-xs text-text-secondary break-words whitespace-pre-wrap leading-relaxed">
              {statusError}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
