import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, FolderOpen, Trash2, ExternalLink, Loader2, CheckCircle2,
  CircleHelp, CirclePause, XCircle, Circle, GitBranch, ChevronDown, ChevronRight, Settings, Shield,
  Play, Square, RotateCw, MoreHorizontal, GitFork, CircleDot, GitPullRequest, Github,
  Search, SlidersHorizontal, X,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../stores/projects-store';
import { useProjectsSocket } from '../../hooks/use-projects-socket';
import { CreateProjectDialog } from './create-project-dialog';
import { settingsApi, projectsApi, githubApi } from '../../api/client';
import type { Project, Thread, GitHubUser } from '../../api/client';

const STATUS_LABELS: Record<string, string> = {
  creating: 'creating',
  pulling_image: 'pulling image',
  starting: 'starting',
  stopping: 'stopping',
  deleting: 'deleting',
  running: 'running',
  stopped: 'stopped',
  error: 'error',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  creating: 'bg-yellow-400',
  pulling_image: 'bg-yellow-400',
  starting: 'bg-yellow-400',
  stopping: 'bg-yellow-400',
  deleting: 'bg-yellow-400',
  running: 'bg-green-400',
  stopped: 'bg-gray-400',
  error: 'bg-red-400',
};

function ThreadStatusIcon({ status, className }: { status: string; className?: string }) {
  const size = className ?? 'w-3 h-3';
  switch (status) {
    case 'waiting_for_input':
      return <CircleHelp className={cn(size, 'text-yellow-400 shrink-0')} />;
    case 'waiting_for_user_action':
      return <CirclePause className={cn(size, 'text-yellow-400 shrink-0')} />;
    case 'running':
      return <Loader2 className={cn(size, 'text-yellow-400 animate-spin shrink-0')} />;
    case 'completed':
      return <CheckCircle2 className={cn(size, 'text-green-400 shrink-0')} />;
    case 'error':
      return <XCircle className={cn(size, 'text-red-400 shrink-0')} />;
    default:
      return <Circle className={cn(size, 'text-text-muted shrink-0')} />;
  }
}

const THREAD_STATUS_PRIORITY: Record<string, number> = {
  waiting_for_user_action: 0,
  waiting_for_input: 1,
  running: 2,
  error: 3,
  completed: 4,
};

function pickTopThreadStatus(threads: Thread[]): string | null {
  if (!threads.length) return null;
  let best: Thread | null = null;
  for (const t of threads) {
    const p = THREAD_STATUS_PRIORITY[t.status] ?? 99;
    if (!best || p < (THREAD_STATUS_PRIORITY[best.status] ?? 99)) best = t;
  }
  return best?.status ?? null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function extractRepoSlug(gitRepo: string): string | null {
  const m = gitRepo.match(/github\.com\/([^/]+\/[^/.]+)/);
  return m ? m[1] : null;
}

function SandboxControls({ project, className }: { project: Project; className?: string }) {
  const { fetchProjects, setProjectStatus } = useProjectsStore();
  const iconSize = className ?? 'w-4 h-4';

  const isRunning = project.status === 'running';
  const isStopped = project.status === 'stopped' || project.status === 'error';
  const isTransitioning = project.status === 'starting' || project.status === 'stopping' || project.status === 'creating' || project.status === 'pulling_image' || project.status === 'deleting';

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setProjectStatus(project.id, 'stopping');
    try { await projectsApi.stop(project.id); } catch { /* ignore */ }
    finally { fetchProjects(); }
  };

  const handleStart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setProjectStatus(project.id, 'starting');
    try { await projectsApi.start(project.id); } catch { /* ignore */ }
    finally { fetchProjects(); }
  };

  const handleRestart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setProjectStatus(project.id, 'stopping');
    try { await projectsApi.restart(project.id); } catch { /* ignore */ }
    finally { fetchProjects(); }
  };

  if (isTransitioning) {
    return (
      <span className="p-1.5" title={project.status}>
        <Loader2 className={cn(iconSize, 'animate-spin text-text-muted')} />
      </span>
    );
  }

  if (isStopped) {
    return (
      <button
        onClick={handleStart}
        className="p-1.5 rounded-lg hover:bg-green-400/10 text-text-secondary hover:text-green-400 transition-colors"
        title="Start sandbox"
      >
        <Play className={iconSize} />
      </button>
    );
  }

  if (isRunning) {
    return (
      <div className="flex items-center">
        <button
          onClick={handleRestart}
          className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-yellow-400 transition-colors"
          title="Restart sandbox"
        >
          <RotateCw className={iconSize} />
        </button>
        <button
          onClick={handleStop}
          className="p-1.5 rounded-lg hover:bg-red-400/10 text-text-secondary hover:text-red-400 transition-colors"
          title="Stop sandbox"
        >
          <Square className={iconSize} />
        </button>
      </div>
    );
  }

  return null;
}

interface ForkGroup {
  root: Project;
  forks: Project[];
}

function groupByForkFamily(projects: Project[]): ForkGroup[] {
  const rootMap = new Map<string, ForkGroup>();
  const standalone: ForkGroup[] = [];

  for (const p of projects) {
    if (!p.forkedFromId) {
      rootMap.set(p.id, { root: p, forks: [] });
    }
  }

  for (const p of projects) {
    if (p.forkedFromId) {
      const group = rootMap.get(p.forkedFromId);
      if (group) {
        group.forks.push(p);
      } else {
        standalone.push({ root: p, forks: [] });
      }
    }
  }

  const groups: ForkGroup[] = [];
  for (const p of projects) {
    if (!p.forkedFromId && rootMap.has(p.id)) {
      groups.push(rootMap.get(p.id)!);
    }
  }
  groups.push(...standalone);
  return groups;
}

const THREAD_STATUS_OPTIONS = [
  { value: 'running', label: 'Running', icon: Loader2, color: 'text-yellow-400' },
  { value: 'waiting_for_input', label: 'Waiting for input', icon: CircleHelp, color: 'text-yellow-400' },
  { value: 'waiting_for_user_action', label: 'Waiting for action', icon: CirclePause, color: 'text-yellow-400' },
  { value: 'completed', label: 'Completed', icon: CheckCircle2, color: 'text-green-400' },
  { value: 'error', label: 'Error', icon: XCircle, color: 'text-red-400' },
] as const;

function projectMatchesText(project: Project, query: string): boolean {
  const q = query.toLowerCase();
  if (project.name.toLowerCase().includes(q)) return true;
  if (project.description?.toLowerCase().includes(q)) return true;
  if (project.gitRepo?.toLowerCase().includes(q)) return true;
  return false;
}

function projectMatchesThreadStatus(project: Project, statuses: Set<string>): boolean {
  if (statuses.size === 0) return true;
  const threads = project.threads ?? [];
  return threads.some((t) => statuses.has(t.status));
}

function filterGroups(groups: ForkGroup[], query: string, statuses: Set<string>): ForkGroup[] {
  const hasQuery = query.trim().length > 0;
  const hasStatus = statuses.size > 0;
  if (!hasQuery && !hasStatus) return groups;

  const result: ForkGroup[] = [];
  for (const group of groups) {
    const rootTextMatch = !hasQuery || projectMatchesText(group.root, query);
    const rootStatusMatch = !hasStatus || projectMatchesThreadStatus(group.root, statuses);
    const rootMatch = rootTextMatch && rootStatusMatch;

    const matchingForks = group.forks.filter((fork) => {
      const textMatch = !hasQuery || projectMatchesText(fork, query);
      const statusMatch = !hasStatus || projectMatchesThreadStatus(fork, statuses);
      return textMatch && statusMatch;
    });

    if (rootMatch || matchingForks.length > 0) {
      result.push({ root: group.root, forks: rootMatch ? group.forks : matchingForks });
    }
  }
  return result;
}

interface Props {
  onOpenProject: (id: string) => void;
  onSelectThread?: (projectId: string, threadId: string, projectName: string) => void;
  onNewThread?: (projectId: string, projectName: string) => void;
  activeProjectId?: string | null;
}

export function ProjectList({ onOpenProject, onSelectThread, onNewThread, activeProjectId }: Props) {
  const { projects, loading, fetchProjects, deleteProject } = useProjectsStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [ghLoaded, setGhLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  useProjectsSocket();

  useEffect(() => {
    fetchProjects();
    settingsApi.visible().then((r) => setSettingsVisible(r.visible)).catch(() => {});
    githubApi.user().then((u) => { if (u) setGhUser(u); }).catch(() => {}).finally(() => setGhLoaded(true));
    const interval = setInterval(fetchProjects, 3000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  const groups = useMemo(() => groupByForkFamily(projects), [projects]);
  const filteredGroups = useMemo(
    () => filterGroups(groups, searchQuery, statusFilters),
    [groups, searchQuery, statusFilters],
  );

  const toggleStatus = useCallback((status: string) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilters(new Set());
    setShowFilters(false);
  }, []);

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilters.size > 0;

  return (
    <div className="flex-1 p-4 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold">Projects</h1>
          <div className="flex items-center gap-2">
            {ghLoaded && (
              ghUser?.login ? (
                <a
                  href={`https://github.com/${ghUser.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
                  title={`${ghUser.name} (${ghUser.email})`}
                >
                  {ghUser.avatarUrl ? (
                    <img
                      src={ghUser.avatarUrl}
                      alt={ghUser.login}
                      className="w-4 h-4 rounded-full"
                    />
                  ) : (
                    <Github className="w-3.5 h-3.5" />
                  )}
                  <span className="font-medium">{ghUser.login}</span>
                </a>
              ) : (
                <button
                  onClick={() => navigate('/settings')}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-text-muted hover:text-text-secondary hover:bg-surface-secondary transition-colors"
                  title="Configure GitHub token in settings"
                >
                  <Github className="w-3.5 h-3.5" />
                  <span>GitHub not connected</span>
                </button>
              )
            )}
            {settingsVisible && (
              <>
                <button
                  onClick={() => navigate('/secrets')}
                  className="p-2 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
                  title="Secrets"
                >
                  <Shield className="w-4 h-4" />
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="p-2 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>
        </div>

        {projects.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, description, or repo..."
                  className="w-full pl-8 pr-8 py-1.5 text-sm bg-surface border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-secondary text-text-muted hover:text-text-secondary transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowFilters((v) => !v)}
                className={cn(
                  'p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-primary transition-colors',
                  showFilters && 'bg-surface-secondary text-primary',
                  statusFilters.size > 0 && !showFilters && 'text-primary',
                )}
                title="Filter by thread status"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="px-2 py-1 rounded-lg text-xs text-text-muted hover:text-text-secondary hover:bg-surface-secondary transition-colors"
                  title="Clear all filters"
                >
                  Clear
                </button>
              )}
            </div>
            {showFilters && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-text-muted mr-0.5">Thread status:</span>
                {THREAD_STATUS_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = statusFilters.has(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleStatus(opt.value)}
                      className={cn(
                        'flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-colors border',
                        active
                          ? 'border-primary/40 bg-primary/10 text-text-primary'
                          : 'border-border bg-surface hover:bg-surface-secondary text-text-secondary',
                      )}
                    >
                      <Icon className={cn('w-3 h-3', active ? opt.color : 'text-text-muted', opt.value === 'running' && active && 'animate-spin')} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {loading && projects.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16 text-text-secondary">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 text-text-muted" />
            <p className="text-lg font-medium">No projects yet</p>
            <p className="text-sm mt-1">Create your first project to get started</p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="text-center py-12 text-text-secondary">
            <Search className="w-8 h-8 mx-auto mb-2 text-text-muted" />
            <p className="text-sm font-medium">No matching projects</p>
            <p className="text-xs mt-1 text-text-muted">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {filteredGroups.map((group) =>
              group.forks.length === 0 ? (
                <ProjectCard
                  key={group.root.id}
                  project={group.root}
                  onOpen={() => onOpenProject(group.root.id)}
                  onDelete={() => deleteProject(group.root.id)}
                  onSelectThread={onSelectThread}
                  onNewThread={onNewThread}
                  activeProjectId={activeProjectId}
                />
              ) : (
                <ForkGroupCard
                  key={group.root.id}
                  group={group}
                  onOpenProject={onOpenProject}
                  onDeleteProject={deleteProject}
                  onSelectThread={onSelectThread}
                  onNewThread={onNewThread}
                  activeProjectId={activeProjectId}
                />
              ),
            )}
          </div>
        )}
      </div>

      <CreateProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => fetchProjects()}
      />
    </div>
  );
}

function ThreadList({
  threads,
  projectId,
  projectName,
  onSelectThread,
  activeProjectId,
}: {
  threads: Thread[];
  projectId: string;
  projectName: string;
  onSelectThread?: (projectId: string, threadId: string, projectName: string) => void;
  activeProjectId?: string | null;
}) {
  if (!threads || threads.length === 0) return null;

  const running = threads.filter((c) => c.status === 'running').length;
  const errors = threads.filter((c) => c.status === 'error').length;
  const waiting = threads.filter((c) => c.status === 'waiting_for_input' || c.status === 'waiting_for_user_action').length;
  const isActive = activeProjectId === projectId;
  const [expanded, setExpanded] = useState(waiting > 0 || isActive);

  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  return (
    <div className="mt-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>{threads.length} thread{threads.length !== 1 ? 's' : ''}</span>
        {running > 0 && (
          <span className="flex items-center gap-0.5 text-yellow-400">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {running}
          </span>
        )}
        {waiting > 0 && (
          <span className="flex items-center gap-0.5 text-yellow-400">
            <CircleHelp className="w-2.5 h-2.5" />
            {waiting}
          </span>
        )}
        {errors > 0 && (
          <span className="flex items-center gap-0.5 text-red-400">
            <XCircle className="w-2.5 h-2.5" />
            {errors}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 space-y-px">
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectThread?.(projectId, thread.id, projectName);
              }}
              className="flex items-center gap-2 w-full px-2 py-1 rounded text-left hover:bg-surface-secondary/60 transition-colors group"
            >
              <ThreadStatusIcon status={thread.status} className="w-3 h-3" />
              <span className="font-mono text-[10px] text-text-muted shrink-0">{thread.id.slice(0, 8)}</span>
              {thread.agentType && (
                <span className="text-[10px] text-text-muted px-1 rounded bg-surface-secondary/60 shrink-0">
                  {{ claude_code: 'Claude', open_code: 'OpenCode', codex: 'Codex' }[thread.agentType] ?? thread.agentType}
                </span>
              )}
              <span className="text-xs text-text-secondary group-hover:text-text-primary truncate flex-1 min-w-0">
                {thread.title}
              </span>
              <span className="text-[10px] text-text-muted shrink-0">
                {timeAgo(thread.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ForkGroupCard({
  group,
  onOpenProject,
  onDeleteProject,
  onSelectThread,
  onNewThread,
  activeProjectId,
}: {
  group: ForkGroup;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectThread?: (projectId: string, threadId: string, projectName: string) => void;
  onNewThread?: (projectId: string, projectName: string) => void;
  activeProjectId?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-border rounded-xl bg-surface overflow-hidden">
      <ProjectCard
        project={group.root}
        onOpen={() => onOpenProject(group.root.id)}
        onDelete={() => onDeleteProject(group.root.id)}
        onSelectThread={onSelectThread}
        onNewThread={onNewThread}
        noBorder
        activeProjectId={activeProjectId}
      />

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary hover:bg-surface-secondary/50 transition-colors border-t border-border"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <GitBranch className="w-3 h-3" />
        {group.forks.length} fork{group.forks.length !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <div className="border-t border-border">
          {group.forks.map((fork) => (
            <ForkRow
              key={fork.id}
              project={fork}
              onOpen={() => onOpenProject(fork.id)}
              onDelete={() => onDeleteProject(fork.id)}
              onSelectThread={onSelectThread}
              onNewThread={onNewThread}
              activeProjectId={activeProjectId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ForkRow({
  project,
  onOpen,
  onDelete,
  onSelectThread,
  onNewThread,
  activeProjectId,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
  onSelectThread?: (projectId: string, threadId: string, projectName: string) => void;
  onNewThread?: (projectId: string, projectName: string) => void;
  activeProjectId?: string | null;
}) {
  const threads = project.threads ?? [];
  const name = project.branchName || project.name;

  return (
    <div className="px-3 py-1.5 hover:bg-surface-secondary/50 transition-colors border-b last:border-b-0 border-border/50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-text-muted pl-2">
          <GitBranch className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn('w-1.5 h-1.5 rounded-full shrink-0 opacity-70', STATUS_DOT_COLORS[project.status] || 'bg-gray-400')}
              title={STATUS_LABELS[project.status] || project.status}
            />
            <span className="text-sm font-medium truncate">{name}</span>
            {(() => { const s = pickTopThreadStatus(threads); return s ? <ThreadStatusIcon status={s} className="w-2.5 h-2.5" /> : null; })()}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <SandboxControls project={project} className="w-3.5 h-3.5" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNewThread?.(project.id, project.branchName || project.name);
            }}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-primary transition-colors"
            title="New thread"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpen}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-primary transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Delete this fork and its sandbox?')) onDelete();
            }}
            className="p-1.5 rounded-lg hover:bg-red-400/10 text-text-secondary hover:text-danger transition-colors"
            title="Delete fork"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {threads.length > 0 && (
        <div className="pl-9">
          <ThreadList
            threads={threads}
            projectId={project.id}
            projectName={name}
            onSelectThread={onSelectThread}
            activeProjectId={activeProjectId}
          />
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
  onSelectThread,
  onNewThread,
  noBorder,
  activeProjectId,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
  onSelectThread?: (projectId: string, threadId: string, projectName: string) => void;
  onNewThread?: (projectId: string, projectName: string) => void;
  noBorder?: boolean;
  activeProjectId?: string | null;
}) {
  const [showMore, setShowMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const threads = project.threads ?? [];

  return (
    <div className={cn(
      'px-3 py-2 transition-colors bg-surface',
      noBorder ? '' : 'border border-border rounded-xl hover:border-primary/30',
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn('w-2 h-2 rounded-full shrink-0 opacity-70', STATUS_DOT_COLORS[project.status] || 'bg-gray-400')}
              title={STATUS_LABELS[project.status] || project.status}
            />
            <h3 className="font-semibold text-sm truncate hover:text-primary transition-colors cursor-pointer" onClick={onOpen}>{project.name}</h3>
            {(() => { const s = pickTopThreadStatus(threads); return s ? <ThreadStatusIcon status={s} className="w-3 h-3" /> : null; })()}
          </div>
          {project.description && (
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              {project.description}
            </p>
          )}
          {project.gitRepo && (
            <RepoInfo gitRepo={project.gitRepo} githubContext={project.githubContext} />
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
            <span>{{ claude_code: 'Claude Code', open_code: 'OpenCode', codex: 'Codex' }[project.agentType] || project.agentType}</span>
            <span>·</span>
            <span>{new Date(project.createdAt).toLocaleDateString()}</span>
          </div>
          {threads.length > 0 && (
            <ThreadList
              threads={threads}
              projectId={project.id}
              projectName={project.name}
              onSelectThread={onSelectThread}
              activeProjectId={activeProjectId}
            />
          )}
        </div>
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNewThread?.(project.id, project.name);
            }}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-primary transition-colors"
            title="New thread"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onOpen}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-primary transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMore((v) => !v);
            }}
            className={cn(
              'p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-primary transition-colors',
              showMore && 'bg-surface-secondary text-primary',
            )}
            title="More actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMore && (
            <>
              <SandboxControls project={project} className="w-4 h-4" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
                className="p-1.5 rounded-lg hover:bg-red-400/10 text-text-secondary hover:text-danger transition-colors"
                title="Delete project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDelete(false)}>
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Delete project</h3>

            <p className="text-xs text-text-secondary mb-4">
              Are you sure you want to delete <span className="font-medium text-text-primary">{project.name}</span> and its sandbox? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmDelete(false); onDelete(); }}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RepoInfo({ gitRepo, githubContext }: { gitRepo: string; githubContext: Project['githubContext'] }) {
  const slug = extractRepoSlug(gitRepo);
  const repoUrl = slug ? `https://github.com/${slug}` : gitRepo;
  const display = slug ?? gitRepo.replace(/^https?:\/\//, '').replace(/\.git$/, '');

  const isIssue = githubContext?.type === 'issue';
  const isPr = githubContext?.type === 'pull';

  return (
    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-text-muted min-w-0">
      <GitFork className="w-3 h-3 shrink-0" />
      <a
        href={repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-mono truncate hover:text-text-secondary hover:underline transition-colors"
      >
        {display}
      </a>
      {(isIssue || isPr) && githubContext && (
        <>
          <span className="text-text-muted/50">·</span>
          {isIssue ? (
            <CircleDot className="w-3 h-3 shrink-0 text-green-400" />
          ) : (
            <GitPullRequest className="w-3 h-3 shrink-0 text-blue-400" />
          )}
          <a
            href={githubContext.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="truncate hover:text-text-secondary hover:underline transition-colors"
          >
            #{githubContext.number} {githubContext.title}
          </a>
        </>
      )}
    </div>
  );
}
