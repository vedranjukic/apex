import { useCallback, useRef, useEffect } from 'react';
import { Loader2, X, GitCommitHorizontal } from 'lucide-react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type { Monaco } from 'monaco-editor';
import { useEditorStore, type DiffData } from '../../stores/editor-store';
import { useThemeStore } from '../../stores/theme-store';
import { getLanguageFromPath } from './lang-map';
import { getMonacoThemeName, getMonacoThemeData } from './apex-theme';
import { ensureMonacoTsDefaults } from './monaco-ts-defaults';
import { themeIds } from '../../lib/themes';
import { cn } from '../../lib/cn';

export function DiffViewer() {
  const diff = useEditorStore((s) => s.activeDiff);
  const closeDiff = useEditorStore((s) => s.closeDiff);
  const themeId = useThemeStore((s) => s.themeId);
  const monacoRef = useRef<Monaco | null>(null);

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(getMonacoThemeName(themeId));
    }
  }, [themeId]);

  const handleMount: DiffOnMount = useCallback(
    (editor, monaco) => {
      monacoRef.current = monaco;
      ensureMonacoTsDefaults(monaco);
      for (const id of themeIds) {
        monaco.editor.defineTheme(getMonacoThemeName(id), getMonacoThemeData(id));
      }
      monaco.editor.setTheme(getMonacoThemeName(useThemeStore.getState().themeId));
    },
    [],
  );

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

      {diff.loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <DiffEditor
            original={diff.original}
            modified={diff.modified}
            language={getLanguageFromPath(diff.filePath)}
            theme={getMonacoThemeName(themeId)}
            onMount={handleMount}
            loading={
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
              </div>
            }
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
              lineNumbers: 'on',
              renderSideBySide: true,
              contextmenu: false,
              automaticLayout: true,
              padding: { top: 8 },
              renderOverviewRuler: false,
            }}
          />
        </div>
      )}
    </div>
  );
}
