const STATUS_COLORS: Record<string, string> = {
  running: 'bg-accent',
  creating: 'bg-warning animate-pulse',
  starting: 'bg-warning animate-pulse',
  pulling_image: 'bg-warning animate-pulse',
  stopping: 'bg-warning',
  stopped: 'bg-text-muted',
  error: 'bg-danger',
  completed: 'bg-accent',
  idle: 'bg-primary',
  waiting_for_input: 'bg-warning',
  waiting_for_user_action: 'bg-warning',
};

export function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || 'bg-text-muted';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />;
}

const S = 14;
const svgProps = { width: S, height: S, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function ThreadStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'waiting_for_input':
      return (
        <svg {...svgProps} className="shrink-0 text-yellow-400">
          <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'waiting_for_user_action':
      return (
        <svg {...svgProps} className="shrink-0 text-yellow-400">
          <circle cx="12" cy="12" r="10" /><line x1="10" y1="15" x2="10" y2="15.01" /><line x1="14" y1="15" x2="14" y2="15.01" /><line x1="10" y1="9" x2="10" y2="12" /><line x1="14" y1="9" x2="14" y2="12" />
        </svg>
      );
    case 'running':
      return (
        <svg {...svgProps} className="shrink-0 text-yellow-400 animate-spin">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      );
    case 'completed':
      return (
        <svg {...svgProps} className="shrink-0 text-green-400">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'error':
      return (
        <svg {...svgProps} className="shrink-0 text-red-400">
          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    default:
      return (
        <svg {...svgProps} className="shrink-0 text-text-muted">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function BackButton({ href }: { href: string }) {
  return (
    <a href={href} className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary active:bg-surface-elevated">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </a>
  );
}
