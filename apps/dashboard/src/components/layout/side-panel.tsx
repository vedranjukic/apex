import { Settings, Palette, Check, RefreshCw } from 'lucide-react';
import type { ReconnectingWebSocket } from '../../lib/reconnecting-ws';
import type { ActivityCategory } from './activity-bar';
import { FileTree, type FileTreeActions } from '../explorer/file-tree';
import { SearchPanel } from '../search/search-panel';
import { SourceControlPanel } from '../source-control/source-control-panel';
import type { GitActions } from '../../hooks/use-git-socket';
import { useThemeStore } from '../../stores/theme-store';
import { themes, themeIds, type ThemeId } from '../../lib/themes';
import { cn } from '../../lib/cn';

interface SidePanelProps {
  category: ActivityCategory;
  projectId: string;
  fileActions: FileTreeActions;
  gitActions: GitActions;
  searchFiles: (query: string, options: {
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    includePattern?: string;
    excludePattern?: string;
  }) => void;
  readFile: (path: string) => void;
  socket: { current: ReconnectingWebSocket | null };
  sendPrompt: (threadId: string, prompt: string, mode?: string, model?: string) => void;
  onAnalyzeGitignore?: (prompt: string) => Promise<void>;
}

export function SidePanel({ category, projectId, fileActions, gitActions, searchFiles, readFile, socket, sendPrompt, onAnalyzeGitignore }: SidePanelProps) {
  return (
    <div className="w-60 bg-sidebar text-panel-text flex flex-col shrink-0 h-full border-r border-panel-border">
      <PanelHeader category={category} fileActions={fileActions} />
      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        <PanelContent category={category} projectId={projectId} fileActions={fileActions} gitActions={gitActions} searchFiles={searchFiles} readFile={readFile} socket={socket} sendPrompt={sendPrompt} onAnalyzeGitignore={onAnalyzeGitignore} />
      </div>
    </div>
  );
}

function PanelHeader({ category, fileActions }: { category: ActivityCategory; fileActions: FileTreeActions }) {
  const titles: Record<ActivityCategory, string> = {
    explorer: 'Explorer',
    git: 'Source Control',
    search: 'Search',
    settings: 'Settings',
  };

  return (
    <div className="flex items-center px-4 py-3 select-none">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-text-muted flex-1">
        {titles[category]}
      </span>
      {category === 'explorer' && (
        <button
          onClick={() => fileActions.refreshAll()}
          className="w-5 h-5 flex items-center justify-center rounded text-panel-text-muted hover:text-panel-text hover:bg-sidebar-hover transition-colors"
          title="Refresh Explorer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function PanelContent({ category, projectId, fileActions, gitActions, searchFiles, readFile, socket, sendPrompt, onAnalyzeGitignore }: {
  category: ActivityCategory;
  projectId: string;
  fileActions: FileTreeActions;
  gitActions: GitActions;
  searchFiles: SidePanelProps['searchFiles'];
  readFile: (path: string) => void;
  socket: SidePanelProps['socket'];
  sendPrompt: SidePanelProps['sendPrompt'];
  onAnalyzeGitignore?: SidePanelProps['onAnalyzeGitignore'];
}) {
  switch (category) {
    case 'explorer':
      return <FileTree projectId={projectId} actions={fileActions} />;
    case 'git':
      return <SourceControlPanel gitActions={gitActions} projectId={projectId} socket={socket} sendPrompt={sendPrompt} onAnalyzeGitignore={onAnalyzeGitignore} />;
    case 'search':
      return <SearchPanel projectId={projectId} onSearch={searchFiles} readFile={readFile} />;
    case 'settings':
      return <SettingsPlaceholder projectId={projectId} />;
  }
}

const THEME_PREVIEWS: Record<ThemeId, { bg: string; sidebar: string; accent: string }> = {
  'midnight-blue': { bg: '#1e2132', sidebar: '#111827', accent: '#6366f1' },
  dark: { bg: '#1e1e1e', sidebar: '#181818', accent: '#6366f1' },
  light: { bg: '#ffffff', sidebar: '#f3f3f3', accent: '#6366f1' },
};

function SettingsPlaceholder({ projectId }: { projectId: string }) {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Palette className="w-4 h-4 text-panel-icon" />
          <span className="text-xs font-medium text-panel-text">Color Theme</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {themeIds.map((id) => {
            const t = themes[id];
            const preview = THEME_PREVIEWS[id];
            const isActive = themeId === id;
            return (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-colors text-left',
                  isActive
                    ? 'bg-sidebar-active text-panel-text'
                    : 'text-panel-text-muted hover:bg-sidebar-hover hover:text-panel-text',
                )}
              >
                <div
                  className="w-5 h-5 rounded border border-panel-border flex-shrink-0 overflow-hidden"
                  style={{ background: preview.bg }}
                >
                  <div
                    className="w-1.5 h-full"
                    style={{ background: preview.sidebar }}
                  />
                </div>
                <span className="flex-1">{t.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-panel-border pt-3 mt-1">
        <p className="text-[10px] text-text-muted font-mono truncate">{projectId}</p>
      </div>
    </div>
  );
}
