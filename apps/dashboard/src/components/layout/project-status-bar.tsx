import { useState, useCallback, useMemo } from 'react';
import { GitBranch, ExternalLink, Loader2, RefreshCw, ArrowUp, ArrowDown, Radio } from 'lucide-react';
import { type Project, projectsApi } from '../../api/client';
import { SandboxStatus } from './sandbox-status';
import { BranchPicker } from './branch-picker';
import { cn } from '../../lib/cn';
import { useGitStore } from '../../stores/git-store';
import { usePortsStore } from '../../stores/ports-store';
import { useTerminalStore } from '../../stores/terminal-store';
import type { ProjectInfo } from '../../hooks/use-project-info-socket';
import type { GitActions } from '../../hooks/use-git-socket';

interface ApexBridge {
  isElectron: boolean;
  platform: string;
  openWindow: (urlPath: string) => void;
  detectedIDEs?: { cursor: boolean; vscode: boolean };
  openInIDE?: (params: {
    ide: 'cursor' | 'vscode';
    sshUser: string;
    sshHost: string;
    sshPort: number;
    sandboxId: string;
    remotePath: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

function getApexBridge(): ApexBridge | null {
  return (window as any).apex ?? null;
}

interface Props {
  project: Project;
  info: ProjectInfo;
  gitActions: GitActions;
}

export function ProjectStatusBar({ project, info, gitActions }: Props) {
  const [vscLoading, setVscLoading] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const storeBranch = useGitStore((s) => s.branch);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const gitLoading = useGitStore((s) => s.loading);
  const portCount = usePortsStore((s) => s.ports.length);
  const openPanel = useTerminalStore((s) => s.openPanel);
  const setActiveBottomTab = useTerminalStore((s) => s.setActiveBottomTab);

  const branchLabel = storeBranch || info.gitBranch || project.gitRepo;
  const sandboxReady = project.status === 'running' && !!project.sandboxId;

  const apexBridge = useMemo(() => getApexBridge(), []);
  const ides = apexBridge?.detectedIDEs;
  const preferredIDE: 'cursor' | 'vscode' | null = ides?.cursor
    ? 'cursor'
    : ides?.vscode
      ? 'vscode'
      : null;
  const nativeIDEAvailable = !!apexBridge?.isElectron && !!preferredIDE;

  const ideLabel = preferredIDE === 'cursor' ? 'Cursor' : 'VS Code';

  const openPortsPanel = useCallback(() => {
    openPanel();
    setActiveBottomTab('ports');
  }, [openPanel, setActiveBottomTab]);

  const openIDE = useCallback(async () => {
    if (!sandboxReady) return;
    setVscLoading(true);
    try {
      if (nativeIDEAvailable && apexBridge?.openInIDE) {
        const sshAccess = await projectsApi.createSshAccess(project.id);
        const result = await apexBridge.openInIDE({
          ide: preferredIDE!,
          ...sshAccess,
        });
        if (!result.ok) {
          console.error('Failed to open IDE:', result.error);
        }
      } else {
        const { url } = await projectsApi.getVscodeUrl(project.id);
        window.open(url, '_blank', 'noopener');
      }
    } catch (err) {
      console.error('Failed to open IDE:', err);
    } finally {
      setVscLoading(false);
    }
  }, [project.id, sandboxReady, nativeIDEAvailable, apexBridge, preferredIDE]);

  return (
    <div className="h-7 border-t border-panel-border bg-sidebar flex items-center px-3 shrink-0 text-xs text-panel-text-muted select-none gap-4">
      {/* Git branch / repo */}
      {branchLabel && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setBranchPickerOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1 hover:text-text-primary transition-colors',
              branchPickerOpen && 'text-text-primary',
            )}
            title={`Branch: ${branchLabel}`}
          >
            <GitBranch className="w-3 h-3" />
            <span className="truncate max-w-[180px]">
              {branchLabel}
            </span>
          </button>
          {branchPickerOpen && (
            <BranchPicker
              gitActions={gitActions}
              onClose={() => setBranchPickerOpen(false)}
            />
          )}
        </div>
      )}

      {/* Source control sync */}
      {branchLabel && (
        <button
          type="button"
          onClick={() => {
            if (behind > 0) gitActions.pull();
            if (ahead > 0) gitActions.push();
            if (ahead === 0 && behind === 0) gitActions.pull();
          }}
          disabled={gitLoading}
          className="flex items-center gap-1 hover:text-text-primary transition-colors"
          title={`${behind} to pull, ${ahead} to push`}
        >
          <RefreshCw className={cn('w-3 h-3', gitLoading && 'animate-spin')} />
          <ArrowDown className="w-2.5 h-2.5" />
          <span>{behind}</span>
          <ArrowUp className="w-2.5 h-2.5" />
          <span>{ahead}</span>
        </button>
      )}

      {/* ── Right-aligned items ── */}
      <div className="ml-auto flex items-center gap-3">
        {/* Ports indicator */}
        <button
          type="button"
          onClick={openPortsPanel}
          className="flex items-center gap-1 hover:text-text-primary transition-colors"
          title={`${portCount} forwarded port${portCount !== 1 ? 's' : ''}`}
        >
          <Radio className="w-3 h-3" />
          <span>{portCount}</span>
        </button>

        {/* Sandbox status */}
        <SandboxStatus status={project.status} sandboxId={project.sandboxId} statusError={project.statusError} />

        {/* IDE button (Cursor / VS Code native or code-server fallback) */}
        <button
          onClick={openIDE}
          disabled={!sandboxReady || vscLoading}
          title={
            !sandboxReady
              ? 'Sandbox not ready'
              : nativeIDEAvailable
                ? `Open in ${ideLabel} (SSH)`
                : 'Open VS Code in browser'
          }
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
            'border transition-colors',
            sandboxReady
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/50 cursor-pointer'
              : 'border-transparent text-text-muted cursor-not-allowed opacity-50',
          )}
        >
          {vscLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <VscodeIcon className="w-3 h-3" />
          )}
          <span>{nativeIDEAvailable ? ideLabel : 'VS Code'}</span>
          {sandboxReady && !vscLoading && !nativeIDEAvailable && (
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          )}
        </button>
      </div>
    </div>
  );
}

/** Inline VS Code icon (simplified logo) */
function VscodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.583 2.213a1.125 1.125 0 0 1 1.23.038l3.937 2.55A1.125 1.125 0 0 1 23.25 5.8v12.4a1.125 1.125 0 0 1-.5 1l-3.937 2.55a1.125 1.125 0 0 1-1.313-.075L7.125 12.75.963 17.85a.75.75 0 0 1-.963-.075l-.75-.75a.75.75 0 0 1 0-1.05L5.625 12 .25 8.025a.75.75 0 0 1 0-1.05l.75-.75a.75.75 0 0 1 .963-.075l6.162 5.1L17.583 2.213ZM18 7.65 12.375 12 18 16.35V7.65Z" />
    </svg>
  );
}
