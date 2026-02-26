import { useState, useCallback, useEffect } from 'react';
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
import { useChatActions } from './chat-actions-context';

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

export function ToolUseBlock({ block }: { block: ContentBlock }) {
  const name = block.name ?? '';
  if (HIDDEN_TOOLS.has(name) || name.startsWith('mcp__')) return null;

  const input = (block.input ?? {}) as Input;
  switch (block.name) {
    case 'Task':
      return <TaskBlock input={input} />;
    case 'Bash':
      return <BashBlock input={input} />;
    case 'Write':
      return <WriteBlock input={input} />;
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
      return <AskQuestionBlock input={input} toolUseId={block.id} />;
    case 'WebSearch':
      return <WebSearchBlock input={input} />;
    case 'Glob':
    case 'Grep':
      return <SearchBlock name={block.name!} input={input} />;
    default:
      return <GenericToolBlock name={block.name} input={input} />;
  }
}

// ── Bash ─────────────────────────────────────────────

function BashBlock({ input }: { input: Input }) {
  const command = String(input.command ?? '');
  const description = input.description ? String(input.description) : null;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <TerminalSquare className="w-3.5 h-3.5" />
        <span className="font-medium">Bash</span>
        {description && (
          <>
            <span className="text-text-muted">—</span>
            <span className="text-text-muted truncate">{description}</span>
          </>
        )}
      </div>
      <pre className="px-3 py-2.5 bg-surface-secondary text-text-primary text-xs font-mono overflow-x-auto leading-relaxed">
        <code>{command}</code>
      </pre>
    </div>
  );
}

// ── Task (transient — fades out after 10s) ──────

const TASK_FADE_MS = 10_000;

function TaskBlock({ input }: { input: Input }) {
  const description = input.description ? String(input.description) : null;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), TASK_FADE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="text-xs text-text-muted italic transition-opacity duration-1000"
      style={{ opacity: 0.6 }}
    >
      {description}
    </div>
  );
}

// ── Write ────────────────────────────────────────────

function WriteBlock({ input }: { input: Input }) {
  const filePath = String(input.file_path ?? input.filePath ?? '');
  const content = String(input.content ?? '');
  const lines = content.split('\n');
  const isLong = lines.length > 20;
  const [expanded, setExpanded] = useState(false);

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

function EditBlock({ input }: { input: Input }) {
  const filePath = String(input.file_path ?? input.filePath ?? '');
  const oldStr = String(input.old_string ?? input.oldString ?? '');
  const newStr = String(input.new_string ?? input.newString ?? '');

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
            <pre className="px-3 py-2 bg-red-950/10 text-red-300 text-xs font-mono overflow-x-auto leading-relaxed">
              <code>{oldStr}</code>
            </pre>
          </div>
        )}
        {newStr && (
          <div>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-green-950/30 text-green-400 text-[10px] font-medium">
              <Plus className="w-3 h-3" />
              Added
            </div>
            <pre className="px-3 py-2 bg-green-950/10 text-green-300 text-xs font-mono overflow-x-auto leading-relaxed">
              <code>{newStr}</code>
            </pre>
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
          return (
            <div key={i} className="divide-y divide-border/50">
              {oldStr && (
                <pre className="px-3 py-1.5 bg-red-950/10 text-red-300 text-xs font-mono overflow-x-auto leading-relaxed">
                  <code>{oldStr}</code>
                </pre>
              )}
              {newStr && (
                <pre className="px-3 py-1.5 bg-green-950/10 text-green-300 text-xs font-mono overflow-x-auto leading-relaxed">
                  <code>{newStr}</code>
                </pre>
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

  if (todos.length === 0) {
    return <GenericToolBlock name="TodoWrite" input={input} />;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <ListTodo className="w-3.5 h-3.5 text-violet-500" />
        <span className="font-medium">Tasks</span>
        <span className="text-text-muted ml-auto">
          {todos.filter((t) => t.status === 'completed').length}/{todos.length} done
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

function AskQuestionBlock({ input, toolUseId }: { input: Input; toolUseId?: string }) {
  const { sendUserAnswer, sendPrompt } = useChatActions();
  const questions = Array.isArray(input.questions)
    ? (input.questions as QuestionDef[])
    : [];

  const [selections, setSelections] = useState<Map<number, Set<number>>>(
    () => new Map(),
  );
  const [submitted, setSubmitted] = useState(false);

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

  const totalSelected = Array.from(selections.values()).reduce(
    (sum, s) => sum + s.size, 0,
  );

  const handleSubmit = () => {
    if (totalSelected === 0) return;
    const lines: string[] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const sel = selections.get(qi);
      if (!sel || sel.size === 0) continue;
      const header = q.header || q.question || `Question ${qi + 1}`;
      const picks = Array.from(sel)
        .sort()
        .map((oi) => q.options?.[oi]?.label ?? `Option ${oi + 1}`);
      lines.push(`${header}: ${picks.join(', ')}`);
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
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <HelpCircle className="w-3.5 h-3.5 text-sky-500" />
        <span className="font-medium">Question</span>
        {submitted && (
          <span className="ml-auto text-green-500 flex items-center gap-1">
            <Check className="w-3 h-3" /> Sent
          </span>
        )}
      </div>
      <div className="px-3 py-2.5 space-y-4">
        {questions.map((q, qi) => {
          const sel = selections.get(qi) ?? new Set<number>();
          return (
            <div key={qi}>
              {q.header && (
                <p className="text-xs font-semibold text-text-secondary mb-1">{q.header}</p>
              )}
              {q.question && (
                <p className="text-sm text-text-primary mb-2">{q.question}</p>
              )}
              {q.options && (
                <ul className="space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const isSelected = sel.has(oi);
                    return (
                      <li
                        key={oi}
                        onClick={() => toggleOption(qi, oi, !!q.multiSelect)}
                        className={[
                          'flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors',
                          submitted
                            ? isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-border opacity-50'
                            : isSelected
                              ? 'border-primary bg-primary/5 cursor-pointer'
                              : 'border-border cursor-pointer hover:border-primary/50 hover:bg-primary/5',
                        ].join(' ')}
                      >
                        <span className="mt-0.5 shrink-0">
                          {q.multiSelect ? (
                            <div
                              className={[
                                'w-4 h-4 rounded flex items-center justify-center border transition-colors',
                                isSelected
                                  ? 'bg-primary border-primary'
                                  : 'border-text-muted',
                              ].join(' ')}
                            >
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                          ) : (
                            <div
                              className={[
                                'w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors',
                                isSelected
                                  ? 'border-primary'
                                  : 'border-text-muted',
                              ].join(' ')}
                            >
                              {isSelected && (
                                <div className="w-2 h-2 rounded-full bg-primary" />
                              )}
                            </div>
                          )}
                        </span>
                        <div>
                          <span className="text-text-primary">{opt.label}</span>
                          {opt.description && (
                            <p className="text-xs text-text-muted mt-0.5">{opt.description}</p>
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
      {!submitted && (
        <div className="px-3 py-2.5 border-t border-border bg-surface-secondary">
          <button
            onClick={handleSubmit}
            disabled={totalSelected === 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            Continue
          </button>
        </div>
      )}
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
  const isLong = json.split('\n').length > 8;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-secondary transition-colors"
      >
        <Wrench className="w-3.5 h-3.5" />
        <span>{name ?? 'Tool'}</span>
        {isLong && (
          <span className="ml-auto">
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
      </button>
      {(!isLong || expanded) && (
        <pre className="px-3 py-2 text-xs text-text-muted overflow-x-auto border-t border-border">
          {json}
        </pre>
      )}
    </div>
  );
}
