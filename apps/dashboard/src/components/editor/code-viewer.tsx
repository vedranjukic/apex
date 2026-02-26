import { useRef, useCallback, useEffect } from 'react';
import { Loader2, FileText } from 'lucide-react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor, Monaco } from 'monaco-editor';
import { useEditorStore, type CodeSelection } from '../../stores/editor-store';
import { useThemeStore } from '../../stores/theme-store';
import { getLanguageFromPath } from './lang-map';
import { getMonacoThemeName, getMonacoThemeData } from './apex-theme';
import { themeIds } from '../../lib/themes';

const SNIPPET_MIME = 'application/x-codeany-snippet';

interface CodeViewerProps {
  filePath: string;
  content: string | undefined;
  onSave?: (path: string, content: string) => void;
}

export function CodeViewer({ filePath, content, onSave }: CodeViewerProps) {
  const fileName = filePath.split('/').pop() ?? filePath;
  const isLoading = content === undefined;
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const isDirty = useEditorStore((s) => s.dirtyFiles.has(filePath));
  const themeId = useThemeStore((s) => s.themeId);
  const monacoRef = useRef<Monaco | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      for (const id of themeIds) {
        monaco.editor.defineTheme(getMonacoThemeName(id), getMonacoThemeData(id));
      }
      const currentTheme = useThemeStore.getState().themeId;
      monaco.editor.setTheme(getMonacoThemeName(currentTheme));

      // Snippet copy: override Ctrl/Cmd+C to attach CodeSelection metadata
      editor.addAction({
        id: 'apex.copyWithSnippet',
        label: 'Copy with snippet metadata',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
        run: (ed) => {
          const selection = ed.getSelection();
          if (!selection || selection.isEmpty()) return;
          const model = ed.getModel();
          if (!model) return;

          const selectedText = model.getValueInRange(selection);
          const snippet: CodeSelection = {
            filePath,
            startLine: selection.startLineNumber,
            endLine: selection.endLineNumber,
            startChar: selection.startColumn - 1,
            endChar: selection.endColumn - 1,
          };

          navigator.clipboard
            .write([
              new ClipboardItem({
                'text/plain': new Blob([selectedText], { type: 'text/plain' }),
                [SNIPPET_MIME]: new Blob([JSON.stringify(snippet)], { type: SNIPPET_MIME }),
              }),
            ])
            .catch(() => {
              navigator.clipboard.writeText(selectedText);
            });

          useEditorStore.getState().setCodeSelection(snippet);
        },
      });

      // Save: Ctrl/Cmd+S
      editor.addAction({
        id: 'apex.saveFile',
        label: 'Save File',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: (ed) => {
          const model = ed.getModel();
          if (!model || !onSave) return;
          onSave(filePath, model.getValue());
        },
      });
    },
    [filePath, onSave],
  );

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(getMonacoThemeName(themeId));
    }
  }, [themeId]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      const store = useEditorStore.getState();
      store.setFileContent(filePath, value);
      store.markDirty(filePath);
    },
    [filePath],
  );

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
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <Editor
            path={filePath}
            defaultValue={content}
            language={getLanguageFromPath(filePath)}
            theme={getMonacoThemeName(themeId)}
            onMount={handleMount}
            onChange={handleChange}
            loading={
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
              </div>
            }
            options={{
              readOnly: false,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              contextmenu: false,
              folding: true,
              wordWrap: 'off',
              automaticLayout: true,
              padding: { top: 8 },
            }}
          />
        </div>
      )}
    </div>
  );
}
