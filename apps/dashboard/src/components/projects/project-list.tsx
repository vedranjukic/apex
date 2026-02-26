import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderOpen, Trash2, ExternalLink, Loader2, CheckCircle2, GitBranch, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useProjectsStore } from '../../stores/projects-store';
import { useProjectsSocket } from '../../hooks/use-projects-socket';
import { CreateProjectDialog } from './create-project-dialog';
import { settingsApi } from '../../api/client';
import type { Project } from '../../api/client';

function chatActivity(project: Project): 'working' | 'completed' | null {
  const chats = project.chats;
  if (!chats || chats.length === 0) return null;
  if (chats.some((c) => c.status === 'running')) return 'working';
  if (chats.some((c) => c.status === 'completed')) return 'completed';
  return null;
}

interface ForkGroup {
  root: Project;
  forks: Project[];
}

function groupByForkFamily(projects: Project[]): ForkGroup[] {
  const rootMap = new Map<string, ForkGroup>();
  const standalone: ForkGroup[] = [];

  // First pass: find all roots
  for (const p of projects) {
    if (!p.forkedFromId) {
      rootMap.set(p.id, { root: p, forks: [] });
    }
  }

  // Second pass: attach forks to their root
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

  // Return roots (in original order) then any orphan forks
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
}

export function ProjectList({ onOpenProject }: Props) {
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
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Projects</h1>
          <div className="flex items-center gap-2">
            {settingsVisible && (
              <button
                onClick={() => navigate('/settings')}
                className="p-2 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
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
          <div className="grid gap-3">
            {groups.map((group) =>
              group.forks.length === 0 ? (
                <ProjectCard
                  key={group.root.id}
                  project={group.root}
                  onOpen={() => onOpenProject(group.root.id)}
                  onDelete={() => deleteProject(group.root.id)}
                />
              ) : (
                <ForkGroupCard
                  key={group.root.id}
                  group={group}
                  onOpenProject={onOpenProject}
                  onDeleteProject={deleteProject}
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

function ForkGroupCard({
  group,
  onOpenProject,
  onDeleteProject,
}: {
  group: ForkGroup;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-border rounded-xl bg-surface overflow-hidden">
      {/* Root project header */}
      <ProjectCard
        project={group.root}
        onOpen={() => onOpenProject(group.root.id)}
        onDelete={() => onDeleteProject(group.root.id)}
        noBorder
      />

      {/* Fork toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-1.5 text-xs text-text-muted hover:text-text-secondary hover:bg-surface-secondary/50 transition-colors border-t border-border"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <GitBranch className="w-3 h-3" />
        {group.forks.length} fork{group.forks.length !== 1 ? 's' : ''}
      </button>

      {/* Forked projects */}
      {expanded && (
        <div className="border-t border-border">
          {group.forks.map((fork) => (
            <ForkRow
              key={fork.id}
              project={fork}
              onOpen={() => onOpenProject(fork.id)}
              onDelete={() => onDeleteProject(fork.id)}
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
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const statusColors: Record<string, string> = {
    creating: 'text-yellow-400 bg-yellow-400/10',
    starting: 'text-yellow-400 bg-yellow-400/10',
    running: 'text-green-400 bg-green-400/10',
    stopped: 'text-gray-400 bg-gray-400/10',
    error: 'text-red-400 bg-red-400/10',
  };

  const activity = project.status === 'running' ? chatActivity(project) : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary/50 transition-colors border-b last:border-b-0 border-border/50">
      <div className="flex items-center gap-1.5 text-text-muted pl-2">
        <GitBranch className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {project.branchName || project.name}
          </span>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
              statusColors[project.status] || 'text-gray-400 bg-gray-400/10',
            )}
          >
            {project.status}
          </span>
          {activity === 'working' && (
            <Loader2 className="w-3 h-3 animate-spin text-yellow-600" />
          )}
          {activity === 'completed' && (
            <CheckCircle2 className="w-3 h-3 text-accent" />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
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
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
  noBorder,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
  noBorder?: boolean;
}) {
  const statusColors: Record<string, string> = {
    creating: 'text-yellow-400 bg-yellow-400/10',
    starting: 'text-yellow-400 bg-yellow-400/10',
    running: 'text-green-400 bg-green-400/10',
    stopped: 'text-gray-400 bg-gray-400/10',
    error: 'text-red-400 bg-red-400/10',
  };

  const activity = project.status === 'running' ? chatActivity(project) : null;

  return (
    <div className={cn(
      'p-4 transition-colors bg-surface',
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
              {project.status}
            </span>
            {activity === 'working' && (
              <span className="flex items-center gap-1 text-xs text-yellow-600">
                <Loader2 className="w-3 h-3 animate-spin" />
                Agent working
              </span>
            )}
            {activity === 'completed' && (
              <span className="flex items-center gap-1 text-xs text-accent">
                <CheckCircle2 className="w-3 h-3" />
                Task completed
              </span>
            )}
          </div>
          {project.description && (
            <p className="text-sm text-text-secondary mt-1 truncate">
              {project.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
            <span>{project.agentType === 'claude_code' ? 'Claude Code' : 'OpenCode'}</span>
            <span>·</span>
            <span>{new Date(project.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={onOpen}
            className="p-2 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-primary transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Delete this project and its sandbox?')) onDelete();
            }}
            className="p-2 rounded-lg hover:bg-red-400/10 text-text-secondary hover:text-danger transition-colors"
            title="Delete project"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
