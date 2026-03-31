import { useState, useEffect, useCallback, useMemo } from 'react';
import { Settings, Palette, Check, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { ReconnectingWebSocket } from '../../lib/reconnecting-ws';
import type { ActivityCategory } from './activity-bar';
import { FileTree, type FileTreeActions } from '../explorer/file-tree';
import { SearchPanel } from '../search/search-panel';
import { SourceControlPanel } from '../source-control/source-control-panel';
import { ForksPanel } from '../forks/forks-panel';
import { ReferencesPanel } from '../editor/references-panel';
import type { GitActions } from '../../hooks/use-git-socket';
import { useThemeStore } from '../../stores/theme-store';
import { themes, themeIds, type ThemeId } from '../../lib/themes';
import {
  useProjectAgentSettingsStore,
  selectSettings,
  selectLoaded,
  loadAgentSettings,
  saveAgentSettings,
  AGENT_SETTINGS_PATH,
  type AgentSettings,
} from '../../stores/project-agent-settings-store';
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
    references: 'References',
    forks: 'Forks',
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
    case 'references':
      return <ReferencesPanel readFile={readFile} />;
    case 'forks':
      return <ForksPanel projectId={projectId} />;
    case 'settings':
      return <SettingsPlaceholder projectId={projectId} socket={socket} />;
  }
}

const THEME_PREVIEWS: Record<ThemeId, { bg: string; sidebar: string; accent: string }> = {
  'midnight-blue': { bg: '#1e2132', sidebar: '#111827', accent: '#6366f1' },
  dark: { bg: '#1e1e1e', sidebar: '#181818', accent: '#6366f1' },
  light: { bg: '#ffffff', sidebar: '#f3f3f3', accent: '#6366f1' },
};

function SettingsPlaceholder({ projectId, socket }: { projectId: string; socket: SidePanelProps['socket'] }) {
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

      <AgentLimitsSection projectId={projectId} socket={socket} />

      <div className="border-t border-panel-border pt-3 mt-1">
        <p className="text-[10px] text-text-muted font-mono truncate">{projectId}</p>
      </div>
    </div>
  );
}

const REASONING_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;

function AgentLimitsSection({ projectId, socket }: { projectId: string; socket: SidePanelProps['socket'] }) {
  const settingsSel = useMemo(() => selectSettings(projectId), [projectId]);
  const loadedSel = useMemo(() => selectLoaded(projectId), [projectId]);
  const settings = useProjectAgentSettingsStore(settingsSel);
  const loaded = useProjectAgentSettingsStore(loadedSel);
  const hydrateFromJson = useProjectAgentSettingsStore((s) => s.hydrateFromJson);
  const setSettings = useProjectAgentSettingsStore((s) => s.setSettings);

  useEffect(() => {
    if (loaded) return;
    const ws = socket.current;
    if (!ws?.connected) return;
    const handler = (data: any) => {
      const d = data.payload;
      if (d.path !== AGENT_SETTINGS_PATH) return;
      if (d.error) {
        hydrateFromJson(projectId, '{}');
      } else {
        hydrateFromJson(projectId, d.content || '{}');
      }
    };
    ws.on('file_read_result', handler);
    loadAgentSettings(projectId, socket);
    return () => { ws.off('file_read_result', handler); };
  }, [projectId, loaded, socket, hydrateFromJson]);

  const update = useCallback((patch: Partial<AgentSettings>) => {
    const next = { ...settings, ...patch };
    if (patch.maxTokens === 0 || patch.maxTokens === undefined) delete next.maxTokens;
    if (!patch.reasoningEffort || patch.reasoningEffort === ('auto' as any)) delete next.reasoningEffort;
    if (patch.maxSteps === 0 || patch.maxSteps === undefined) delete next.maxSteps;
    setSettings(projectId, next);
    saveAgentSettings(projectId, next, socket);
  }, [projectId, settings, setSettings, socket]);

  const [tokensInput, setTokensInput] = useState('');
  const [stepsInput, setStepsInput] = useState('');

  useEffect(() => {
    setTokensInput(settings.maxTokens ? String(settings.maxTokens) : '');
    setStepsInput(settings.maxSteps ? String(settings.maxSteps) : '');
  }, [settings.maxTokens, settings.maxSteps]);

  return (
    <div className="border-t border-panel-border pt-4 mt-1">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="w-4 h-4 text-panel-icon" />
        <span className="text-xs font-medium text-panel-text">Agent Limits</span>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-[10px] text-panel-text-muted mb-1 block">Max Output Tokens</label>
          <input
            type="number"
            min={0}
            value={tokensInput}
            onChange={(e) => setTokensInput(e.target.value)}
            onBlur={() => update({ maxTokens: parseInt(tokensInput, 10) || 0 })}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Auto (provider default)"
            className="w-full px-2 py-1.5 rounded-md bg-surface-secondary border border-border text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="text-[10px] text-panel-text-muted mb-1 block">Reasoning Effort</label>
          <div className="flex gap-1">
            {REASONING_OPTIONS.map((opt) => {
              const active = opt === 'auto'
                ? !settings.reasoningEffort
                : settings.reasoningEffort === opt;
              return (
                <button
                  key={opt}
                  onClick={() => update({ reasoningEffort: opt === 'auto' ? undefined : opt as AgentSettings['reasoningEffort'] })}
                  className={cn(
                    'flex-1 px-1.5 py-1 rounded-md text-[10px] font-medium capitalize transition-colors',
                    active
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'bg-surface-secondary text-panel-text-muted border border-border hover:bg-sidebar-hover',
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-panel-text-muted mb-1 block">Max Steps (Sisyphus)</label>
          <input
            type="number"
            min={0}
            value={stepsInput}
            onChange={(e) => setStepsInput(e.target.value)}
            onBlur={() => update({ maxSteps: parseInt(stepsInput, 10) || 0 })}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="50"
            className="w-full px-2 py-1.5 rounded-md bg-surface-secondary border border-border text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <p className="text-[10px] text-text-muted leading-tight">
          Override global agent limits for this project. Empty = use global default.
        </p>
      </div>
    </div>
  );
}
