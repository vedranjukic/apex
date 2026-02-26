import { useMemo } from 'react';
import { User, Bot, Terminal, Info, Clock } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ContentBlock } from '../../api/client';
import { ToolUseBlock, BashGroupBlock, TransientSearchBlock, type BashItem } from './tool-use-block';
import { PlanBlock } from './plan-block';
import { MarkdownBlock } from './markdown-block';
import { usePlanStore, extractTitle, generateFilename, BUILD_PROMPT_PREFIX } from '../../stores/plan-store';
import { useChatsStore } from '../../stores/tasks-store';

// ── Types for grouped rendering ─────────────────────

export type MessageGroup =
  | { type: 'user'; message: Message }
  | { type: 'agent'; messages: Message[]; thinkingSec: number | null }
  | { type: 'result'; message: Message }
  | { type: 'system'; message: Message };

/** Group a flat list of messages into user / agent / result / system groups */
export function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'user') {
      groups.push({ type: 'user', message: msg });
      i++;
    } else if (msg.role === 'assistant') {
      // Collect consecutive assistant messages
      const agentMsgs: Message[] = [];
      while (i < messages.length && messages[i].role === 'assistant') {
        agentMsgs.push(messages[i]);
        i++;
      }

      // Calculate thinking time: diff between previous message and first agent msg
      let thinkingSec: number | null = null;
      const prevGroup = groups[groups.length - 1];
      if (prevGroup) {
        const prevTime =
          prevGroup.type === 'user'
            ? new Date(prevGroup.message.createdAt).getTime()
            : prevGroup.type === 'agent' && prevGroup.messages.length > 0
              ? new Date(
                  prevGroup.messages[prevGroup.messages.length - 1].createdAt,
                ).getTime()
              : null;

        if (prevTime) {
          const firstAgentTime = new Date(agentMsgs[0].createdAt).getTime();
          const diffSec = (firstAgentTime - prevTime) / 1000;
          if (diffSec >= 1) {
            thinkingSec = Math.round(diffSec);
          }
        }
      }

      groups.push({ type: 'agent', messages: agentMsgs, thinkingSec });
    } else if (
      msg.role === 'system' &&
      msg.content.length === 0 &&
      msg.metadata
    ) {
      // Metadata-only system message (result summary)
      groups.push({ type: 'result', message: msg });
      i++;
    } else {
      // System message with content (errors, etc.)
      groups.push({ type: 'system', message: msg });
      i++;
    }
  }

  return groups;
}

// ── Group renderers ─────────────────────────────────

export function MessageGroupView({ group }: { group: MessageGroup }) {
  switch (group.type) {
    case 'user':
      return <UserBubble message={group.message} />;
    case 'agent':
      return (
        <AgentGroup
          messages={group.messages}
          thinkingSec={group.thinkingSec}
        />
      );
    case 'result':
      return <ResultSummary message={group.message} />;
    case 'system':
      return <SystemBubble message={group.message} />;
  }
}

// ── User bubble ─────────────────────────────────────

function isBuildPrompt(message: Message): boolean {
  const firstText = message.content.find((b) => b.type === 'text')?.text;
  return !!firstText && firstText.startsWith(BUILD_PROMPT_PREFIX);
}

/** User message that is only tool_result (AskUserQuestion answer) - shown in the question block */
function isToolResultOnly(message: Message): boolean {
  if (message.role !== 'user' || message.content.length !== 1) return false;
  const b = message.content[0] as { type?: string };
  return b.type === 'tool_result';
}

function UserBubble({ message }: { message: Message }) {
  if (isBuildPrompt(message)) return null;
  if (isToolResultOnly(message)) return null;

  return (
    <div className="flex gap-3 px-4 py-3 bg-surface-chat">
      <div className="shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">You</span>
          <span className="text-xs text-text-muted">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
        {message.content.map((block, i) => (
          <ContentBlockView key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

// ── Agent group (consecutive assistant messages merged) ──

const DEDUP_TOOLS = new Set(['TodoWrite', 'AskUserQuestion', 'mcp__terminal-server__ask_user']);

/** Tools that are transient: only shown live, hide after 5s, not rendered on refresh */
const TRANSIENT_TOOLS = new Set(['Bash', 'Glob', 'Grep']);

type RenderItem =
  | { kind: 'block'; block: ContentBlock }
  | { kind: 'bash_group'; items: BashItem[]; receivedAt: number; hideAfter: number | null }
  | { kind: 'transient_tool'; block: ContentBlock; receivedAt: number };

/** Message with optional client-side received timestamp (socket only) */
type MessageWithReceived = Message & { _receivedAt?: number };

/**
 * Get createdAt (ms) of the first message after the one(s) containing the given block ids.
 * Returns null if Bash is in the last message (no next message yet).
 */
function getNextMessageTime(
  messages: Message[],
  blockIds: Set<string>,
): number | null {
  let lastIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    for (const b of messages[i].content) {
      const block = b as { id?: string; tool_use_id?: string };
      const id = block.id ?? block.tool_use_id;
      if (id && blockIds.has(id)) lastIdx = i;
    }
  }
  if (lastIdx < 0 || lastIdx >= messages.length - 1) return null;
  const next = messages[lastIdx + 1];
  return new Date(next.createdAt).getTime();
}

/**
 * Group consecutive Bash tool_use + tool_result pairs into a single panel.
 * Only includes Bash from messages that have _receivedAt (live from socket).
 * Excludes Bash from historical messages (API load / refresh).
 * hideAfter: when to hide (next message time + 5s), or null if no next message yet.
 */
function groupConsecutiveBash(
  blocks: ContentBlock[],
  blockReceivedAt: Map<string, number>,
  messages: Message[],
): RenderItem[] {
  const resultByToolUseId = new Map<string, ContentBlock>();
  const toolUseById = new Map<string, ContentBlock>();
  for (const b of blocks) {
    if (b.type === 'tool_result' && b.tool_use_id) {
      resultByToolUseId.set(b.tool_use_id, b);
    }
    if (b.type === 'tool_use' && b.id) {
      toolUseById.set(b.id, b);
    }
  }

  const BASH_HIDE_DELAY_MS = 5_000;
  const out: RenderItem[] = [];
  let bashGroup: BashItem[] = [];
  let bashGroupReceivedAt = 0;
  const consumedResultIds = new Set<string>();

  const flushBashGroup = () => {
    if (bashGroup.length > 0) {
      const ids = new Set(bashGroup.flatMap((i) => [i.toolUse.id].filter(Boolean) as string[]));
      const nextTime = getNextMessageTime(messages, ids);
      const hideAfter = nextTime ? nextTime + BASH_HIDE_DELAY_MS : null;
      out.push({ kind: 'bash_group', items: bashGroup, receivedAt: bashGroupReceivedAt, hideAfter });
      bashGroup = [];
      bashGroupReceivedAt = 0;
    }
  };

  for (const block of blocks) {
    if (block.type === 'tool_use' && TRANSIENT_TOOLS.has(block.name ?? '') && block.id) {
      if (block.name !== 'Bash') {
        const receivedAt = blockReceivedAt.get(block.id);
        if (receivedAt == null) continue;
        out.push({ kind: 'transient_tool', block, receivedAt });
        continue;
      }
    }
    if (block.type === 'tool_use' && block.name === 'Bash' && block.id) {
      const receivedAt = blockReceivedAt.get(block.id);
      if (receivedAt == null) continue; // Skip Bash from historical messages
      const toolResult = resultByToolUseId.get(block.id);
      if (toolResult) consumedResultIds.add(block.id);
      bashGroup.push({ toolUse: block, toolResult });
      bashGroupReceivedAt = Math.max(bashGroupReceivedAt, receivedAt);
      continue;
    }
    if (block.type === 'tool_result' && block.tool_use_id) {
      if (consumedResultIds.has(block.tool_use_id)) continue;
      const toolUse = toolUseById.get(block.tool_use_id);
      if (toolUse?.name === 'Bash') {
        const receivedAt = blockReceivedAt.get(block.tool_use_id);
        if (receivedAt == null) continue; // Skip Bash result from historical
        consumedResultIds.add(block.tool_use_id);
        const ids = new Set([block.tool_use_id]);
        const nextTime = getNextMessageTime(messages, ids);
        const hideAfter = nextTime ? nextTime + BASH_HIDE_DELAY_MS : null;
        out.push({ kind: 'bash_group', items: [{ toolUse, toolResult: block }], receivedAt, hideAfter });
        continue;
      }
    }

    flushBashGroup();
    out.push({ kind: 'block', block });
  }

  flushBashGroup();
  return out;
}

/**
 * Deduplicate tool_use blocks whose tool emits repeated full-state updates
 * (e.g. TodoWrite). For each such tool name, only the *last* occurrence is
 * kept and it is rendered at the position of the *first* occurrence so the
 * card appears once, in-place, with the latest state.
 */
function deduplicateBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const lastByName = new Map<string, ContentBlock>();
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.name && DEDUP_TOOLS.has(b.name)) {
      lastByName.set(b.name, b);
    }
  }
  if (lastByName.size === 0) return blocks;

  const seen = new Set<string>();
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.name && DEDUP_TOOLS.has(b.name)) {
      if (!seen.has(b.name)) {
        seen.add(b.name);
        out.push(lastByName.get(b.name)!);
      }
    } else {
      out.push(b);
    }
  }
  return out;
}

interface DerivedPlan {
  filename: string;
  content: string;
  isComplete: boolean;
}

const HEADING_RE = /^#{1,3}\s+/m;
/** Plan-like section headers (match at line start; content may follow on same line) */
const PLAN_INDICATORS = [
  /(?:^|\n)\s*Plan\s*:/i,
  /(?:^|\n)\s*Implementation\s+plan\s*:?/i,
  /(?:^|\n)\s*File\s+structure\s*:?/i,
  /(?:^|\n)\s*Structure\s*:?/i,
  /(?:^|\n)\s*Stack\s*:?/i,
  /(?:^|\n)\s*Styling\s*:?/i,
  /(?:^|\n)\s*Storage\s*:?/i,
  /(?:^|\n)\s*Features\s*:?/i,
  /(?:^|\n)\s*Details\s*:?/i,
  /(?:^|\n)\s*Here'?s\s+the\s+plan\b/i,
  /(?:^|\n)\s*Here'?s\s+my\s+plan\b/i,
  /(?:^|\n)\s*Here'?s\s+what\s+I'?ll\s+build\b/i,
  /\bShall\s+I\s+proceed\b/i,
];
const MIN_PLAN_LENGTH = 150;

/** True if text has plan-like structure (heading or plan section) */
function hasPlanStructure(text: string): boolean {
  if (HEADING_RE.test(text)) return true;
  if (PLAN_INDICATORS.some((r) => r.test(text))) return true;
  // Fallback: "Stack:" or "Features:" or "Shall I proceed" with substantial content
  if (text.length >= MIN_PLAN_LENGTH) {
    if (/\b(?:Stack|Features|Plan)\s*:\s*/i.test(text)) return true;
    if (/\bShall\s+I\s+proceed\b/i.test(text)) return true;
  }
  return false;
}

/** Find start of plan body: first heading or plan section */
function findPlanStart(text: string): number {
  let idx = text.search(HEADING_RE);
  for (const r of PLAN_INDICATORS) {
    const m = text.match(r);
    if (m && m.index !== undefined) {
      const i = m.index;
      idx = idx >= 0 ? Math.min(idx, i) : i;
    }
  }
  if (idx < 0) {
    const fallbacks = [
      /\bHere'?s\s+what\s+I'?ll\s+build\b/i,
      /\bPlan\s*:\s*/i,
      /\bStack\s*:\s*/i,
      /\bFeatures\s*:\s*/i,
    ];
    for (const r of fallbacks) {
      const m = text.match(r);
      if (m && m.index !== undefined) {
        idx = idx >= 0 ? Math.min(idx, m.index) : m.index;
      }
    }
  }
  return idx;
}

function AgentGroup({
  messages,
  thinkingSec,
}: {
  messages: Message[];
  thinkingSec: number | null;
}) {
  const chatId = messages[0]?.taskId;
  const storePlan = usePlanStore((s) => chatId ? s.getPlanByChatId(chatId) : undefined);
  const chat = useChatsStore(
    (s) => chatId ? s.chats.find((c) => c.id === chatId) : undefined,
  );
  const chatStatus = chat?.status;
  const isPlanModeChat = chat?.mode === 'plan' || !!storePlan;
  const buildPromptTime = useChatsStore((s) => {
    const msg = s.messages.find(
      (m) => m.role === 'user' && m.content.some(
        (b) => b.type === 'text' && b.text?.startsWith(BUILD_PROMPT_PREFIX),
      ),
    );
    return msg ? new Date(msg.createdAt).getTime() : null;
  });
  const wasBuilt = buildPromptTime !== null;

  const groupTime = new Date(messages[0]?.createdAt ?? 0).getTime();
  const isAfterBuild = wasBuilt && groupTime >= buildPromptTime;

  const { allBlocks, blockReceivedAt } = useMemo(() => {
    const blockReceivedAt = new Map<string, number>();
    const raw: ContentBlock[] = [];
    const toolUseById = new Map<string, ContentBlock>();
    const excludedBashIds = new Set<string>();

    const excludedTransientIds = new Set<string>();
    for (const m of messages) {
      const receivedAt = (m as MessageWithReceived)._receivedAt;
      for (const b of m.content) {
        if (b.type === 'tool_use' && b.id && TRANSIENT_TOOLS.has(b.name ?? '')) {
          toolUseById.set(b.id, b);
          if (receivedAt == null) excludedTransientIds.add(b.id);
          else blockReceivedAt.set(b.id, receivedAt);
        } else if (b.type === 'tool_use' && b.id) {
          toolUseById.set(b.id, b);
        }
      }
    }
    for (const m of messages) {
      const receivedAt = (m as MessageWithReceived)._receivedAt;
      for (const b of m.content) {
        if (b.type === 'tool_result' && b.tool_use_id) {
          const toolUse = toolUseById.get(b.tool_use_id);
          if (toolUse && TRANSIENT_TOOLS.has(toolUse.name ?? '')) {
            if (excludedTransientIds.has(b.tool_use_id)) continue;
            if (receivedAt != null) blockReceivedAt.set(b.tool_use_id, Math.max(blockReceivedAt.get(b.tool_use_id) ?? 0, receivedAt));
          }
        }
      }
    }

    for (const m of messages) {
      const receivedAt = (m as MessageWithReceived)._receivedAt;
      for (const b of m.content) {
        if (b.type === 'tool_use' && TRANSIENT_TOOLS.has(b.name ?? '') && excludedTransientIds.has(b.id!)) continue;
        if (b.type === 'tool_result' && b.tool_use_id) {
          const toolUse = toolUseById.get(b.tool_use_id);
          if (toolUse?.name === 'Bash' && excludedTransientIds.has(b.tool_use_id)) continue;
          if (toolUse && (toolUse.name === 'Glob' || toolUse.name === 'Grep')) continue; // Never render Glob/Grep results
        }
        raw.push(b);
      }
    }

    return {
      allBlocks: deduplicateBlocks(raw),
      blockReceivedAt,
    };
  }, [messages]);

  const derivedPlan = useMemo((): DerivedPlan | null => {
    if (isAfterBuild) return null;

    if (storePlan) {
      return {
        filename: storePlan.filename,
        content: storePlan.content,
        isComplete: storePlan.isComplete,
      };
    }

    const textBlocks = allBlocks
      .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && !!b.text);
    if (textBlocks.length === 0) return null;

    const fullText = textBlocks.map((b) => b.text).join('\n\n');
    if (fullText.length < MIN_PLAN_LENGTH) return null;

    // Plan mode: require plan structure. Agent mode: also detect "Plan:" section
    const hasStructure = hasPlanStructure(fullText);
    if (!hasStructure && !isPlanModeChat) return null;
    if (!hasStructure) return null;

    const planStartIdx = findPlanStart(fullText);
    const planBody = planStartIdx >= 0 ? fullText.slice(planStartIdx) : fullText;
    const title = extractTitle(planBody);
    const ts = new Date(messages[0].createdAt)
      .toISOString().replace(/[-:]/g, '').slice(0, 13);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

    return {
      filename: `${slug}_${ts}.md`,
      content: planBody,
      isComplete: true,
    };
  }, [storePlan, allBlocks, messages, isPlanModeChat]);

  const planBlocks = useMemo(() => {
    if (!derivedPlan) return null;

    type PlanItem =
      | { kind: 'block'; block: ContentBlock }
      | { kind: 'plan' };

    const hasPlanMarker = allBlocks.some(
      (b) => b.type === 'text' && b.text && hasPlanStructure(b.text),
    );

    const items: PlanItem[] = [];
    let planInserted = false;

    for (const block of allBlocks) {
      if (block.type !== 'text') {
        items.push({ kind: 'block', block });
        continue;
      }
      if (planInserted) continue;

      if (hasPlanMarker) {
        const text = block.text ?? '';
        const planStartIdx = findPlanStart(text);
        if (planStartIdx < 0) {
          items.push({ kind: 'block', block });
        } else {
          const preamble = text.slice(0, planStartIdx).trim();
          if (preamble) {
            items.push({ kind: 'block', block: { ...block, text: preamble } });
          }
          items.push({ kind: 'plan' });
          planInserted = true;
        }
      }
    }

    if (!planInserted) {
      items.push({ kind: 'plan' });
    }

    return items;
  }, [derivedPlan, allBlocks]);

  return (
    <div className="bg-surface-chat/60">
      {/* Thinking indicator */}
      {thinkingSec != null && (
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs text-text-muted">
          <Clock className="w-3 h-3" />
          <span>Thought for {thinkingSec}s</span>
        </div>
      )}

      <div className="flex gap-3 px-4 py-3">
        <div className="shrink-0 mt-0.5">
          <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-accent" />
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {planBlocks && derivedPlan ? (
            planBlocks.map((item, i) =>
              item.kind === 'plan'
                ? <PlanBlock
                    key={`plan-${i}`}
                    filename={derivedPlan.filename}
                    content={derivedPlan.content}
                    isComplete={derivedPlan.isComplete}
                    wasBuilt={wasBuilt}
                    chatStatus={chatStatus}
                  />
                : <ContentBlockView key={i} block={item.block} />
            )
          ) : (
            groupConsecutiveBash(allBlocks, blockReceivedAt, messages).map((item, i) =>
              item.kind === 'bash_group'
                ? <BashGroupBlock key={i} items={item.items} hideAfter={item.hideAfter} />
                : item.kind === 'transient_tool'
                  ? <TransientSearchBlock key={i} block={item.block} receivedAt={item.receivedAt} />
                  : <ContentBlockView key={i} block={item.block} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Result summary (metadata row) ───────────────────

function ResultSummary({ message }: { message: Message }) {
  const meta = message.metadata;
  if (!meta) return null;

  return (
    <div className="flex items-center justify-center gap-4 px-4 py-2 text-xs text-text-muted bg-surface-chat/40">
      {meta.costUsd != null && (
        <span>Cost: ${Number(meta.costUsd).toFixed(4)}</span>
      )}
      {meta.durationMs != null && (
        <span>
          Duration: {(Number(meta.durationMs) / 1000).toFixed(1)}s
        </span>
      )}
      {meta.numTurns != null && (
        <span>
          {String(meta.numTurns)} turn{Number(meta.numTurns) !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

// ── System bubble (errors, info) ────────────────────

function SystemBubble({ message }: { message: Message }) {
  return (
    <div className="flex gap-3 px-4 py-3 bg-surface-chat/60">
      <div className="shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center">
          <Info className="w-4 h-4 text-text-muted" />
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.content.map((block, i) => (
          <ContentBlockView key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

// ── Content block renderer ──────────────────────────

const MIN_MARKDOWN_LEN = 200;

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === 'text' && block.text) {
    if (block.text.length >= MIN_MARKDOWN_LEN && HEADING_RE.test(block.text)) {
      const title = extractTitle(block.text);
      return <MarkdownBlock title={title} content={block.text} />;
    }
    return (
      <div className="text-sm leading-relaxed">
        <article className="plan-markdown inline-markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {block.text}
          </Markdown>
        </article>
      </div>
    );
  }

  if (block.type === 'tool_use') {
    return <ToolUseBlock block={block} />;
  }

  if (block.type === 'tool_result') {
    return (
      <div className="border border-border rounded-lg p-3 bg-surface text-sm">
        <div className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-1">
          <Terminal className="w-3.5 h-3.5" />
          Tool Result
        </div>
        {block.content && (
          <pre className="text-xs text-text-muted overflow-x-auto mt-1 max-h-40 overflow-y-auto">
            {block.content}
          </pre>
        )}
      </div>
    );
  }

  return null;
}
