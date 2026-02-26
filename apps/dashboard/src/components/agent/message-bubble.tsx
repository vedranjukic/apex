import { useMemo } from 'react';
import { User, Bot, Terminal, Info, Clock } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ContentBlock } from '../../api/client';
import { ToolUseBlock } from './tool-use-block';
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

function UserBubble({ message }: { message: Message }) {
  if (isBuildPrompt(message)) return null;

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

const DEDUP_TOOLS = new Set(['TodoWrite', 'AskUserQuestion']);

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

  const allBlocks = useMemo(() => {
    const raw = messages.flatMap((m) => m.content);
    return deduplicateBlocks(raw);
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

    if (!isPlanModeChat) return null;

    const textBlocks = allBlocks
      .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && !!b.text);
    if (textBlocks.length === 0) return null;

    const fullText = textBlocks.map((b) => b.text).join('\n\n');
    const headingIdx = fullText.search(HEADING_RE);
    const planBody = headingIdx >= 0 ? fullText.slice(headingIdx) : fullText;
    const title = extractTitle(planBody);
    const ts = new Date(messages[0].createdAt)
      .toISOString().replace(/[-:]/g, '').slice(0, 13);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

    return {
      filename: `${slug}_${ts}.md`,
      content: planBody,
      isComplete: true,
    };
  }, [storePlan, allBlocks, messages]);

  const planBlocks = useMemo(() => {
    if (!derivedPlan) return null;

    type PlanItem =
      | { kind: 'block'; block: ContentBlock }
      | { kind: 'plan' };

    const hasHeading = allBlocks.some(
      (b) => b.type === 'text' && b.text && HEADING_RE.test(b.text),
    );

    const items: PlanItem[] = [];
    let planInserted = false;

    for (const block of allBlocks) {
      if (block.type !== 'text') {
        items.push({ kind: 'block', block });
        continue;
      }
      if (planInserted) continue;

      if (hasHeading) {
        const text = block.text ?? '';
        const headingIdx = text.search(HEADING_RE);
        if (headingIdx < 0) {
          items.push({ kind: 'block', block });
        } else {
          const preamble = text.slice(0, headingIdx).trim();
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
            allBlocks.map((block, i) => (
              <ContentBlockView key={i} block={block} />
            ))
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
