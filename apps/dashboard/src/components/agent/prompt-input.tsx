import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { Send, ImagePlus, X, Square } from 'lucide-react';
import { FilePicker } from './file-picker';
import { AgentDropdown, ModelDropdown } from './mode-model-dropdowns';
import { useAgentSettingsStore } from '../../stores/agent-settings-store';
import { useEditorStore, type CodeSelection } from '../../stores/editor-store';
import { useThreadsStore } from '../../stores/tasks-store';
import type { ImageSource, GitHubContextData } from '../../api/client';

export interface ImageAttachment {
  id: string;
  dataUrl: string;
  source: ImageSource;
}

export interface PromptInputHandle {
  fill: (text: string) => void;
}

interface Props {
  onSend: (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => void;
  disabled?: boolean;
  isRunning?: boolean;
  onStop?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  requestListing?: (path: string) => void;
  hideAgentDropdown?: boolean;
  githubContext?: GitHubContextData | null;
  canCreatePr?: boolean;
  projectDir?: string | null;
}

const FILE_TAG_ATTR = 'data-file-path';
const SNIPPET_TAG_ATTR = 'data-snippet';
const GITHUB_TAG_ATTR = 'data-github-context';
const AGENT_TAG_ATTR = 'data-agent-ref';
const SKILL_TAG_ATTR = 'data-skill-ref';
const CREATE_PR_TAG_ATTR = 'data-create-pr';
const SNIPPET_MIME = 'application/x-codeany-snippet';

interface HarnessItem {
  id: string;
  label: string;
  description: string;
}

const HARNESS_AGENTS: HarnessItem[] = [
  { id: 'explore', label: 'Explore', description: 'Codebase exploration agent' },
  { id: 'librarian', label: 'Librarian', description: 'Knowledge and documentation agent' },
  { id: 'oracle', label: 'Oracle', description: 'Analysis and reasoning agent' },
  { id: 'hephaestus', label: 'Hephaestus', description: 'Build and craft agent' },
  { id: 'metis', label: 'Metis', description: 'Planning and strategy agent' },
  { id: 'momus', label: 'Momus', description: 'Code review and critique agent' },
  { id: 'multimodal-looker', label: 'Multimodal Looker', description: 'Visual analysis agent' },
];

const HARNESS_SKILLS: HarnessItem[] = [
  { id: 'playwright', label: 'Playwright', description: 'Browser automation and testing' },
  { id: 'frontend-ui-ux', label: 'Frontend UI/UX', description: 'Frontend and UI/UX tasks' },
  { id: 'git-master', label: 'Git Master', description: 'Advanced Git operations' },
  { id: 'dev-browser', label: 'Dev Browser', description: 'Development browser tasks' },
  { id: '/init-deep', label: '/init-deep', description: 'Deep initialization' },
  { id: '/ralph-loop', label: '/ralph-loop', description: 'Ralph loop workflow' },
  { id: '/ulw-loop', label: '/ulw-loop', description: 'ULW loop workflow' },
  { id: '/cancel-ralph', label: '/cancel-ralph', description: 'Cancel Ralph workflow' },
  { id: '/refactor', label: '/refactor', description: 'Code refactoring' },
  { id: '/start-work', label: '/start-work', description: 'Start work session' },
  { id: '/stop-continuation', label: '/stop-continuation', description: 'Stop continuation' },
  { id: '/handoff', label: '/handoff', description: 'Task handoff' },
];

type PickerMode = 'categories' | 'files' | 'agents' | 'skills';

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

function extractContent(el: HTMLElement): { text: string; files: string[]; snippets: CodeSelection[]; hasGithubContext: boolean; hasCreatePr: boolean } {
  const files: string[] = [];
  const snippets: CodeSelection[] = [];
  let hasGithubContext = false;
  let hasCreatePr = false;
  let text = '';

  function walk(parent: Node) {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        const tag = element.tagName;
        const filePath = element.getAttribute(FILE_TAG_ATTR);
        const snippetData = element.getAttribute(SNIPPET_TAG_ATTR);
        const ghContext = element.getAttribute(GITHUB_TAG_ATTR);
        if (filePath) {
          files.push(filePath);
          text += `@${element.getAttribute('data-file-name') ?? filePath}`;
        } else if (snippetData) {
          try {
            const sel = JSON.parse(snippetData) as CodeSelection;
            snippets.push(sel);
            text += `[snippet: ${sel.filePath}:${sel.startLine}:${sel.startChar}-${sel.endLine}:${sel.endChar}]`;
          } catch { /* ignore malformed */ }
        } else if (ghContext) {
          hasGithubContext = true;
          text += element.getAttribute('data-github-label') ?? `@${ghContext}`;
        } else if (element.hasAttribute(CREATE_PR_TAG_ATTR)) {
          hasCreatePr = true;
          text += '@create-pr';
        } else if (element.hasAttribute(AGENT_TAG_ATTR)) {
          const agentId = element.getAttribute(AGENT_TAG_ATTR);
          text += `@agent:${agentId}`;
        } else if (element.hasAttribute(SKILL_TAG_ATTR)) {
          const skillId = element.getAttribute(SKILL_TAG_ATTR);
          text += `@skill:${skillId}`;
        } else if (tag === 'BR') {
          text += '\n';
        } else if (tag === 'DIV' || tag === 'P') {
          if (text.length > 0 && !text.endsWith('\n')) {
            text += '\n';
          }
          walk(element);
        } else {
          text += element.textContent ?? '';
        }
      }
    }
  }

  walk(el);
  return { text, files, snippets, hasGithubContext, hasCreatePr };
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
      isRunning,
      onStop,
      placeholder = 'Send a message to the agent…',
      autoFocus,
      requestListing,
      hideAgentDropdown,
      githubContext,
      canCreatePr,
      projectDir,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
    const [empty, setEmpty] = useState(true);
    const [images, setImages] = useState<ImageAttachment[]>([]);
    const triggerRangeRef = useRef<Range | null>(null);
    
    // Access thread store for draft management
    const { activeThreadId, composingNew, setThreadDraft, getThreadDraft, clearThreadDraft } = useThreadsStore();

    const showPicker = pickerMode !== null;

    useImperativeHandle(ref, () => ({
      fill(text: string) {
        const el = editorRef.current;
        if (!el) return;
        el.textContent = text;
        setEmpty(!text);
        
        // Update draft when text is programmatically filled
        const threadKey = composingNew ? 'new-thread' : activeThreadId || '';
        if (text.trim()) {
          setThreadDraft(threadKey, text);
        } else {
          clearThreadDraft(threadKey);
        }
        
        setTimeout(() => el.focus(), 0);
      },
    }), [composingNew, activeThreadId, setThreadDraft, clearThreadDraft]);

    useEffect(() => {
      if (autoFocus && editorRef.current) {
        editorRef.current.focus();
      }
    }, [autoFocus]);

    // Restore draft when component mounts or thread changes
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      
      const threadKey = composingNew ? 'new-thread' : activeThreadId || '';
      const savedDraft = getThreadDraft(threadKey);
      
      if (savedDraft) {
        el.innerHTML = '';
        el.textContent = savedDraft;
        setEmpty(!savedDraft.trim());
      } else if (!composingNew) {
        // Clear editor if switching to a thread with no draft
        el.innerHTML = '';
        setEmpty(true);
      }
    }, [activeThreadId, composingNew, getThreadDraft]);

    useEffect(() => {
      const handleDocCopy = () => {
        useEditorStore.getState().setCodeSelection(null);
      };
      document.addEventListener('copy', handleDocCopy);
      return () => document.removeEventListener('copy', handleDocCopy);
    }, []);

    const updateEmpty = useCallback(() => {
      if (editorRef.current) {
        setEmpty(isEditorEmpty(editorRef.current));
      }
    }, []);

    const addImageFiles = useCallback((fileList: File[]) => {
      const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      const MAX_SIZE = 20 * 1024 * 1024;
      for (const file of fileList) {
        if (!ACCEPTED.includes(file.type)) continue;
        if (file.size > MAX_SIZE) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          const attachment: ImageAttachment = {
            id: crypto.randomUUID(),
            dataUrl,
            source: { type: 'base64', media_type: file.type, data: base64 },
          };
          setImages((prev) => [...prev, attachment]);
        };
        reader.readAsDataURL(file);
      }
    }, []);

    const removeImage = useCallback((id: string) => {
      setImages((prev) => prev.filter((img) => img.id !== id));
    }, []);

    const handleSubmit = useCallback(() => {
      const el = editorRef.current;
      if (!el || disabled) return;
      const { text, files, snippets, hasGithubContext: hasGhCtx, hasCreatePr } = extractContent(el);
      if (!text.trim() && images.length === 0) return;
      const { mode, model, agentType } = useAgentSettingsStore.getState();

      let finalText = text.trim();
      if (hasGhCtx && githubContext) {
        const ctxType = githubContext.type === 'issue' ? 'Issue' : 'Pull Request';
        const header = `GitHub ${ctxType} #${githubContext.number}: ${githubContext.title}\n${githubContext.url}\n\n${githubContext.body}`;
        finalText = `${header}\n\n---\n\n${finalText}`;
      }

      if (hasCreatePr) {
        const userInstructions = finalText.replace(/@create-pr/g, '').trim();
        const dirNote = projectDir ? `\nThe project repository is located at: ${projectDir}\nMake sure to run all git commands from this directory.\n` : '';
        let prInstructions = `Create a Pull Request for the current branch.
${dirNote}
Instructions:
1. Review all uncommitted changes. If there are any, stage and commit them with an appropriate commit message.
2. Push the current branch to the remote repository.
3. Create a new Pull Request targeting the main/default branch.
4. Generate a clear, descriptive PR title summarizing the changes.
5. Generate a PR description that explains what changed, why, and any notable implementation details.
6. Before writing the description, check if a pull request template exists in the repository (look for pull_request_template.md or PULL_REQUEST_TEMPLATE.md in the root, .github/, or docs/ directories). If a template is found, use it as the structure for the PR description and fill in each section.`;

        if (userInstructions) {
          prInstructions += `\n\nAdditional instructions from the user:\n${userInstructions}`;
        }

        finalText = prInstructions;
      }

      onSend(
        finalText,
        files.length > 0 ? files : undefined,
        mode,
        model,
        snippets.length > 0 ? snippets : undefined,
        agentType,
        images.length > 0 ? images : undefined,
      );
      
      // Clear the editor and draft on successful send
      el.innerHTML = '';
      setEmpty(true);
      setImages([]);
      
      // Clear the draft for the current thread
      const threadKey = composingNew ? 'new-thread' : activeThreadId || '';
      clearThreadDraft(threadKey);
    }, [onSend, disabled, images, githubContext, composingNew, activeThreadId, clearThreadDraft]);

    const handleStopOrSubmit = useCallback(() => {
      if (isRunning && empty && images.length === 0 && onStop) {
        onStop();
      } else {
        handleSubmit();
      }
    }, [isRunning, empty, images, onStop, handleSubmit]);

    const closePicker = useCallback(() => {
      setPickerMode(null);
      triggerRangeRef.current = null;
      editorRef.current?.focus();
    }, []);

    const replaceAtTrigger = useCallback((tag: HTMLSpanElement) => {
      const el = editorRef.current;
      if (!el) return;
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
    }, [updateEmpty]);

    const handleCategorySelect = useCallback((category: string) => {
      if (category === 'files') {
        setPickerMode('files');
        return;
      }
      if (category === 'agents') {
        setPickerMode('agents');
        return;
      }
      if (category === 'skills') {
        setPickerMode('skills');
        return;
      }
      if (category === 'create-pr') {
        setPickerMode(null);
        const tag = createCreatePrTag();
        replaceAtTrigger(tag);
        return;
      }
      if (category === 'issue' && githubContext?.type === 'issue') {
        setPickerMode(null);
        const tag = createGitHubContextTag(githubContext);
        replaceAtTrigger(tag);
        return;
      }
      if (category === 'pr' && githubContext?.type === 'pull') {
        setPickerMode(null);
        const tag = createGitHubContextTag(githubContext);
        replaceAtTrigger(tag);
        return;
      }
      closePicker();
    }, [githubContext, replaceAtTrigger, closePicker]);

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
            el.hasAttribute(FILE_TAG_ATTR) || el.hasAttribute(SNIPPET_TAG_ATTR) || el.hasAttribute(GITHUB_TAG_ATTR) || el.hasAttribute(AGENT_TAG_ATTR) || el.hasAttribute(SKILL_TAG_ATTR) || el.hasAttribute(CREATE_PR_TAG_ATTR);

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

      // Save draft text
      const { text } = extractContent(el);
      const threadKey = composingNew ? 'new-thread' : activeThreadId || '';
      if (text.trim()) {
        setThreadDraft(threadKey, text);
      } else {
        clearThreadDraft(threadKey);
      }

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

      if (!showPicker) {
        const savedRange = range.cloneRange();
        savedRange.setStart(node, atIdx);
        triggerRangeRef.current = savedRange;
        const rect = getCaretRect();
        setPickerAnchor(rect);

        setPickerMode('categories');
      }
    }, [showPicker, updateEmpty, composingNew, activeThreadId, setThreadDraft, clearThreadDraft]);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        const clipItems = Array.from(e.clipboardData.items);
        const imageFiles = clipItems
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);

        if (imageFiles.length > 0) {
          e.preventDefault();
          addImageFiles(imageFiles);
          return;
        }

        e.preventDefault();

        const snippetJson = e.clipboardData.getData(SNIPPET_MIME);
        let snippet: CodeSelection | null = null;
        if (snippetJson) {
          try { snippet = JSON.parse(snippetJson); } catch { /* ignore */ }
        }

        if (!snippet) {
          const store = useEditorStore.getState();
          const clipText = e.clipboardData.getData('text/plain');
          if (store.codeSelection && store.codeSelectionText && clipText === store.codeSelectionText) {
            snippet = store.codeSelection;
          }
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
      [updateEmpty, addImageFiles],
    );

    const handleFileSelect = useCallback(
      (filePath: string, isDirectory: boolean) => {
        setPickerMode(null);
        const fileName = filePath.split('/').pop() ?? filePath;
        const tag = createFileTag(filePath, fileName, isDirectory);
        replaceAtTrigger(tag);
      },
      [replaceAtTrigger],
    );

    const handleAgentSelect = useCallback(
      (item: HarnessItem) => {
        setPickerMode(null);
        const tag = createAgentTag(item);
        replaceAtTrigger(tag);
      },
      [replaceAtTrigger],
    );

    const handleSkillSelect = useCallback(
      (item: HarnessItem) => {
        setPickerMode(null);
        const tag = createSkillTag(item);
        replaceAtTrigger(tag);
      },
      [replaceAtTrigger],
    );

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

    const hasContent = !empty || images.length > 0;

    return (
      <div className="border-t border-border bg-sidebar p-4 relative">
        <div className="max-w-3xl mx-auto">
          <div className="relative">
            {/* Image preview strip */}
            {images.length > 0 && (
              <div className="flex gap-2 px-4 py-2 bg-surface-thread border border-b-0 border-border rounded-t-xl overflow-x-auto">
                {images.map((img) => (
                  <div key={img.id} className="relative shrink-0 group">
                    <img
                      src={img.dataUrl}
                      alt="Attachment"
                      className="h-16 w-16 rounded-lg object-cover border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface-secondary border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20 hover:border-red-500/40"
                    >
                      <X className="w-3 h-3 text-text-muted" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
              className={`prompt-editor px-4 py-3 bg-surface-thread border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary max-h-32 overflow-y-auto whitespace-pre-wrap break-words ${images.length > 0 ? '' : 'rounded-t-xl'}`}
              style={{ minHeight: '44px' }}
              suppressContentEditableWarning
              onClick={() => {
                if (editorRef.current && editorRef.current.childNodes.length === 0) {
                  editorRef.current.focus();
                }
              }}
            />
            {pickerMode === 'categories' && (
              <div className="absolute bottom-full left-0 mb-2">
                <CategoryPicker
                  onSelect={handleCategorySelect}
                  onClose={closePicker}
                  hasFiles={!!requestListing}
                  hasIssue={githubContext?.type === 'issue'}
                  hasPr={githubContext?.type === 'pull'}
                  hasCreatePr={!!canCreatePr}
                  anchorRect={pickerAnchor ?? undefined}
                />
              </div>
            )}
            {pickerMode === 'files' && requestListing && (
              <div className="absolute bottom-full left-0 mb-2">
                <FilePicker
                  onSelect={handleFileSelect}
                  onClose={closePicker}
                  requestListing={requestListing}
                  anchorRect={pickerAnchor ?? undefined}
                />
              </div>
            )}
            {pickerMode === 'agents' && (
              <div className="absolute bottom-full left-0 mb-2">
                <HarnessItemPicker
                  items={HARNESS_AGENTS}
                  onSelect={handleAgentSelect}
                  onClose={closePicker}
                  title="Select agent"
                />
              </div>
            )}
            {pickerMode === 'skills' && (
              <div className="absolute bottom-full left-0 mb-2">
                <HarnessItemPicker
                  items={HARNESS_SKILLS}
                  onSelect={handleSkillSelect}
                  onClose={closePicker}
                  title="Select skill"
                />
              </div>
            )}
          </div>

          {/* Toolbar row */}
          <div className="flex items-center gap-1 px-2 py-1.5 bg-surface-thread border border-t-0 border-border rounded-b-xl">
            {!hideAgentDropdown && <AgentDropdown />}
            <ModelDropdown />
            <div className="flex-1" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addImageFiles(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Attach image"
              className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50"
            >
              <ImagePlus className="w-3.5 h-3.5" />
            </button>
            {isRunning && !hasContent && onStop ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop generating"
                className="p-1.5 bg-red-500/80 text-white rounded-lg hover:bg-red-500 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !hasContent}
                className="p-1.5 bg-primary text-on-primary rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

// ── Category Picker ──────────────────────────────────

interface CategoryPickerProps {
  onSelect: (category: string) => void;
  onClose: () => void;
  hasFiles: boolean;
  hasIssue?: boolean;
  hasPr?: boolean;
  hasCreatePr?: boolean;
  anchorRect?: { top: number; left: number };
}

function CategoryPicker({ onSelect, onClose, hasFiles, hasIssue, hasPr, hasCreatePr, anchorRect }: CategoryPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const items: { id: string; label: string; icon: string; sublabel: string }[] = [];
  if (hasFiles) items.push({ id: 'files', label: 'Files', icon: FILE_ICON_SVG, sublabel: 'Browse project files' });
  items.push({ id: 'agents', label: 'Agents', icon: AGENT_ICON_SVG, sublabel: 'Use a specialized agent' });
  items.push({ id: 'skills', label: 'Skills', icon: SKILL_ICON_SVG, sublabel: 'Apply a skill or command' });
  if (hasCreatePr) items.push({ id: 'create-pr', label: 'Create PR', icon: CREATE_PR_ICON_SVG, sublabel: 'Create a pull request for this branch' });
  if (hasIssue) items.push({ id: 'issue', label: 'Issue', icon: ISSUE_ICON_SVG, sublabel: 'Attach GitHub issue context' });
  if (hasPr) items.push({ id: 'pr', label: 'PR', icon: PR_ICON_SVG, sublabel: 'Attach pull request context' });

  // If only files and no GitHub context, skip category picker and go straight to files
  useEffect(() => {
    if (items.length === 1 && items[0].id === 'files') {
      onSelect('files');
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (items[highlightIdx]) onSelect(items[highlightIdx].id);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onSelect, items, highlightIdx]);

  if (items.length <= 1) return null;

  return (
    <div
      ref={panelRef}
      className="bg-surface border border-border rounded-lg shadow-xl overflow-hidden w-64"
    >
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Insert reference</span>
      </div>
      <div className="py-1">
        {items.map((item, idx) => (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => setHighlightIdx(idx)}
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
              idx === highlightIdx ? 'bg-primary/10 text-text-primary' : 'text-text-secondary hover:bg-surface-secondary'
            }`}
          >
            <span
              className="flex items-center shrink-0 text-text-muted"
              dangerouslySetInnerHTML={{ __html: item.icon }}
            />
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-[11px] text-text-muted truncate">{item.sublabel}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── SVG Icons ────────────────────────────────────────

const ISSUE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>`;
const PR_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>`;
const FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
const ISSUE_ICON_SVG_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>`;
const PR_ICON_SVG_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>`;
const FILE_ICON_SVG_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
const CODE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`;
const CREATE_PR_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/><path d="M21 3v4h-4"/></svg>`;
const CREATE_PR_ICON_SVG_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/><path d="M21 3v4h-4"/></svg>`;
const AGENT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="10" x="3" y="11" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" x2="8" y1="16" y2="16"/><line x1="16" x2="16" y1="16" y2="16"/></svg>`;
const SKILL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`;
const AGENT_ICON_SVG_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="10" x="3" y="11" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" x2="8" y1="16" y2="16"/><line x1="16" x2="16" y1="16" y2="16"/></svg>`;
const SKILL_ICON_SVG_SM = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`;
const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

// ── Harness Item Picker ──────────────────────────────

interface HarnessItemPickerProps {
  items: HarnessItem[];
  onSelect: (item: HarnessItem) => void;
  onClose: () => void;
  title: string;
}

function HarnessItemPicker({ items, onSelect, onClose, title }: HarnessItemPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(filter.toLowerCase()) ||
    item.id.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlightIdx(0);
  }, [filter]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => (filtered.length > 0 ? (i + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => (filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filtered[highlightIdx]) onSelect(filtered[highlightIdx]);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onSelect, filtered, highlightIdx]);

  return (
    <div
      ref={panelRef}
      className="bg-surface border border-border rounded-lg shadow-xl overflow-hidden w-72"
    >
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{title}</span>
      </div>
      <div className="px-2 py-1.5 border-b border-border">
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
        />
      </div>
      <div ref={listRef} className="py-1 max-h-56 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-xs text-text-muted">No matches</div>
        )}
        {filtered.map((item, idx) => (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => setHighlightIdx(idx)}
            onClick={() => onSelect(item)}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
              idx === highlightIdx ? 'bg-primary/10 text-text-primary' : 'text-text-secondary hover:bg-surface-secondary'
            }`}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-[11px] text-text-muted truncate">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tag Factories ────────────────────────────────────

function createFileTag(filePath: string, fileName: string, isDirectory = false): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.setAttribute(FILE_TAG_ATTR, filePath);
  tag.setAttribute('data-file-name', fileName);
  tag.contentEditable = 'false';
  tag.className =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium align-baseline cursor-default select-none';
  tag.title = filePath;

  const icon = document.createElement('span');
  icon.innerHTML = isDirectory ? FOLDER_ICON_SVG : FILE_ICON_SVG_SM;
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

function createAgentTag(item: HarnessItem): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.setAttribute(AGENT_TAG_ATTR, item.id);
  tag.contentEditable = 'false';
  tag.className =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-amber-500/10 text-amber-400 text-xs font-medium align-baseline cursor-default select-none';
  tag.title = item.description;

  const icon = document.createElement('span');
  icon.innerHTML = AGENT_ICON_SVG_SM;
  icon.className = 'flex items-center';
  tag.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = item.label;
  tag.appendChild(label);

  const close = document.createElement('span');
  close.innerHTML = CLOSE_ICON_SVG;
  close.className =
    'flex items-center cursor-pointer rounded hover:bg-amber-500/20 ml-0.5';
  close.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tag.remove();
  });
  tag.appendChild(close);

  return tag;
}

function createSkillTag(item: HarnessItem): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.setAttribute(SKILL_TAG_ATTR, item.id);
  tag.contentEditable = 'false';
  tag.className =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-violet-500/10 text-violet-400 text-xs font-medium align-baseline cursor-default select-none';
  tag.title = item.description;

  const icon = document.createElement('span');
  icon.innerHTML = SKILL_ICON_SVG_SM;
  icon.className = 'flex items-center';
  tag.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = item.label;
  tag.appendChild(label);

  const close = document.createElement('span');
  close.innerHTML = CLOSE_ICON_SVG;
  close.className =
    'flex items-center cursor-pointer rounded hover:bg-violet-500/20 ml-0.5';
  close.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tag.remove();
  });
  tag.appendChild(close);

  return tag;
}

function createCreatePrTag(): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.setAttribute(CREATE_PR_TAG_ATTR, 'true');
  tag.contentEditable = 'false';
  tag.className =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-cyan-500/10 text-cyan-400 text-xs font-medium align-baseline cursor-default select-none';
  tag.title = 'Create a pull request for the current branch';

  const icon = document.createElement('span');
  icon.innerHTML = CREATE_PR_ICON_SVG_SM;
  icon.className = 'flex items-center';
  tag.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = 'Create PR';
  tag.appendChild(label);

  const close = document.createElement('span');
  close.innerHTML = CLOSE_ICON_SVG;
  close.className =
    'flex items-center cursor-pointer rounded hover:bg-cyan-500/20 ml-0.5';
  close.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tag.remove();
  });
  tag.appendChild(close);

  return tag;
}

function createGitHubContextTag(ctx: GitHubContextData): HTMLSpanElement {
  const isIssue = ctx.type === 'issue';
  const labelText = isIssue ? `Issue #${ctx.number}` : `PR #${ctx.number}`;
  const displayLabel = `@${isIssue ? 'issue' : 'pr'}`;

  const tag = document.createElement('span');
  tag.setAttribute(GITHUB_TAG_ATTR, ctx.type);
  tag.setAttribute('data-github-label', displayLabel);
  tag.contentEditable = 'false';
  tag.className =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-green-500/10 text-green-400 text-xs font-medium align-baseline cursor-default select-none';
  tag.title = `${labelText}: ${ctx.title}`;

  const icon = document.createElement('span');
  icon.innerHTML = isIssue ? ISSUE_ICON_SVG_SM : PR_ICON_SVG_SM;
  icon.className = 'flex items-center';
  tag.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = labelText;
  tag.appendChild(label);

  const close = document.createElement('span');
  close.innerHTML = CLOSE_ICON_SVG;
  close.className =
    'flex items-center cursor-pointer rounded hover:bg-green-500/20 ml-0.5';
  close.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tag.remove();
  });
  tag.appendChild(close);

  return tag;
}
