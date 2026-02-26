import { Settings, Palette, Check } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type { ActivityCategory } from './activity-bar';
import { FileTree, type FileTreeActions } from '../explorer/file-tree';
import { SearchPanel } from '../search/search-panel';
import { SourceControlPanel } from '../source-control/source-control-panel';
import { ForksPanel } from '../forks/forks-panel';
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
  socket: { current: Socket | null };
  sendPrompt: (chatId: string, prompt: string, mode?: string, model?: string) => void;
}

export function SidePanel({ category, projectId, fileActions, gitActions, searchFiles, readFile, socket, sendPrompt }: SidePanelProps) {
  return (
    <div className="w-60 bg-sidebar text-panel-text flex flex-col shrink-0 h-full border-r border-panel-border">
      <PanelHeader category={category} />
      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        <PanelContent category={category} projectId={projectId} fileActions={fileActions} gitActions={gitActions} searchFiles={searchFiles} readFile={readFile} socket={socket} sendPrompt={sendPrompt} />
      </div>
    </div>
  );
}

function PanelHeader({ category }: { category: ActivityCategory }) {
  const titles: Record<ActivityCategory, string> = {
    explorer: 'Explorer',
    git: 'Source Control',
    search: 'Search',
    forks: 'Forks',
    settings: 'Settings',
  };

  return (
    <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-panel-text-muted select-none">
      {titles[category]}
    </div>
  );
}

function PanelContent({ category, projectId, fileActions, gitActions, searchFiles, readFile, socket, sendPrompt }: {
  category: ActivityCategory;
  projectId: string;
  fileActions: FileTreeActions;
  gitActions: GitActions;
  searchFiles: SidePanelProps['searchFiles'];
  readFile: (path: string) => void;
  socket: SidePanelProps['socket'];
  sendPrompt: SidePanelProps['sendPrompt'];
}) {
  switch (category) {
    case 'explorer':
      return <FileTree projectId={projectId} actions={fileActions} />;
    case 'git':
      return <SourceControlPanel gitActions={gitActions} projectId={projectId} socket={socket} sendPrompt={sendPrompt} />;
    case 'search':
      return <SearchPanel projectId={projectId} onSearch={searchFiles} readFile={readFile} />;
    case 'forks':
      return <ForksPanel projectId={projectId} />;
    case 'settings':
      return <SettingsPlaceholder projectId={projectId} />;
  }
}

const THEME_PREVIEWS: Record<ThemeId, { bg: string; sidebar: string; accent: string }> = {
  'midnight-blue': { bg: '#1e2132', sidebar: '#111827', accent: '#6366f1' },
  dark: { bg: '#1e1e1e', sidebar: '#252526', accent: '#6366f1' },
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
