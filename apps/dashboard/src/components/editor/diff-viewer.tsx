import { useMemo } from 'react';
import { Loader2, X, GitCommitHorizontal } from 'lucide-react';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import { useEditorStore } from '../../stores/editor-store';
import { useThemeStore } from '../../stores/theme-store';
import { getLanguageFromPath } from './lang-map';
import { cn } from '../../lib/cn';

function getVscodeThemeName(themeId: string): string {
  switch (themeId) {
    case 'light': return 'Default Light Modern';
    case 'dark': return 'Default Dark Modern';
    case 'midnight-blue':
    default:
      return 'Default Dark Modern';
  }
}

export function DiffViewer() {
  const diff = useEditorStore((s) => s.activeDiff);
  const closeDiff = useEditorStore((s) => s.closeDiff);
  const themeId = useThemeStore((s) => s.themeId);

  const vscodeApiConfig = useMemo<MonacoVscodeApiConfig>(() => ({
    $type: 'extended',
    viewsConfig: {
      $type: 'EditorService',
    },
    userConfiguration: {
      json: JSON.stringify({
        'workbench.colorTheme': getVscodeThemeName(themeId),
        'editor.minimap.enabled': false,
        'editor.fontSize': 13,
        'editor.fontFamily': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        'editor.lineNumbers': 'on',
        'editor.scrollBeyondLastLine': false,
        'editor.padding.top': 8,
        'editor.contextmenu': false,
        'editor.readOnly': true,
        'diffEditor.renderSideBySide': true,
        'diffEditor.renderOverviewRuler': false,
      }),
    },
    monacoWorkerFactory: configureDefaultWorkerFactory,
  }), [themeId]);

  const language = diff ? getLanguageFromPath(diff.filePath) : 'plaintext';

  const editorAppConfig = useMemo<EditorAppConfig | null>(() => {
    if (!diff || diff.loading) return null;
    return {
      codeResources: {
        original: {
          text: diff.original ?? '',
          uri: `/workspace${diff.filePath}.original`,
          enforceLanguageId: language,
        },
        modified: {
          text: diff.modified ?? '',
          uri: `/workspace${diff.filePath}.modified`,
          enforceLanguageId: language,
        },
      },
    };
  }, [diff, language]);

  if (!diff) return null;

  const fileName = diff.filePath.split('/').pop() ?? diff.filePath;

  return (
    <div className="flex flex-col h-full bg-surface text-text-primary">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary border-b border-border shrink-0">
        <GitCommitHorizontal className="w-4 h-4 text-text-muted" />
        <span className="text-sm text-text-primary truncate">{fileName}</span>
        <span
          className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded',
            diff.staged
              ? 'bg-green-500/15 text-green-400'
              : 'bg-yellow-500/15 text-yellow-400',
          )}
        >
          {diff.staged ? 'Staged' : 'Changes'}
        </span>
        <span className="text-xs text-text-secondary truncate ml-1 hidden sm:inline">
          {diff.filePath}
        </span>
        <span className="flex-1" />
        <button
          onClick={closeDiff}
          className="p-1 rounded hover:bg-sidebar-hover text-text-muted hover:text-text-primary transition-colors"
          title="Close diff"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {diff.loading || !editorAppConfig ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <MonacoEditorReactComp
            vscodeApiConfig={vscodeApiConfig}
            editorAppConfig={editorAppConfig}
            style={{ height: '100%' }}
            onError={(e) => console.error('[DiffViewer] Monaco error:', e)}
          />
        </div>
      )}
    </div>
  );
}
