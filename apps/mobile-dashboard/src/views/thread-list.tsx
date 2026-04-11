import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Thread } from '../api';
import { ThreadStatusIcon, timeAgo, BackButton } from '../components';

interface Props {
  projectId: string;
  projectName: string;
}

export function ThreadList({ projectId, projectName }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setThreads(await api.projectThreads(projectId));
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh when any thread is running
  const hasRunningRef = useRef(false);
  useEffect(() => {
    hasRunningRef.current = threads.some((t) => t.status === 'running');
  }, [threads]);

  useEffect(() => {
    const poll = setInterval(async () => {
      if (!hasRunningRef.current) return;
      try {
        const updated = await api.projectThreads(projectId);
        setThreads(updated);
      } catch { /* retry */ }
    }, 3000);
    return () => clearInterval(poll);
  }, [projectId]);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <BackButton href="#/" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{projectName || 'Threads'}</h1>
          <p className="text-sm text-text-secondary">{threads.length} thread{threads.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={load} className="text-sm text-text-secondary active:text-text">Refresh</button>
      </div>

      {loading && threads.length === 0 && (
        <p className="py-12 text-center text-text-muted">Loading...</p>
      )}

      <div className="space-y-3">
        {threads.map((t) => (
          <a
            key={t.id}
            href={`#/thread/${t.id}?pid=${projectId}&pname=${encodeURIComponent(projectName)}&title=${encodeURIComponent(t.title)}`}
            className="block rounded-xl border border-border bg-surface-card p-4 active:bg-surface-elevated"
          >
            <div className="flex items-center gap-3">
              <ThreadStatusIcon status={t.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.title}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
              <span className="capitalize">{t.status.replace(/_/g, ' ')}</span>
              {t.agentType && <span>{t.agentType}</span>}
              <span className="ml-auto">{timeAgo(t.updatedAt)}</span>
            </div>
          </a>
        ))}
      </div>

      {!loading && threads.length === 0 && (
        <p className="py-12 text-center text-text-muted">No threads yet</p>
      )}
    </div>
  );
}
