import { useRef, useCallback, useState, useMemo } from 'react';
import { Loader2, FileText, Zap } from 'lucide-react';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import type { LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { useEditorStore } from '../../stores/editor-store';
import { useThemeStore } from '../../stores/theme-store';
import { useLspStore, type LspServerStatus } from '../../stores/lsp-store';
import { getLanguageFromPath } from './lang-map';
import { useLspContext } from './lsp-context';
import { createSocketIoTransports, createStubWebSocket } from './lsp-transport';
import { cn } from '../../lib/cn';

import '@codingame/monaco-vscode-typescript-basics-default-extension';
import '@codingame/monaco-vscode-javascript-default-extension';
import '@codingame/monaco-vscode-python-default-extension';
import '@codingame/monaco-vscode-go-default-extension';
import '@codingame/monaco-vscode-rust-default-extension';
import '@codingame/monaco-vscode-java-default-extension';
import '@codingame/monaco-vscode-json-default-extension';
import '@codingame/monaco-vscode-css-default-extension';
import '@codingame/monaco-vscode-html-default-extension';
import '@codingame/monaco-vscode-markdown-basics-default-extension';
import '@codingame/monaco-vscode-yaml-default-extension';

const LSP_SUPPORTED_LANGUAGES = new Set([
  'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
  'python', 'go', 'rust', 'java',
]);

const vscodeApiConfig: MonacoVscodeApiConfig = {
  $type: 'extended',
  viewsConfig: {
    $type: 'EditorService',
  },
  userConfiguration: {
    json: JSON.stringify({
      'workbench.colorTheme': 'Default Dark Modern',
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
};

interface CodeViewerProps {
  filePath: string;
  content: string | undefined;
  onSave?: (path: string, content: string) => void;
}

export function CodeViewer({ filePath, content, onSave }: CodeViewerProps) {
  const fileName = filePath.split('/').pop() ?? filePath;
  const isLoading = content === undefined;
  const isDirty = useEditorStore((s) => s.dirtyFiles.has(filePath));
  const language = getLanguageFromPath(filePath);
  const lspStatus = useLspStore((s) => s.languages[language]);
  const { socketRef, projectId } = useLspContext();
  const [editorReady, setEditorReady] = useState(false);

  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        text: content ?? '',
        uri: `file://${filePath}`,
        enforceLanguageId: language,
      },
    },
  };

  const languageClientConfig = useMemo<LanguageClientConfig | undefined>(() => {
    if (!LSP_SUPPORTED_LANGUAGES.has(language)) return undefined;
    if (!socketRef.current || !projectId) return undefined;

    return {
      languageId: language,
      connection: {
        options: {
          $type: 'WebSocketDirect',
          webSocket: createStubWebSocket(),
        },
        messageTransports: createSocketIoTransports(socketRef.current, projectId, language),
      },
      clientOptions: {
        documentSelector: [language],
      },
    };
  }, [language, projectId, socketRef]);

  const handleEditorStartDone = useCallback(() => {
    setEditorReady(true);
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
            languageClientConfig={languageClientConfig}
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
