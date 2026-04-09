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
