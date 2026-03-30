import { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { Loader2, FileText, Zap } from 'lucide-react';
import { MonacoEditorReactComp } from '@typefox/monaco-editor-react';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import type { EditorApp } from 'monaco-languageclient/editorApp';
import type { LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { useEditorStore } from '../../stores/editor-store';
import { useThemeStore } from '../../stores/theme-store';
import { useLspStore, type LspServerStatus } from '../../stores/lsp-store';
import { useReferencesStore } from '../../stores/references-store';
import { usePanelsStore } from '../../stores/panels-store';
import { getLanguageFromPath } from './lang-map';
import { useLspContext } from './lsp-context';
import { createSocketIoTransports, createStubWebSocket } from './lsp-transport';
import { sendLspRequest } from './lsp-request';
import { EditorContextMenu, type EditorMenuItem } from './editor-context-menu';
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

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
const cmdKey = isMac ? '⌘' : 'Ctrl+';

function normalizeLspLang(lang: string): string {
  if (lang === 'typescriptreact') return 'typescript';
  if (lang === 'javascriptreact') return 'javascript';
  return lang;
}

function buildContextMenuItems(lspReady: boolean): EditorMenuItem[] {
  return [
    { type: 'action', id: 'goto-definition', label: 'Go to Definition', shortcut: 'F12', disabled: !lspReady },
    { type: 'action', id: 'goto-type-definition', label: 'Go to Type Definition', disabled: !lspReady },
    { type: 'action', id: 'goto-implementations', label: 'Go to Implementations', shortcut: isMac ? '⌘F12' : 'Ctrl+F12', disabled: !lspReady },
    { type: 'action', id: 'goto-references', label: 'Go to References', shortcut: '⇧F12', disabled: !lspReady },
    { type: 'separator' },
    { type: 'action', id: 'find-all-references', label: 'Find All References', shortcut: isMac ? '⌥⇧F12' : 'Alt+Shift+F12', disabled: !lspReady },
    { type: 'action', id: 'find-all-implementations', label: 'Find All Implementations', disabled: !lspReady },
    { type: 'separator' },
    { type: 'action', id: 'rename-symbol', label: 'Rename Symbol', shortcut: 'F2', disabled: !lspReady },
    { type: 'separator' },
    { type: 'action', id: 'cut', label: 'Cut', shortcut: `${cmdKey}X` },
    { type: 'action', id: 'copy', label: 'Copy', shortcut: `${cmdKey}C` },
    { type: 'action', id: 'paste', label: 'Paste', shortcut: `${cmdKey}V` },
  ];
}

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
  const normalizedLang = normalizeLspLang(language);
  const lspStatus = useLspStore((s) => s.languages[normalizedLang]);
  const { socketRef, projectId } = useLspContext();
  const [editorReady, setEditorReady] = useState(false);
  const editorAppRef = useRef<EditorApp>(undefined);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

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
        messageTransports: createSocketIoTransports(socketRef.current!, projectId!, language),
      },
      clientOptions: {
        documentSelector: [language],
      },
    };
  }, [language, projectId, socketRef]);

  const handleEditorStartDone = useCallback((app?: EditorApp) => {
    editorAppRef.current = app;
    setEditorReady(true);
  }, []);

  const revealLineAt = useEditorStore((s) => s.revealLineAt);
  const clearRevealLineAt = useEditorStore((s) => s.clearRevealLineAt);

  useEffect(() => {
    if (!revealLineAt || revealLineAt.filePath !== filePath || !editorReady) return;
    const editor = editorAppRef.current?.getEditor();
    if (!editor) return;

    const line = revealLineAt.line;
    clearRevealLineAt();

    requestAnimationFrame(() => {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    });
  }, [revealLineAt, filePath, editorReady, clearRevealLineAt]);

  const lspReady = lspStatus?.status === 'ready' && LSP_SUPPORTED_LANGUAGES.has(language);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const triggerEditorCommand = useCallback((editor: any, commandId: string) => {
    editor.focus();
    try {
      const result = editor.trigger('ctxMenu', commandId, null);
      if (result && typeof result.then === 'function') {
        result.catch((err: unknown) => {
          console.warn(`[CodeViewer] ${commandId} failed:`, err);
        });
      }
    } catch (err) {
      console.warn(`[CodeViewer] ${commandId} failed:`, err);
    }
  }, []);

  const executeEditorAction = useCallback((actionId: string) => {
    const editor = editorAppRef.current?.getEditor();
    if (!editor) return;

    switch (actionId) {
      case 'goto-definition':
        triggerEditorCommand(editor, 'editor.action.revealDefinition');
        break;
      case 'goto-type-definition':
        triggerEditorCommand(editor, 'editor.action.goToTypeDefinition');
        break;
      case 'goto-implementations':
        triggerEditorCommand(editor, 'editor.action.goToImplementation');
        break;
      case 'goto-references':
        triggerEditorCommand(editor, 'editor.action.goToReferences');
        break;
      case 'find-all-references':
        findAllLocations('textDocument/references', 'References');
        break;
      case 'find-all-implementations':
        findAllLocations('textDocument/implementation', 'Implementations');
        break;
      case 'rename-symbol':
        triggerEditorCommand(editor, 'editor.action.rename');
        break;
      case 'cut':
        triggerEditorCommand(editor, 'editor.action.clipboardCutAction');
        break;
      case 'copy':
        triggerEditorCommand(editor, 'editor.action.clipboardCopyAction');
        break;
      case 'paste':
        triggerEditorCommand(editor, 'editor.action.clipboardPasteAction');
        break;
    }
  }, [language, filePath, triggerEditorCommand]);

  const findAllLocations = useCallback((method: string, kind: string) => {
    const editor = editorAppRef.current?.getEditor();
    if (!editor || !socketRef.current || !projectId) return;

    const position = editor.getPosition();
    if (!position) return;

    const model = editor.getModel();
    const wordInfo = model?.getWordAtPosition(position);
    const word = wordInfo?.word ?? '?';

    const refsStore = useReferencesStore.getState();
    refsStore.setLoading(true);
    usePanelsStore.getState().openPanel('references');

    const params: Record<string, unknown> = {
      textDocument: { uri: `file://${filePath}` },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
    };
    if (method === 'textDocument/references') {
      params.context = { includeDeclaration: true };
    }

    sendLspRequest(socketRef.current, projectId, language, method, params)
      .then((result) => {
        const locations = Array.isArray(result) ? result : [];
        refsStore.setResults(`${kind} to '${word}'`, locations);
      })
      .catch((err) => {
        console.error(`[CodeViewer] ${method} failed:`, err);
        refsStore.setResults(`${kind} to '${word}' — error`, []);
      });
  }, [language, filePath, socketRef, projectId]);

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
        <div className="flex-1 overflow-hidden" onContextMenu={handleContextMenu}>
          <MonacoEditorReactComp
            vscodeApiConfig={vscodeApiConfig}
            editorAppConfig={editorAppConfig}
            languageClientConfig={languageClientConfig}
            style={{ height: '100%' }}
            onEditorStartDone={handleEditorStartDone}
            onError={(e) => console.error('[CodeViewer] Monaco error:', e)}
          />
          {ctxMenu && (
            <EditorContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              items={buildContextMenuItems(lspReady)}
              onAction={executeEditorAction}
              onClose={() => setCtxMenu(null)}
            />
          )}
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
