import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, FolderOpen, Trash2, ExternalLink, Loader2, CheckCircle2,
  CircleHelp, CirclePause, XCircle, Circle, GitBranch, ChevronDown, ChevronRight, Settings, Shield,
  Play, Square, RotateCw,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../stores/projects-store';
import { useProjectsSocket } from '../../hooks/use-projects-socket';
import { CreateProjectDialog } from './create-project-dialog';
import { settingsApi, projectsApi } from '../../api/client';
import type { Project, Thread } from '../../api/client';

const STATUS_LABELS: Record<string, string> = {
  creating: 'creating',
  pulling_image: 'pulling image',
  starting: 'starting',
  stopping: 'stopping',
  running: 'running',
  stopped: 'stopped',
  error: 'error',
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

function SandboxControls({ project, className }: { project: Project; className?: string }) {
  const [loading, setLoading] = useState(false);
  const { fetchProjects } = useProjectsStore();
  const iconSize = className ?? 'w-4 h-4';

  const isRunning = project.status === 'running';
  const isStopped = project.status === 'stopped' || project.status === 'error';
  const isTransitioning = project.status === 'starting' || project.status === 'stopping' || project.status === 'creating' || project.status === 'pulling_image';

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try { await projectsApi.stop(project.id); } catch { /* ignore */ }
    finally { setLoading(false); fetchProjects(); }
  };

  const handleStart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try { await projectsApi.start(project.id); } catch { /* ignore */ }
    finally { setLoading(false); fetchProjects(); }
  };

  const handleRestart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try { await projectsApi.restart(project.id); } catch { /* ignore */ }
    finally { setLoading(false); fetchProjects(); }
  };

  if (loading || isTransitioning) {
    return (
      <span className="p-1.5" title={loading ? 'Working…' : project.status}>
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
  const navigate = useNavigate();

  useProjectsSocket();

  useEffect(() => {
    fetchProjects();
    settingsApi.visible().then((r) => setSettingsVisible(r.visible)).catch(() => {});
    const interval = setInterval(fetchProjects, 3000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  const groups = useMemo(() => groupByForkFamily(projects), [projects]);

  return (
    <div className="flex-1 p-4 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold">Projects</h1>
          <div className="flex items-center gap-2">
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
        ) : (
          <div className="grid gap-2">
            {groups.map((group) =>
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
        onCreated={(id) => onOpenProject(id)}
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
  const statusColors: Record<string, string> = {
    creating: 'text-yellow-400 bg-yellow-400/10',
    pulling_image: 'text-yellow-400 bg-yellow-400/10',
    starting: 'text-yellow-400 bg-yellow-400/10',
    stopping: 'text-yellow-400 bg-yellow-400/10',
    running: 'text-green-400 bg-green-400/10',
    stopped: 'text-gray-400 bg-gray-400/10',
    error: 'text-red-400 bg-red-400/10',
  };

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
            <span className="text-sm font-medium truncate">{name}</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                statusColors[project.status] || 'text-gray-400 bg-gray-400/10',
              )}
            >
              {STATUS_LABELS[project.status] || project.status}
            </span>
            {threads.length > 0 && (
              <span className="flex items-center gap-0.5">
                {threads.map((c) => (
                  <ThreadStatusIcon key={c.id} status={c.status} className="w-2.5 h-2.5" />
                ))}
              </span>
            )}
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
  const statusColors: Record<string, string> = {
    creating: 'text-yellow-400 bg-yellow-400/10',
    pulling_image: 'text-yellow-400 bg-yellow-400/10',
    starting: 'text-yellow-400 bg-yellow-400/10',
    stopping: 'text-yellow-400 bg-yellow-400/10',
    running: 'text-green-400 bg-green-400/10',
    stopped: 'text-gray-400 bg-gray-400/10',
    error: 'text-red-400 bg-red-400/10',
  };

  const threads = project.threads ?? [];

  return (
    <div className={cn(
      'px-3 py-2 transition-colors bg-surface',
      noBorder ? '' : 'border border-border rounded-xl hover:border-primary/30',
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{project.name}</h3>
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                statusColors[project.status] || 'text-gray-400 bg-gray-400/10',
              )}
            >
              {STATUS_LABELS[project.status] || project.status}
            </span>
          </div>
          {project.description && (
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              {project.description}
            </p>
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
          <SandboxControls project={project} className="w-4 h-4" />
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
              if (confirm('Delete this project and its sandbox?')) onDelete();
            }}
            className="p-1.5 rounded-lg hover:bg-red-400/10 text-text-secondary hover:text-danger transition-colors"
            title="Delete project"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
