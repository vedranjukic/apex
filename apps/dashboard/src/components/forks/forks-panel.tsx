import { useEffect, useState, useCallback } from 'react';
import { GitBranch, Plus, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../stores/projects-store';
import { openProject } from '../../lib/open-project';
import type { Project } from '../../api/client';


interface ForksPanelProps {
  projectId: string;
}

const statusDot: Record<string, { color: string; animate?: boolean }> = {
  creating: { color: 'bg-yellow-400', animate: true },
  running: { color: 'bg-emerald-400' },
  stopped: { color: 'bg-gray-400' },
  error: { color: 'bg-red-400' },
};

export function ForksPanel({ projectId }: ForksPanelProps) {
  const { forks, forksLoading, fetchForks, forkProject } = useProjectsStore();
  const [creating, setCreating] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchForks(projectId);
  }, [projectId, fetchForks]);

  const handleCreate = useCallback(async () => {
    const name = branchName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const forked = await forkProject(projectId, name);
      setBranchName('');
      setShowForm(false);
      openProject(forked.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [branchName, projectId, forkProject]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreate();
      } else if (e.key === 'Escape') {
        setShowForm(false);
        setBranchName('');
        setError(null);
      }
    },
    [handleCreate],
  );

  const openFork = useCallback((fork: Project) => {
    openProject(fork.id);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {/* Create fork button / form */}
      {showForm ? (
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Branch name…"
            autoFocus
            disabled={creating}
            className="w-full px-2 py-1 text-xs bg-sidebar-hover border border-panel-border rounded text-panel-text placeholder-text-muted outline-none focus:border-primary"
          />
          <div className="flex gap-1">
            <button
              onClick={handleCreate}
              disabled={creating || !branchName.trim()}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-40 transition-colors"
            >
              {creating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              Fork
            </button>
            <button
              onClick={() => { setShowForm(false); setBranchName(''); setError(null); }}
              className="px-2 py-1 text-xs rounded text-panel-text-muted hover:text-panel-text hover:bg-sidebar-hover transition-colors"
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="text-[10px] text-red-400 break-words">{error}</p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-panel-text-muted hover:text-panel-text hover:bg-sidebar-hover rounded transition-colors w-full"
        >
          <Plus className="w-3.5 h-3.5" />
          New Fork
        </button>
      )}

      {/* Fork family list */}
      {forksLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
        </div>
      ) : forks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-text-muted text-center">
          <GitBranch className="w-7 h-7 mb-2 opacity-30" />
          <p className="text-[11px]">No forks yet</p>
          <p className="text-[10px] text-text-muted mt-0.5">
            Fork this project to work on a new branch
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {forks.map((fork) => {
            const isCurrent = fork.id === projectId;
            const dot = statusDot[fork.status] || statusDot.stopped;
            const isRoot = fork.forkedFromId === null;

            return (
              <button
                key={fork.id}
                onClick={() => !isCurrent && openFork(fork)}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded text-left w-full transition-colors group',
                  isCurrent
                    ? 'bg-sidebar-active text-panel-text'
                    : 'text-panel-text-muted hover:bg-sidebar-hover hover:text-panel-text',
                )}
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  {fork.status === 'running' && (
                    <span
                      className={cn(
                        'absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping',
                        dot.color,
                      )}
                    />
                  )}
                  {dot.animate ? (
                    <Loader2 className="w-2 h-2 animate-spin text-yellow-400" />
                  ) : (
                    <span
                      className={cn(
                        'relative inline-flex h-2 w-2 rounded-full',
                        dot.color,
                      )}
                    />
                  )}
                </span>

                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs truncate">
                    {fork.name}
                    {isCurrent && (
                      <span className="ml-1 text-[10px] text-primary font-medium">
                        (current)
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-text-muted truncate flex items-center gap-1">
                    <GitBranch className="w-2.5 h-2.5 shrink-0" />
                    {fork.branchName || (isRoot ? 'main' : '—')}
                  </span>
                </div>

                {!isCurrent && (
                  <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
