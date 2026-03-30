import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  TerminalSquare,
  FileText,
  FileSearch,
  FilePen,
  ListTodo,
  HelpCircle,
  Globe,
  Search,
  Wrench,
  ChevronDown,
  ChevronRight,
  Circle,
  CheckCircle2,
  Check,
  Loader2,
  Minus,
  Plus,
  Send,
} from 'lucide-react';
import type { ContentBlock } from '../../api/client';
import { cn } from '../../lib/cn';
import { useThreadActions } from './thread-actions-context';
import { useThreadsStore } from '../../stores/tasks-store';
import { useEditorStore } from '../../stores/editor-store';

type Input = Record<string, unknown>;

function basename(filepath: string): string {
  return filepath.split('/').pop() || filepath;
}

function extname(filepath: string): string {
  const name = basename(filepath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

// ── Main dispatcher ──────────────────────────────────

const HIDDEN_TOOLS = new Set([
  'ExitPlanMode',
  'ExitAskMode',
  'EnterPlanMode',
]);

const MCP_HANDLED_TOOLS = new Set([
  'mcp__terminal-server__ask_user',
  'terminal-server_ask_user',
]);

/** Tool names that should be hidden (MCP internal / plumbing tools). */
const HIDDEN_MCP_TOOLS = new Set([
  'terminal-server_get_plan_format_instructions',
  'mcp__terminal-server__get_plan_format_instructions',
]);

const TOOL_NAME_ALIASES: Record<string, string> = {
  todowrite: 'TodoWrite',
  todo_write: 'TodoWrite',
  websearch: 'WebSearch',
  web_search: 'WebSearch',
  webfetch: 'WebFetch',
  web_fetch: 'WebFetch',
  strreplace: 'StrReplace',
  str_replace: 'StrReplace',
  multiedit: 'MultiEdit',
  multi_edit: 'MultiEdit',
  askuserquestion: 'AskUserQuestion',
  question: 'AskUserQuestion',
  'terminal-server_ask_user': 'AskUserQuestion',
  'mcp__terminal-server__ask_user': 'AskUserQuestion',
};

export function normalizeTool(name: string): string {
  return TOOL_NAME_ALIASES[name.toLowerCase()] ?? name;
}

export function ToolUseBlock({ block, resultContent }: { block: ContentBlock; resultContent?: string }) {
  const rawName = block.name ?? '';
  const name = normalizeTool(rawName);
  if (HIDDEN_TOOLS.has(name) || HIDDEN_MCP_TOOLS.has(rawName) || (rawName.startsWith('mcp__') && !MCP_HANDLED_TOOLS.has(rawName))) return null;

  const input = (block.input ?? {}) as Input;
  switch (name) {
    case 'Task':
      return <TaskBlock input={input} result={resultContent} />;
    case 'Bash':
      return <BashBlock input={input} />;
    case 'Write':
      return <WriteBlock input={input} resultContent={resultContent} />;
    case 'Read':
      return <ReadBlock input={input} />;
    case 'Edit':
    case 'StrReplace':
      return <EditBlock input={input} />;
    case 'MultiEdit':
      return <MultiEditBlock input={input} />;
    case 'TodoWrite':
      return <TodoWriteBlock input={input} />;
    case 'AskUserQuestion':
    case 'mcp__terminal-server__ask_user':
      return <AskQuestionBlock input={input} toolUseId={block.id} />;
    case 'WebSearch':
      return <WebSearchBlock input={input} />;
    case 'WebFetch':
      return <WebFetchBlock input={input} />;
    case 'Glob':
    case 'Grep':
      return <SearchBlock name={name} input={input} />;
    default:
      return <GenericToolBlock name={rawName} input={input} />;
  }
}

// ── Bash ─────────────────────────────────────────────

export interface BashItem {
  toolUse: ContentBlock;
  toolResult?: ContentBlock;
}

/** Extract display text from tool_result content (string or Anthropic array format). */
export function getToolResultText(block: ContentBlock | undefined): string {
  if (!block) return '';
  const c: unknown = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return (c as Array<{ type?: string; text?: string }>)
      .filter((part) => part != null && typeof part === 'object')
      .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function BashItemBlock({
  command,
  description,
  output,
  isRunning,
}: {
  command: string;
  description: string | null;
  output: string;
  isRunning?: boolean;
}) {
  const [outputExpanded, setOutputExpanded] = useState(false);
  const hasOutput = output.length > 0;
  const outputEndRef = useRef<HTMLPreElement>(null);

  const lines = output.split('\n');
  const last3Lines = lines.slice(-3).join('\n');

  useEffect(() => {
    if (isRunning && outputExpanded && outputEndRef.current) {
      outputEndRef.current.scrollTop = outputEndRef.current.scrollHeight;
    }
  }, [output, isRunning, outputExpanded]);

  return (
    <div className="bg-surface-secondary">
      {description && (
        <p className="px-3 py-2 text-xs text-text-muted italic">{description}</p>
      )}
      {description && <div className="border-t border-border" />}

      <pre className="px-3 py-2 text-text-primary text-xs font-mono overflow-x-auto leading-relaxed">
        <code>{command}</code>
      </pre>

      {(hasOutput || isRunning) && (
        <>
          <div className="border-t border-border" />
          {hasOutput ? (
            <>
              {outputExpanded ? (
                <div className="overflow-hidden transition-[max-height] duration-200">
                  <pre ref={outputEndRef} className="px-3 py-2 text-text-muted text-xs font-mono overflow-x-auto leading-relaxed overflow-y-auto bg-surface max-h-[12.5rem]">
                    <code>{output}</code>
                  </pre>
                </div>
              ) : (
                <pre className="px-3 py-2 text-text-muted text-xs font-mono overflow-x-auto leading-relaxed bg-surface">
                  <code>{last3Lines}</code>
                </pre>
              )}
              {isRunning && (
                <div className="h-0.5 bg-surface overflow-hidden">
                  <div className="h-full w-1/3 bg-blue-500/50 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" />
                </div>
              )}
              <button
                type="button"
                onClick={() => setOutputExpanded(!outputExpanded)}
                className="w-full flex items-center justify-center px-3 py-1.5 bg-surface text-text-secondary text-xs hover:text-text-primary transition-colors border-t border-border"
              >
                {outputExpanded ? '△' : '▽'}
              </button>
            </>
          ) : (
            <div className="px-3 py-2 bg-surface flex items-center gap-2">
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
              <span className="text-xs text-text-muted">Running...</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function BashGroupBlock({ items }: { items: BashItem[] }) {
  if (items.length === 0) return null;

  const anyRunning = items.some((item) => !item.toolResult || item.toolResult._streaming);

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <TerminalSquare className="w-3.5 h-3.5" />
        <span className="font-medium">Bash</span>
        {items.length > 1 && (
          <span className="text-text-muted">{items.length} commands</span>
        )}
        {anyRunning && (
          <span className="ml-auto flex items-center gap-1.5 text-blue-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px]">running</span>
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {items.map((item, i) => {
          const input = (item.toolUse.input ?? {}) as Input;
          const command = String(input.command ?? '');
          const description = input.description ? String(input.description) : null;
          const output = getToolResultText(item.toolResult);
          const isRunning = !item.toolResult || !!item.toolResult._streaming;

          return (
            <BashItemBlock
              key={i}
              command={command}
              description={description}
              output={output}
              isRunning={isRunning}
            />
          );
        })}
      </div>
    </div>
  );
}

function BashBlock({ input }: { input: Input }) {
  const command = String(input.command ?? '');
  const description = input.description ? String(input.description) : null;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <TerminalSquare className="w-3.5 h-3.5" />
        <span className="font-medium">Bash</span>
      </div>
      <div className="bg-surface-secondary">
        {/* Description on top */}
        {description && (
          <p className="px-3 py-2 text-xs text-text-muted italic">{description}</p>
        )}
        {description && <div className="border-t border-border" />}

        {/* Command */}
        <pre className="px-3 py-2.5 text-text-primary text-xs font-mono overflow-x-auto leading-relaxed">
          <code>{command}</code>
        </pre>
      </div>
    </div>
  );
}

// ── Task (subagent delegation) ──────

interface ChildActivityItem {
  type: 'text' | 'tool';
  text?: string;
  name?: string;
  status?: string;
  title?: string;
}

function TaskBlock({ input, result }: { input: Input; result?: string }) {
  const description = input.description ? String(input.description) : null;
  const prompt = input.prompt ? String(input.prompt) : null;
  const agentType = input.subagent_type ? String(input.subagent_type) : 'general';
  const childActivity = Array.isArray(input._childActivity)
    ? (input._childActivity as ChildActivityItem[])
    : [];
  const hasResult = !!result;
  const [expanded, setExpanded] = useState(!hasResult);
  const activityEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hasResult) setExpanded(false);
  }, [hasResult]);

  useEffect(() => {
    if (expanded && activityEndRef.current) {
      activityEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [childActivity.length, expanded]);

  const hasActivity = childActivity.length > 0;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-surface-secondary text-text-secondary text-xs hover:bg-surface-hover transition-colors"
      >
        {hasResult
          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
          : <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />}
        <span className="font-medium truncate">{description || 'Subagent task'}</span>
        <span className="text-text-muted ml-1">({agentType})</span>
        {hasResult
          ? <CheckCircle2 className="w-3 h-3 text-green-500 ml-auto shrink-0" />
          : hasActivity
            ? <span className="text-blue-400 ml-auto text-[10px]">{childActivity.filter(a => a.type === 'tool' && a.status === 'running').length > 0 ? 'working...' : 'running...'}</span>
            : <span className="text-text-muted ml-auto text-[10px]">running...</span>}
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
      </button>
      {expanded && (
        <div className="border-t border-border">
          {prompt && (
            <div className="px-3 py-2 text-xs text-text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">{prompt}</div>
          )}
          {hasActivity && (
            <div className="border-t border-border-subtle max-h-48 overflow-y-auto">
              <div className="px-3 py-1.5 space-y-1">
                {childActivity.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {item.type === 'text' ? (
                      <p className="text-text-secondary leading-relaxed">{item.text}</p>
                    ) : (
                      <div className="flex items-center gap-1.5 py-0.5">
                        {item.status === 'completed'
                          ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                          : item.status === 'error'
                            ? <Circle className="w-3 h-3 text-red-400 shrink-0" />
                            : <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />}
                        <span className="font-medium text-text-secondary">{item.name}</span>
                        {item.title && item.title !== item.name && (
                          <span className="text-text-muted truncate max-w-[200px]">{item.title}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={activityEndRef} />
              </div>
            </div>
          )}
          {result && (
            <div className="px-3 py-2 border-t border-border-subtle text-xs text-text-secondary whitespace-pre-wrap max-h-60 overflow-y-auto">{result}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Write ────────────────────────────────────────────

function WriteBlock({ input, resultContent }: { input: Input; resultContent?: string }) {
  const filePath = String(input.file_path ?? input.filePath ?? '');
  const patchText = String(input.patchText ?? '');
  const content = String(input.content ?? '');
  const [expanded, setExpanded] = useState(false);

  if (patchText && !filePath) {
    return <PatchWriteBlock patchText={patchText} resultContent={resultContent} />;
  }

  const lines = content.split('\n');
  const isLong = lines.length > 20;

  const displayLines = isLong && !expanded ? lines.slice(0, 10) : lines;
  const ext = extname(filePath);

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <FileText className="w-3.5 h-3.5 text-blue-400" />
        <span className="font-medium font-mono">{basename(filePath)}</span>
        {ext && <span className="text-text-muted">{ext}</span>}
        <span className="text-text-muted ml-auto">{lines.length} lines</span>
      </div>
      <pre className="px-3 py-2 bg-surface-secondary text-text-primary text-xs font-mono overflow-x-auto leading-relaxed">
        <code>{displayLines.join('\n')}</code>
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs flex items-center justify-center gap-1 hover:text-text-primary transition-colors"
        >
          {expanded ? (
            <>
              <ChevronDown className="w-3 h-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              Show all {lines.length} lines
            </>
          )}
        </button>
      )}
    </div>
  );
}

function PatchWriteBlock({ patchText, resultContent }: { patchText: string; resultContent?: string }) {
  const [expanded, setExpanded] = useState(false);

  const files = useMemo(() => {
    const result: { path: string; op: string }[] = [];
    for (const line of patchText.split('\n')) {
      const addMatch = line.match(/^\*\*\* Add File:\s*(.+)/);
      if (addMatch) { result.push({ path: addMatch[1].trim(), op: 'A' }); continue; }
      const updateMatch = line.match(/^\*\*\* Update File:\s*(.+)/);
      if (updateMatch) { result.push({ path: updateMatch[1].trim(), op: 'M' }); continue; }
      const deleteMatch = line.match(/^\*\*\* Delete File:\s*(.+)/);
      if (deleteMatch) { result.push({ path: deleteMatch[1].trim(), op: 'D' }); continue; }
    }
    if (result.length === 0 && typeof resultContent === 'string') {
      for (const line of resultContent.split('\n')) {
        const m = line.match(/^([AMD])\s+(.+)/);
        if (m) result.push({ path: m[2].trim(), op: m[1] });
      }
    }
    return result;
  }, [patchText, resultContent]);

  const patchLines = patchText.split('\n');
  const isLong = patchLines.length > 20;
  const displayLines = isLong && !expanded ? patchLines.slice(0, 15) : patchLines;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <FilePen className="w-3.5 h-3.5 text-blue-400" />
        <span className="font-medium">Write</span>
        <span className="text-text-muted ml-auto">{files.length} file{files.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="px-3 py-2 space-y-0.5 text-xs font-mono border-t border-border">
        {files.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={`font-semibold ${f.op === 'A' ? 'text-green-400' : f.op === 'D' ? 'text-red-400' : 'text-yellow-400'}`}>
              {f.op}
            </span>
            <span className="text-text-secondary truncate">{basename(f.path)}</span>
          </div>
        ))}
      </div>
      {expanded && (
        <pre className="px-3 py-2 bg-surface-secondary text-text-primary text-xs font-mono overflow-x-auto leading-relaxed border-t border-border max-h-60 overflow-y-auto">
          <code>{displayLines.join('\n')}</code>
        </pre>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs flex items-center justify-center gap-1 hover:text-text-primary transition-colors border-t border-border"
      >
        {expanded ? (
          <>
            <ChevronDown className="w-3 h-3" />
            Hide patch
          </>
        ) : (
          <>
            <ChevronRight className="w-3 h-3" />
            Show patch
          </>
        )}
      </button>
    </div>
  );
}

// ── Read ─────────────────────────────────────────────

function ReadBlock({ input }: { input: Input }) {
  const filePath = String(input.file_path ?? input.filePath ?? '');
  const offset = input.offset != null ? Number(input.offset) : null;
  const limit = input.limit != null ? Number(input.limit) : null;

  let rangeLabel = '';
  if (offset != null && limit != null) {
    rangeLabel = `:${offset}–${offset + limit}`;
  } else if (offset != null) {
    rangeLabel = `:${offset}`;
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-surface text-xs text-text-secondary">
      <FileSearch className="w-3.5 h-3.5 text-emerald-500" />
      <span className="font-mono">{basename(filePath)}</span>
      {rangeLabel && <span className="text-text-muted">{rangeLabel}</span>}
    </div>
  );
}

// ── Edit / StrReplace ────────────────────────────────

/** Renders code with line numbers; clicking a line opens the file at that position. */
function DiffCodeBlock({
  content,
  filePath,
  startLine,
  variant,
}: {
  content: string;
  filePath: string;
  startLine: number;
  variant: 'removed' | 'added';
}) {
  const lines = content.split('\n');
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);
  const fileName = basename(filePath);

  const handleLineClick = (lineNum: number) => {
    openFileAtLine(filePath, fileName, lineNum);
  };

  const bg = variant === 'removed' ? 'bg-red-950/10' : 'bg-green-950/10';
  const text = variant === 'removed' ? 'text-red-300' : 'text-green-300';

  return (
    <div className={`${bg} overflow-x-auto`}>
      {lines.map((line, i) => {
        const lineNum = startLine + i;
        return (
          <div
            key={i}
            className="flex group hover:bg-white/5 min-w-0"
          >
            <button
              type="button"
              onClick={() => handleLineClick(lineNum)}
              className="shrink-0 w-10 py-1 pr-2 text-right text-[10px] font-mono text-text-muted hover:text-text-secondary cursor-pointer select-none border-r border-border/50 hover:bg-white/5"
              title={`Open ${fileName} at line ${lineNum}`}
            >
              {lineNum}
            </button>
            <pre className={`flex-1 px-3 py-1 ${text} text-xs font-mono leading-relaxed whitespace-pre`}>
              <code>{line || ' '}</code>
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function EditBlock({ input }: { input: Input }) {
  const filePath = String(input.file_path ?? input.filePath ?? '');
  const oldStr = String(input.old_string ?? input.oldString ?? '');
  const newStr = String(input.new_string ?? input.newString ?? '');
  const startLine = Number(input.start_line ?? input.startLine ?? 1);

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <FilePen className="w-3.5 h-3.5 text-amber-500" />
        <span className="font-medium font-mono">{basename(filePath)}</span>
      </div>
      <div className="divide-y divide-border">
        {oldStr && (
          <div>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-red-950/30 text-red-400 text-[10px] font-medium">
              <Minus className="w-3 h-3" />
              Removed
            </div>
            <DiffCodeBlock content={oldStr} filePath={filePath} startLine={startLine} variant="removed" />
          </div>
        )}
        {newStr && (
          <div>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-green-950/30 text-green-400 text-[10px] font-medium">
              <Plus className="w-3 h-3" />
              Added
            </div>
            <DiffCodeBlock
              content={newStr}
              filePath={filePath}
              startLine={startLine}
              variant="added"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── MultiEdit (array of edits in one file) ───────────

function MultiEditBlock({ input }: { input: Input }) {
  const filePath = String(input.file_path ?? input.filePath ?? '');
  const edits = Array.isArray(input.edits) ? input.edits as Input[] : [];

  if (edits.length === 0) {
    return <GenericToolBlock name="MultiEdit" input={input} />;
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <FilePen className="w-3.5 h-3.5 text-amber-500" />
        <span className="font-medium font-mono">{basename(filePath)}</span>
        <span className="text-text-muted ml-auto">{edits.length} edits</span>
      </div>
      <div className="divide-y divide-border">
        {edits.map((edit, i) => {
          const oldStr = String(edit.old_string ?? edit.oldString ?? '');
          const newStr = String(edit.new_string ?? edit.newString ?? '');
          const startLine = Number(edit.start_line ?? edit.startLine ?? 1);
          return (
            <div key={i} className="divide-y divide-border/50">
              {oldStr && (
                <DiffCodeBlock content={oldStr} filePath={filePath} startLine={startLine} variant="removed" />
              )}
              {newStr && (
                <DiffCodeBlock content={newStr} filePath={filePath} startLine={startLine} variant="added" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TodoWrite ────────────────────────────────────────

interface TodoItem {
  content?: string;
  status?: string;
  id?: string;
}

function TodoWriteBlock({ input }: { input: Input }) {
  const todos = Array.isArray(input.todos) ? (input.todos as TodoItem[]) : [];
  const completedCount = todos.filter((t) => t.status === 'completed').length;

  if (todos.length === 0) {
    return <GenericToolBlock name="TodoWrite" input={input} />;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <ListTodo className="w-3.5 h-3.5 text-violet-500" />
        <span className="font-medium">Tasks</span>
        <span className="text-text-muted ml-auto">
          {completedCount}/{todos.length} done
        </span>
      </div>
      <ul className="divide-y divide-border">
        {todos.map((todo, i) => (
          <li key={todo.id ?? i} className="flex items-start gap-2.5 px-3 py-2 text-sm">
            <span className="mt-0.5 shrink-0">{todoStatusIcon(todo.status)}</span>
            <span className={todo.status === 'completed' ? 'line-through text-text-muted' : 'text-text-primary'}>
              {todo.content ?? '(untitled)'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function todoStatusIcon(status?: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'in_progress':
      return <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />;
    case 'cancelled':
      return <Circle className="w-4 h-4 text-text-muted line-through" />;
    default:
      return <Circle className="w-4 h-4 text-text-muted" />;
  }
}

// ── AskUserQuestion ──────────────────────────────────

interface QuestionDef {
  question?: string;
  header?: string;
  options?: Array<{ label?: string; description?: string }>;
  multiSelect?: boolean;
}

/** Parse persisted answer into selections map. Answer format: "header: pick1, pick2\n..." */
function parseAnswerToSelections(
  answerText: string,
  questions: QuestionDef[],
): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  const lines = answerText.split('\n').filter(Boolean);
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const header = q.header || q.question || `Question ${qi + 1}`;
    const line = lines.find((l) => l.startsWith(header + ':'));
    if (!line) continue;
    const picksStr = line.slice(header.length + 1).trim().split(',').map((s) => s.trim());
    const picks = new Set(picksStr);
    const selected = new Set<number>();
    for (let oi = 0; oi < (q.options?.length ?? 0); oi++) {
      const label = q.options?.[oi]?.label ?? '';
      if (picks.has(label)) selected.add(oi);
    }
    if (selected.size > 0) result.set(qi, selected);
  }
  return result;
}

function AskQuestionBlock({ input, toolUseId }: { input: Input; toolUseId?: string }) {
  const { sendUserAnswer, sendPrompt } = useThreadActions();
  const messages = useThreadsStore((s) => s.messages);
  const questions = Array.isArray(input.questions)
    ? (input.questions as QuestionDef[])
    : [];

  const hasFreeText = questions.some((q) => !q.options || q.options.length === 0);

  const persistedAnswer = useMemo(() => {
    if (!toolUseId) return null;
    for (const m of messages) {
      if (m.role !== 'user') continue;
      const block = m.content.find(
        (b: any) => b.type === 'tool_result' && b.tool_use_id === toolUseId,
      );
      if (block?.content) {
        const c = block.content;
        return typeof c === 'string' ? c : JSON.stringify(c);
      }
    }
    return null;
  }, [messages, toolUseId]);

  const [selections, setSelections] = useState<Map<number, Set<number>>>(() => new Map());
  const [freeTextValues, setFreeTextValues] = useState<Map<number, string>>(() => new Map());
  const [submitted, setSubmitted] = useState(false);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (persistedAnswer && questions.length > 0 && !restoredRef.current) {
      restoredRef.current = true;
      if (hasFreeText) {
        const restored = new Map<number, string>();
        const lines = persistedAnswer.split('\n').filter(Boolean);
        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi];
          if (q.options && q.options.length > 0) continue;
          const header = q.header || q.question || `Question ${qi + 1}`;
          const line = lines.find((l) => l.startsWith(header + ':'));
          if (line) restored.set(qi, line.slice(header.length + 1).trim());
        }
        setFreeTextValues(restored);
      }
      setSelections(parseAnswerToSelections(persistedAnswer, questions));
      setSubmitted(true);
    }
  }, [persistedAnswer, questions, hasFreeText]);

  const toggleOption = useCallback(
    (qi: number, oi: number, multiSelect: boolean) => {
      if (submitted) return;
      setSelections((prev) => {
        const next = new Map(prev);
        const selected = new Set(next.get(qi));
        if (multiSelect) {
          if (selected.has(oi)) selected.delete(oi);
          else selected.add(oi);
        } else {
          if (selected.has(oi)) selected.clear();
          else { selected.clear(); selected.add(oi); }
        }
        next.set(qi, selected);
        return next;
      });
    },
    [submitted],
  );

  const setFreeText = useCallback(
    (qi: number, value: string) => {
      if (submitted) return;
      setFreeTextValues((prev) => {
        const next = new Map(prev);
        next.set(qi, value);
        return next;
      });
    },
    [submitted],
  );

  const totalSelected = Array.from(selections.values()).reduce(
    (sum, s) => sum + s.size, 0,
  );
  const totalFreeText = Array.from(freeTextValues.values()).filter((v) => v.trim().length > 0).length;
  const canSubmit = totalSelected > 0 || totalFreeText > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const lines: string[] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const header = q.header || q.question || `Question ${qi + 1}`;
      if (q.options && q.options.length > 0) {
        const sel = selections.get(qi);
        if (!sel || sel.size === 0) continue;
        const picks = Array.from(sel)
          .sort()
          .map((oi) => q.options?.[oi]?.label ?? `Option ${oi + 1}`);
        lines.push(`${header}: ${picks.join(', ')}`);
      } else {
        const text = freeTextValues.get(qi)?.trim();
        if (text) lines.push(`${header}: ${text}`);
      }
    }
    const message = lines.join('\n');
    setSubmitted(true);
    if (toolUseId) {
      sendUserAnswer(toolUseId, message);
    } else {
      sendPrompt(message);
    }
  };

  if (questions.length === 0) {
    return <GenericToolBlock name="AskUserQuestion" input={input} />;
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="px-2.5 py-1.5 space-y-2.5">
        {questions.map((q, qi) => {
          const sel = selections.get(qi) ?? new Set<number>();
          const isFreeText = !q.options || q.options.length === 0;
          return (
            <div key={qi}>
              {q.header && (
                <p className="text-xs font-bold text-text-primary mb-1">{q.header}</p>
              )}
              {q.question && !q.header && (
                <p className="text-xs text-text-primary mb-1">{q.question}</p>
              )}
              {isFreeText ? (
                <input
                  type="text"
                  value={freeTextValues.get(qi) ?? ''}
                  onChange={(e) => setFreeText(qi, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && canSubmit) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  disabled={submitted}
                  placeholder="Type your answer..."
                  className={cn(
                    'w-full rounded border px-2 py-1 text-xs bg-surface text-text-primary placeholder:text-text-muted outline-none transition-colors',
                    submitted
                      ? 'border-border opacity-70 cursor-default'
                      : 'border-border focus:border-primary',
                  )}
                />
              ) : (
                <ul className="space-y-1">
                  {q.options!.map((opt, oi) => {
                    const isSelected = sel.has(oi);
                    return (
                      <li
                        key={oi}
                        onClick={() => toggleOption(qi, oi, !!q.multiSelect)}
                        className={[
                          'flex items-start gap-1.5 rounded border px-2 py-1 text-xs transition-colors',
                          submitted
                            ? isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-border opacity-50'
                            : isSelected
                              ? 'border-primary bg-primary/5 cursor-pointer'
                              : 'border-border cursor-pointer hover:border-primary/50 hover:bg-primary/5',
                        ].join(' ')}
                      >
                        <span className="mt-px shrink-0">
                          {q.multiSelect ? (
                            <div
                              className={[
                                'w-3.5 h-3.5 rounded-sm flex items-center justify-center border transition-colors',
                                isSelected
                                  ? 'bg-primary border-primary'
                                  : 'border-text-muted',
                              ].join(' ')}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                          ) : (
                            <div
                              className={[
                                'w-4 h-4 rounded flex items-center justify-center text-[10px] font-semibold leading-none transition-colors',
                                isSelected
                                  ? 'bg-primary text-white'
                                  : 'bg-surface-secondary text-text-secondary border border-border',
                              ].join(' ')}
                            >
                              {String.fromCharCode(65 + oi)}
                            </div>
                          )}
                        </span>
                        <div className="min-w-0">
                          <span className="text-text-primary">{opt.label}</span>
                          {opt.description && (
                            <span className="text-text-muted ml-1">{opt.description}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {!submitted ? (
        <div className="px-2.5 py-1.5 border-t border-border">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 px-3 py-1 bg-primary text-white rounded text-xs font-medium hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            Continue
          </button>
        </div>
      ) : (
        <div className="px-2.5 py-1 border-t border-border flex items-center gap-1 text-xs text-green-500">
          <Check className="w-3 h-3" /> Sent
        </div>
      )}
    </div>
  );
}

// ── WebFetch ─────────────────────────────────────────

function WebFetchBlock({ input }: { input: Input }) {
  const url = String(input.url ?? '');
  const prompt = input.prompt ? String(input.prompt) : null;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <Globe className="w-3.5 h-3.5 text-cyan-500" />
        <span className="font-medium">WebFetch</span>
      </div>
      <div className="divide-y divide-border bg-surface-secondary">
        <div className="px-3 py-2">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">URL</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-primary hover:underline break-all"
          >
            {url}
          </a>
        </div>
        {prompt && (
          <div className="px-3 py-2">
            <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Prompt</p>
            <p className="text-xs text-text-primary leading-relaxed">{prompt}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── WebSearch ────────────────────────────────────────

function WebSearchBlock({ input }: { input: Input }) {
  const term = String(input.search_term ?? input.searchTerm ?? '');

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-surface text-xs text-text-secondary">
      <Globe className="w-3.5 h-3.5 text-cyan-500" />
      <span>Searching:</span>
      <span className="font-medium text-text-primary">{term}</span>
    </div>
  );
}

// ── Glob / Grep ──────────────────────────────────────

const TRANSIENT_TOOL_VISIBLE_MS = 5_000;

function SearchBlock({ name, input }: { name: string; input: Input }) {
  const pattern = String(input.pattern ?? input.glob_pattern ?? '');
  const path = input.path ? String(input.path) : null;
  const include = input.include ? String(input.include) : null;

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-surface text-xs text-text-secondary flex-wrap">
      <Search className="w-3.5 h-3.5 text-orange-500" />
      <span>{name}:</span>
      <code className="font-mono text-text-primary bg-white/5 px-1.5 py-0.5 rounded">
        {pattern}
      </code>
      {(path || include) && (
        <span className="text-text-muted">
          in {path || include}
        </span>
      )}
    </div>
  );
}

export function TransientSearchBlock({
  block,
  receivedAt,
}: {
  block: ContentBlock;
  receivedAt: number;
}) {
  const [visible, setVisible] = useState(true);
  const input = (block.input ?? {}) as Input;

  useEffect(() => {
    const elapsed = Date.now() - receivedAt;
    const remaining = Math.max(0, TRANSIENT_TOOL_VISIBLE_MS - elapsed);
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [receivedAt]);

  if (!visible) return null;
  return <SearchBlock name={block.name ?? 'Tool'} input={input} />;
}

// ── Generic fallback ─────────────────────────────────

function GenericToolBlock({
  name,
  input,
}: {
  name?: string;
  input: Input;
}) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(input, null, 2);

  return (
    <div className={cn(
      "border border-border rounded-lg overflow-hidden bg-surface text-sm transition-opacity",
      !expanded && "opacity-50",
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-secondary transition-colors"
      >
        <Wrench className="w-3.5 h-3.5" />
        <span>{name ?? 'Tool'}</span>
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </span>
      </button>
      {expanded && (
        <pre className="px-3 py-2 text-xs text-text-muted overflow-x-auto border-t border-border">
          {json}
        </pre>
      )}
    </div>
  );
}
