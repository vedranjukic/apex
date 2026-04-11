import { useState, useEffect, useCallback } from 'react';
import { api, clearToken, type Project, type Thread } from '../api';
import { StatusDot, ThreadStatusIcon, timeAgo } from '../components';

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [threadsByProject, setThreadsByProject] = useState<Record<string, Thread[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const projs = await api.projects();
      setProjects(projs);

      const results = await Promise.allSettled(
        projs.map((p) => api.projectThreads(p.id)),
      );
      const map: Record<string, Thread[]> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') map[projs[i].id] = r.value;
      });
      setThreadsByProject(map);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="text-sm text-text-secondary active:text-text"
          >
            Refresh
          </button>
          <button
            onClick={() => { clearToken(); window.location.hash = '#/auth'; }}
            className="text-sm text-text-muted active:text-danger"
          >
            Logout
          </button>
        </div>
      </div>

      {loading && projects.length === 0 && (
        <p className="py-12 text-center text-text-muted">Loading...</p>
      )}
      {error && (
        <p className="py-12 text-center text-danger">{error}</p>
      )}

      <div className="space-y-3">
        {projects.map((p) => (
          <a
            key={p.id}
            href={`#/project/${p.id}?name=${encodeURIComponent(p.name)}`}
            className="block rounded-xl border border-border bg-surface-card p-4 active:bg-surface-elevated"
          >
            <div className="flex items-center gap-3">
              <StatusDot status={p.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                {p.description && (
                  <div className="mt-0.5 truncate text-sm text-text-secondary">{p.description}</div>
                )}
              </div>
            </div>

            <ThreadPreviewList threads={threadsByProject[p.id]} />

            <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
              <span className="capitalize">{p.status}</span>
              {p.gitRepo && <span className="truncate">{repoShort(p.gitRepo)}</span>}
              <span className="ml-auto">{timeAgo(p.createdAt)}</span>
            </div>
          </a>
        ))}
      </div>

      {!loading && projects.length === 0 && !error && (
        <p className="py-12 text-center text-text-muted">No projects yet</p>
      )}
    </div>
  );
}

function ThreadPreviewList({ threads }: { threads?: Thread[] }) {
  if (!threads || threads.length === 0) return null;

  return (
    <div className="mt-2.5 space-y-1 border-t border-border/50 pt-2">
      {threads.slice(0, 5).map((t) => (
        <div key={t.id} className="flex items-center gap-2 text-xs">
          <ThreadStatusIcon status={t.status} />
          <span className="min-w-0 flex-1 truncate text-text-secondary">{t.title}</span>
          {t.agentType && (
            <span className="shrink-0 text-text-muted">{t.agentType}</span>
          )}
        </div>
      ))}
      {threads.length > 5 && (
        <div className="text-xs text-text-muted">+{threads.length - 5} more</div>
      )}
    </div>
  );
}

function repoShort(url: string): string {
  try {
    return url.replace(/^https?:\/\/(github\.com\/)?/, '').replace(/\.git$/, '');
  } catch {
    return url;
  }
}
