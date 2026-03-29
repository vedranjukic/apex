import { useCallback, useEffect, useState } from 'react';
import { Loader2, X, GitCommitHorizontal } from 'lucide-react';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import { useEditorStore } from '../../stores/editor-store';
import { getLanguageFromPath } from './lang-map';
import { setSyntheticFile, clearSyntheticFile } from './sandbox-fs-provider';
import { cn } from '../../lib/cn';

const vscodeApiConfig: MonacoVscodeApiConfig = {
  $type: 'extended',
  viewsConfig: {
    $type: 'EditorService',
  },
  userConfiguration: {
    json: JSON.stringify({
      'workbench.colorTheme': 'Default Dark Modern',
      'editor.minimap.enabled': false,
      'editor.fontSize': 13,
      'editor.fontFamily': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      'editor.lineNumbers': 'on',
      'editor.scrollBeyondLastLine': false,
      'editor.padding.top': 8,
      'editor.contextmenu': false,
      'editor.readOnly': true,
      'diffEditor.renderSideBySide': true,
      'diffEditor.renderOverviewRuler': true,
    }),
  },
  monacoWorkerFactory: configureDefaultWorkerFactory,
};

export function DiffViewer() {
  const diff = useEditorStore((s) => s.activeDiff);
  const closeDiff = useEditorStore((s) => s.closeDiff);
  const [ready, setReady] = useState(false);

  const handleEditorStartDone = useCallback(() => {
    setReady(true);
  }, []);

  if (!diff) return null;

  const fileName = diff.filePath.split('/').pop() ?? diff.filePath;
  const language = getLanguageFromPath(diff.filePath);

  const normalizedPath = diff.filePath.startsWith('/') ? diff.filePath : `/${diff.filePath}`;
  const originalUri = `${normalizedPath}.diff-original`;
  const modifiedUri = `${normalizedPath}.diff-modified`;

  if (!diff.loading) {
    setSyntheticFile(originalUri, diff.original ?? '');
    setSyntheticFile(modifiedUri, diff.modified ?? '');
  }

  useEffect(() => {
    return () => {
      clearSyntheticFile(originalUri);
      clearSyntheticFile(modifiedUri);
    };
  }, [originalUri, modifiedUri]);

  const editorAppConfig: EditorAppConfig | null =
    diff.loading
      ? null
      : {
          codeResources: {
            original: {
              text: diff.original ?? '',
              uri: `file://${originalUri}`,
              enforceLanguageId: language,
            },
            modified: {
              text: diff.modified ?? '',
              uri: `file://${modifiedUri}`,
              enforceLanguageId: language,
            },
          },
          useDiffEditor: true,
        };

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
            onEditorStartDone={handleEditorStartDone}
            onError={(e) => console.error('[DiffViewer] Monaco error:', e)}
          />
        </div>
      )}
    </div>
  );
}
