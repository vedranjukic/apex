import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { Send } from 'lucide-react';
import { FilePicker } from './file-picker';
import { ModeDropdown, ModelDropdown } from './mode-model-dropdowns';
import { useAgentSettingsStore } from '../../stores/agent-settings-store';
import { useEditorStore, type CodeSelection } from '../../stores/editor-store';

export interface PromptInputHandle {
  fill: (text: string) => void;
}

interface Props {
  onSend: (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  requestListing?: (path: string) => void;
}

const FILE_TAG_ATTR = 'data-file-path';
const SNIPPET_TAG_ATTR = 'data-snippet';
const SNIPPET_MIME = 'application/x-codeany-snippet';

function getCaretRect(): { top: number; left: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.top === 0 && rect.left === 0) {
    const span = document.createElement('span');
    span.textContent = '\u200b';
    range.insertNode(span);
    const spanRect = span.getBoundingClientRect();
    span.parentNode?.removeChild(span);
    sel.removeAllRanges();
    sel.addRange(range);
    return { top: spanRect.top, left: spanRect.left };
  }
  return { top: rect.top, left: rect.left };
}

function extractContent(el: HTMLElement): { text: string; files: string[]; snippets: CodeSelection[] } {
  const files: string[] = [];
  const snippets: CodeSelection[] = [];
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const filePath = element.getAttribute(FILE_TAG_ATTR);
      const snippetData = element.getAttribute(SNIPPET_TAG_ATTR);
      if (filePath) {
        files.push(filePath);
        text += `@${element.getAttribute('data-file-name') ?? filePath}`;
      } else if (snippetData) {
        try {
          const sel = JSON.parse(snippetData) as CodeSelection;
          snippets.push(sel);
          text += `[snippet: ${sel.filePath}:${sel.startLine}:${sel.startChar}-${sel.endLine}:${sel.endChar}]`;
        } catch { /* ignore malformed */ }
      } else if (element.tagName === 'BR') {
        text += '\n';
      } else {
        text += element.textContent ?? '';
      }
    }
  }
  return { text, files, snippets };
}

function insertNodeAtCursor(node: Node): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  const after = document.createTextNode('\u00a0');
  node.parentNode?.insertBefore(after, node.nextSibling);
  range.setStartAfter(after);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function isEditorEmpty(el: HTMLElement): boolean {
  const { text } = extractContent(el);
  return text.trim().length === 0;
}

export const PromptInput = forwardRef<PromptInputHandle, Props>(
  function PromptInput(
    {
      onSend,
      disabled,
      placeholder = 'Send a message to the agent…',
      autoFocus,
      requestListing,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const [showPicker, setShowPicker] = useState(false);
    const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
    const [empty, setEmpty] = useState(true);
    const triggerRangeRef = useRef<Range | null>(null);

    useImperativeHandle(ref, () => ({
      fill(text: string) {
        const el = editorRef.current;
        if (!el) return;
        el.textContent = text;
        setEmpty(!text);
        setTimeout(() => el.focus(), 0);
      },
    }));

    useEffect(() => {
      if (autoFocus && editorRef.current) {
        editorRef.current.focus();
      }
    }, [autoFocus]);

    const updateEmpty = useCallback(() => {
      if (editorRef.current) {
        setEmpty(isEditorEmpty(editorRef.current));
      }
    }, []);

    const handleSubmit = useCallback(() => {
      const el = editorRef.current;
      if (!el || disabled) return;
      const { text, files, snippets } = extractContent(el);
      if (!text.trim()) return;
      const { mode, model } = useAgentSettingsStore.getState();
      onSend(
        text.trim(),
        files.length > 0 ? files : undefined,
        mode,
        model,
        snippets.length > 0 ? snippets : undefined,
      );
      el.innerHTML = '';
      setEmpty(true);
    }, [onSend, disabled]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (showPicker) return;

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
          return;
        }

        if (e.key === 'Backspace') {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          const range = sel.getRangeAt(0);
          if (!range.collapsed) return;

          const { startContainer, startOffset } = range;
          const isTag = (el: HTMLElement) =>
            el.hasAttribute(FILE_TAG_ATTR) || el.hasAttribute(SNIPPET_TAG_ATTR);

          if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
            const prev = startContainer.previousSibling;
            if (prev && prev.nodeType === Node.ELEMENT_NODE && isTag(prev as HTMLElement)) {
              e.preventDefault();
              prev.parentNode?.removeChild(prev);
              updateEmpty();
              return;
            }
          }

          if (startContainer === editorRef.current) {
            const child = editorRef.current.childNodes[startOffset - 1];
            if (child && child.nodeType === Node.ELEMENT_NODE && isTag(child as HTMLElement)) {
              e.preventDefault();
              child.parentNode?.removeChild(child);
              updateEmpty();
              return;
            }
          }
        }
      },
      [handleSubmit, showPicker, updateEmpty],
    );

    const handleInput = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;
      updateEmpty();

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return;

      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return;
      const textBefore = (node.textContent ?? '').slice(0, range.startOffset);
      const atIdx = textBefore.lastIndexOf('@');
      if (atIdx === -1) return;

      const charBeforeAt = atIdx > 0 ? textBefore[atIdx - 1] : undefined;
      if (charBeforeAt && charBeforeAt !== ' ' && charBeforeAt !== '\n') return;

      if (!showPicker && requestListing) {
        const savedRange = range.cloneRange();
        savedRange.setStart(node, atIdx);
        triggerRangeRef.current = savedRange;
        const rect = getCaretRect();
        setPickerAnchor(rect);
        setShowPicker(true);
      }
    }, [showPicker, requestListing, updateEmpty]);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        e.preventDefault();

        const snippetJson = e.clipboardData.getData(SNIPPET_MIME);
        let snippet: CodeSelection | null = null;
        if (snippetJson) {
          try { snippet = JSON.parse(snippetJson); } catch { /* ignore */ }
        }
        if (!snippet) {
          snippet = useEditorStore.getState().codeSelection;
        }

        if (snippet) {
          const tag = createSnippetTag(snippet);
          insertNodeAtCursor(tag);
          useEditorStore.getState().setCodeSelection(null);
          updateEmpty();
          return;
        }

        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      },
      [updateEmpty],
    );

    const handleFileSelect = useCallback(
      (filePath: string, isDirectory: boolean) => {
        setShowPicker(false);
        const el = editorRef.current;
        if (!el) return;

        const fileName = filePath.split('/').pop() ?? filePath;

        if (triggerRangeRef.current) {
          const sel = window.getSelection();
          if (sel) {
            const tRange = triggerRangeRef.current;
            const textNode = tRange.startContainer;
            if (textNode.nodeType === Node.TEXT_NODE) {
              const fullText = textNode.textContent ?? '';
              const atStart = tRange.startOffset;
              const currentSel = sel.getRangeAt(0);
              const atEnd = currentSel.startContainer === textNode
                ? currentSel.startOffset
                : atStart + 1;
              const before = fullText.slice(0, atStart);
              const after = fullText.slice(atEnd);
              textNode.textContent = before;

              const tag = createFileTag(filePath, fileName, isDirectory);
              const afterNode = document.createTextNode(after || '\u00a0');

              textNode.parentNode?.insertBefore(afterNode, textNode.nextSibling);
              textNode.parentNode?.insertBefore(tag, afterNode);

              const newRange = document.createRange();
              newRange.setStart(afterNode, after ? 0 : 1);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          }
          triggerRangeRef.current = null;
        }

        updateEmpty();
        el.focus();
      },
      [updateEmpty],
    );

    const handleClosePicker = useCallback(() => {
      setShowPicker(false);
      triggerRangeRef.current = null;
      editorRef.current?.focus();
    }, []);

    const handleTagRemove = useCallback(
      (filePath: string) => {
        const el = editorRef.current;
        if (!el) return;
        const tag = el.querySelector(`[${FILE_TAG_ATTR}="${CSS.escape(filePath)}"]`);
        if (tag) {
          tag.remove();
          updateEmpty();
        }
        el.focus();
      },
      [updateEmpty],
    );

    return (
      <div className="border-t border-border bg-surface-chat p-4 relative">
        <div className="max-w-3xl mx-auto">
          <div className="relative">
            <div
              ref={editorRef}
              contentEditable={!disabled}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              onPaste={handlePaste}
              role="textbox"
              aria-placeholder={placeholder}
              aria-disabled={disabled}
              data-placeholder={placeholder}
              className="prompt-editor px-4 py-3 bg-sidebar border border-border rounded-t-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 max-h-32 overflow-y-auto whitespace-pre-wrap break-words"
              style={{ minHeight: '44px' }}
              suppressContentEditableWarning
              onClick={() => {
                if (editorRef.current && editorRef.current.childNodes.length === 0) {
                  editorRef.current.focus();
                }
              }}
            />
            {showPicker && requestListing && (
              <div className="absolute bottom-full left-0 mb-2">
                <FilePicker
                  onSelect={handleFileSelect}
                  onClose={handleClosePicker}
                  requestListing={requestListing}
                  anchorRect={pickerAnchor ?? undefined}
                />
              </div>
            )}
          </div>

          {/* Toolbar row */}
          <div className="flex items-center gap-1 px-2 py-1.5 bg-sidebar border border-t-0 border-border rounded-b-xl">
            <ModeDropdown />
            <ModelDropdown />
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || empty}
              className="p-1.5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  },
);

const FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
const CODE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`;
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

function createFileTag(filePath: string, fileName: string, isDirectory = false): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.setAttribute(FILE_TAG_ATTR, filePath);
  tag.setAttribute('data-file-name', fileName);
  tag.contentEditable = 'false';
  tag.className =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium align-baseline cursor-default select-none';
  tag.title = filePath;

  const icon = document.createElement('span');
  icon.innerHTML = isDirectory ? FOLDER_ICON_SVG : FILE_ICON_SVG;
  icon.className = 'flex items-center';
  tag.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = fileName;
  tag.appendChild(label);

  const close = document.createElement('span');
  close.innerHTML = CLOSE_ICON_SVG;
  close.className =
    'flex items-center cursor-pointer rounded hover:bg-primary/20 ml-0.5';
  close.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tag.remove();
  });
  tag.appendChild(close);

  return tag;
}

function createSnippetTag(snippet: CodeSelection): HTMLSpanElement {
  const fileName = snippet.filePath.split('/').pop() ?? snippet.filePath;
  const labelText = `${fileName}:${snippet.startLine}-${snippet.endLine}`;

  const tag = document.createElement('span');
  tag.setAttribute(SNIPPET_TAG_ATTR, JSON.stringify(snippet));
  tag.setAttribute('data-snippet-label', labelText);
  tag.contentEditable = 'false';
  tag.className =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-accent/10 text-accent text-xs font-medium align-baseline cursor-default select-none';
  tag.title = `${snippet.filePath}:${snippet.startLine}:${snippet.startChar}-${snippet.endLine}:${snippet.endChar}`;

  const icon = document.createElement('span');
  icon.innerHTML = CODE_ICON_SVG;
  icon.className = 'flex items-center';
  tag.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = labelText;
  tag.appendChild(label);

  const close = document.createElement('span');
  close.innerHTML = CLOSE_ICON_SVG;
  close.className =
    'flex items-center cursor-pointer rounded hover:bg-accent/20 ml-0.5';
  close.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tag.remove();
  });
  tag.appendChild(close);

  return tag;
}
