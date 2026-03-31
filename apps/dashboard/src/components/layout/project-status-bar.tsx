import { useState, useCallback } from 'react';
import { GitBranch, RefreshCw, ArrowUp, ArrowDown, Radio } from 'lucide-react';
import { type Project } from '../../api/client';
import { SandboxStatus } from './sandbox-status';
import { BranchPicker } from './branch-picker';
import { cn } from '../../lib/cn';
import { useGitStore } from '../../stores/git-store';
import { usePortsStore } from '../../stores/ports-store';
import { useTerminalStore } from '../../stores/terminal-store';
import type { ProjectInfo } from '../../hooks/use-project-info-socket';
import type { GitActions } from '../../hooks/use-git-socket';

interface Props {
  project: Project;
  info: ProjectInfo;
  gitActions: GitActions;
  onStop?: () => void;
  onStart?: () => void;
  onRestart?: () => void;
}

export function ProjectStatusBar({ project, info, gitActions, onStop, onStart, onRestart }: Props) {
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const storeBranch = useGitStore((s) => s.branch);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const gitLoading = useGitStore((s) => s.loading);
  const portCount = usePortsStore((s) => s.ports.length);
  const openPanel = useTerminalStore((s) => s.openPanel);
  const setActiveBottomTab = useTerminalStore((s) => s.setActiveBottomTab);
  const showPortsTab = useTerminalStore((s) => s.showPortsTab);

  const branchLabel = storeBranch || info.gitBranch || project.gitRepo;

  const openPortsPanel = useCallback(() => {
    showPortsTab();
    openPanel();
    setActiveBottomTab('ports');
  }, [showPortsTab, openPanel, setActiveBottomTab]);

  return (
    <div className="h-7 border-t border-panel-border bg-activity-bar flex items-center px-3 shrink-0 text-xs text-panel-text-muted select-none gap-4">
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

        {/* Sandbox status (clickable — opens action menu) */}
        <SandboxStatus
          status={project.status}
          sandboxId={project.sandboxId}
          statusError={project.statusError}
          onStop={onStop}
          onStart={onStart}
          onRestart={onRestart}
        />

        <span className="text-[10px] text-panel-text-muted/50 select-none">
          v{__APP_VERSION__}
        </span>
      </div>
    </div>
  );
}