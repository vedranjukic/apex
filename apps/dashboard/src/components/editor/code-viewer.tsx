import { useRef, useCallback, useMemo } from 'react';
import { Loader2, FileText, Zap } from 'lucide-react';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import { useEditorStore, type CodeSelection } from '../../stores/editor-store';
import { useThemeStore } from '../../stores/theme-store';
import { useLspStore, type LspServerStatus } from '../../stores/lsp-store';
import { getLanguageFromPath } from './lang-map';
import { cn } from '../../lib/cn';

const SNIPPET_MIME = 'application/x-codeany-snippet';

const LSP_SUPPORTED_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java',
]);

interface CodeViewerProps {
  filePath: string;
  content: string | undefined;
  onSave?: (path: string, content: string) => void;
}

function getVscodeThemeName(themeId: string): string {
  switch (themeId) {
    case 'light': return 'Default Light Modern';
    case 'dark': return 'Default Dark Modern';
    case 'midnight-blue':
    default:
      return 'Default Dark Modern';
  }
}

export function CodeViewer({ filePath, content, onSave }: CodeViewerProps) {
  const fileName = filePath.split('/').pop() ?? filePath;
  const isLoading = content === undefined;
  const isDirty = useEditorStore((s) => s.dirtyFiles.has(filePath));
  const themeId = useThemeStore((s) => s.themeId);
  const language = getLanguageFromPath(filePath);
  const lspStatus = useLspStore((s) => s.languages[language]);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  const vscodeApiConfig = useMemo<MonacoVscodeApiConfig>(() => ({
    $type: 'extended',
    viewsConfig: {
      $type: 'EditorService',
    },
    userConfiguration: {
      json: JSON.stringify({
        'workbench.colorTheme': getVscodeThemeName(themeId),
        'editor.wordBasedSuggestions': 'off',
        'editor.minimap.enabled': false,
        'editor.fontSize': 13,
        'editor.fontFamily': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        'editor.lineNumbers': 'on',
        'editor.renderLineHighlight': 'line',
        'editor.folding': true,
        'editor.wordWrap': 'off',
        'editor.scrollBeyondLastLine': false,
        'editor.padding.top': 8,
        'editor.contextmenu': false,
      }),
    },
    monacoWorkerFactory: configureDefaultWorkerFactory,
  }), [themeId]);

  const editorAppConfig = useMemo<EditorAppConfig>(() => ({
    codeResources: {
      modified: {
        text: content ?? '',
        uri: `/workspace${filePath}`,
        enforceLanguageId: language,
      },
    },
  }), [content, filePath, language]);

  const handleEditorStartDone = useCallback(() => {
    const reveal = useEditorStore.getState().revealLineAt;
    if (reveal && reveal.filePath === filePathRef.current) {
      useEditorStore.getState().clearRevealLineAt();
    }
  }, []);

  const showLspStatus = lspStatus && LSP_SUPPORTED_LANGUAGES.has(language);

  return (
    <div className="flex flex-col h-full bg-surface text-text-primary">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary border-b border-border shrink-0">
        <FileText className="w-4 h-4 text-text-muted" />
        <span className="text-sm text-text-primary truncate" title={filePath}>
          {fileName}
        </span>
        {isDirty && (
          <span className="w-2 h-2 rounded-full bg-text-secondary shrink-0" title="Unsaved changes" />
        )}
        <span className="text-xs text-text-secondary truncate ml-1 hidden sm:inline">
          {filePath}
        </span>
        <span className="flex-1" />
        {showLspStatus && <LspStatusIndicator status={lspStatus.status} error={lspStatus.error} />}
      </div>

      {isLoading ? (
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
            onError={(e) => console.error('[CodeViewer] Monaco error:', e)}
          />
        </div>
      )}
    </div>
  );
}

function LspStatusIndicator({ status, error }: { status: LspServerStatus; error?: string }) {
  if (status === 'ready') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-green-400" title="LSP connected">
        <Zap className="w-3 h-3" />
      </span>
    );
  }
  if (status === 'starting') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-text-muted animate-pulse" title="LSP initializing...">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="hidden sm:inline">LSP</span>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className={cn('flex items-center gap-1 text-[10px] text-yellow-500')}
        title={error ?? 'LSP error'}
      >
        <Zap className="w-3 h-3" />
        <span className="hidden sm:inline">LSP err</span>
      </span>
    );
  }
  return null;
}
