import { useMemo, useState, useCallback, createContext, useContext, useRef, useEffect } from 'react';
import { User, Bot, Info, Clock, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ContentBlock } from '../../api/client';
import { ToolUseBlock, BashGroupBlock, TransientSearchBlock, normalizeTool, type BashItem } from './tool-use-block';
import { PlanBlock } from './plan-block';
import { MarkdownBlock } from './markdown-block';
import { usePlanStore, extractTitle, extractPlanBody, BUILD_PROMPT_PREFIX, PLAN_BLOCK_REGEX, PLAN_BLOCK_START } from '../../stores/plan-store';
import { useThreadsStore } from '../../stores/tasks-store';

// ── Plan deduplication (only first agent group shows the plan) ──

/**
 * Key-based plan dedup: the first agent group that calls claimPlan(key)
 * "owns" the plan. Subsequent calls with the SAME key still return true
 * (safe across memo recomputation). Calls with a DIFFERENT key return false.
 */
const PlanShownContext = createContext<(groupKey: string) => boolean>(() => true);

export function PlanShownProvider({
  threadId,
  children,
}: {
  threadId: string | null;
  children: React.ReactNode;
}) {
  const claimedByRef = useRef<string | null>(null);
  const prevThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      prevThreadIdRef.current = threadId;
      claimedByRef.current = null;
    }
  }, [threadId]);

  const claimPlan = useMemo(
    () => (groupKey: string) => {
      if (claimedByRef.current === null) {
        claimedByRef.current = groupKey;
        return true;
      }
      return claimedByRef.current === groupKey;
    },
    [],
  );
  return (
    <PlanShownContext.Provider value={claimPlan}>
      {children}
    </PlanShownContext.Provider>
  );
}

// ── Reasoning toggle (show all thinking blocks) ─────

interface ReasoningToggleValue {
  showAll: boolean;
  toggle: () => void;
}

const ReasoningToggleContext = createContext<ReasoningToggleValue>({
  showAll: false,
  toggle: () => {},
});

export function ReasoningToggleProvider({ children }: { children: React.ReactNode }) {
  const [showAll, setShowAll] = useState(false);
  const toggle = useCallback(() => setShowAll((v) => !v), []);
  const value = useMemo(() => ({ showAll, toggle }), [showAll, toggle]);
  return (
    <ReasoningToggleContext.Provider value={value}>
      {children}
    </ReasoningToggleContext.Provider>
  );
}

export function useReasoningToggle() {
  return useContext(ReasoningToggleContext);
}

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
      // Collect consecutive assistant messages plus interleaved tool_result-only user messages
      const agentMsgs: Message[] = [];
      while (i < messages.length) {
        const m = messages[i];
        if (m.role === 'assistant') {
          agentMsgs.push(m);
          i++;
        } else if (m.role === 'user' && isToolResultOnly(m)) {
          agentMsgs.push(m);
          i++;
        } else {
          break;
        }
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

export function MessageGroupView({ group, isLastGroup }: { group: MessageGroup; isLastGroup?: boolean }) {
  switch (group.type) {
    case 'user':
      return <UserBubble message={group.message} />;
    case 'agent':
      return (
        <AgentGroup
          messages={group.messages}
          thinkingSec={group.thinkingSec}
          isLastGroup={isLastGroup}
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

/** User message that only contains tool_result blocks (no user text). Includes AskUserQuestion answers and CLI tool outputs (Bash, etc.). */
function isToolResultOnly(message: Message): boolean {
  if (message.role !== 'user' || message.content.length === 0) return false;
  return message.content.every((b) => (b as { type?: string }).type === 'tool_result');
}

function UserBubble({ message }: { message: Message }) {
  if (isBuildPrompt(message)) return null;
  if (isToolResultOnly(message)) return null;

  return (
    <div className="flex gap-3 px-4 py-3 bg-surface-thread">
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
          <ContentBlockView key={i} block={block} siblings={message.content} />
        ))}
      </div>
    </div>
  );
}

// ── Agent group (consecutive assistant messages merged) ──

const DEDUP_TOOLS = new Set(['TodoWrite', 'AskUserQuestion']);

function dedupKey(name: string): string {
  return normalizeTool(name);
}

/** Tools that are transient: only shown live, not rendered on refresh (Bash is always rendered) */
const TRANSIENT_TOOLS = new Set(['Glob', 'Grep']);

type RenderItem =
  | { kind: 'block'; block: ContentBlock }
  | { kind: 'bash_group'; items: BashItem[]; receivedAt: number }
  | { kind: 'transient_tool'; block: ContentBlock; receivedAt: number };

/** Message with optional client-side received timestamp (socket only) */
type MessageWithReceived = Message & { _receivedAt?: number };

/**
 * Group consecutive Bash tool_use + tool_result pairs into a single panel.
 * Includes Bash from both live socket messages and historical (API load / refresh).
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

  const out: RenderItem[] = [];
  let bashGroup: BashItem[] = [];
  let bashGroupReceivedAt = 0;
  const consumedResultIds = new Set<string>();

  const flushBashGroup = () => {
    if (bashGroup.length > 0) {
      out.push({ kind: 'bash_group', items: bashGroup, receivedAt: bashGroupReceivedAt });
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
      const receivedAt = blockReceivedAt.get(block.id) ?? 0;
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
        const receivedAt = blockReceivedAt.get(block.tool_use_id) ?? 0;
        consumedResultIds.add(block.tool_use_id);
        out.push({ kind: 'bash_group', items: [{ toolUse, toolResult: block }], receivedAt });
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
  const bestByKey = new Map<string, ContentBlock>();
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.name) {
      const normalized = normalizeTool(b.name);
      if (!DEDUP_TOOLS.has(normalized)) continue;
      const key = dedupKey(b.name);
      bestByKey.set(key, b);
    }
  }
  if (bestByKey.size === 0) return blocks;

  const seen = new Set<string>();
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.name) {
      const normalized = normalizeTool(b.name);
      if (DEDUP_TOOLS.has(normalized)) {
        const key = dedupKey(b.name);
        if (!seen.has(key)) {
          seen.add(key);
          out.push(bestByKey.get(key)!);
        }
        continue;
      }
    }
    out.push(b);
  }
  return out;
}

interface DerivedPlan {
  filename: string;
  content: string;
  isComplete: boolean;
}

const HEADING_RE = /^#{1,3}\s+/m;

const PLAN_STRUCTURE_INDICATORS = /^#{1,3}\s+(Stack|File Structure|Project Structure|Implementation Steps|Features|Structure|Details)\b/gm;

const TASK_STRUCTURE_INDICATORS = /^#{1,3}\s+(Architecture|Breakdown|Worker|Task|Decomposition|Execution Flow|Verification|Subtask|Phase)\b/gm;

/** True if text contains ```plan ... ``` block or plan/task-like structure */
function hasPlanBlock(text: string): boolean {
  if (PLAN_BLOCK_REGEX.test(text)) return true;
  if (text.length < 150) return false;
  const planIndicators = text.match(PLAN_STRUCTURE_INDICATORS);
  if ((planIndicators?.length ?? 0) >= 2) return true;
  const taskIndicators = text.match(TASK_STRUCTURE_INDICATORS);
  if ((taskIndicators?.length ?? 0) >= 2) return true;
  return false;
}

/** Extract plan content: prefers ```plan ... ``` (handles nested blocks), fallback to structure-based */
function extractPlanFromText(text: string): string | null {
  const fromFence = extractPlanBody(text);
  if (fromFence) {
    if (import.meta.env.DEV && fromFence.includes('Project Structure')) {
      const hasTreeContent = /Project Structure[\s\S]{10,}/.test(fromFence);
      console.debug('[plan] extracted', fromFence.length, 'chars, Project Structure has content:', hasTreeContent);
    }
    return fromFence;
  }

  // Fallback: detect plan by structure (Stack, File Structure, Project Structure, etc.)
  const structureMatches = text.match(PLAN_STRUCTURE_INDICATORS);
  if ((structureMatches?.length ?? 0) < 2 || text.length < 150) return null;
  const firstHeading = text.search(/(?:^|\n)#{1,3}\s+/m);
  const start = firstHeading >= 0 ? firstHeading : 0;
  const preamble = text.slice(0, start).trim();
  const body = text.slice(start).trim();
  // Skip short preambles like "Got it. Here's the plan:"
  if (preamble && preamble.length < 80 && !preamble.includes('\n')) {
    return body;
  }
  return body || text.trim();
}


function AgentGroup({
  messages,
  thinkingSec,
  isLastGroup,
}: {
  messages: Message[];
  thinkingSec: number | null;
  isLastGroup?: boolean;
}) {
  const claimPlan = useContext(PlanShownContext);
  const groupKey = messages[0]?.id ?? '';
  const threadId = messages[0]?.taskId;
  const storePlan = usePlanStore((s) => threadId ? s.getPlanByThreadId(threadId) : undefined);
  const thread = useThreadsStore(
    (s) => threadId ? s.threads.find((c) => c.id === threadId) : undefined,
  );
  const threadStatus = thread?.status;
  const buildPromptTime = useThreadsStore((s) => {
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

    // Deduplicate tool_use blocks by id: when the bridge emits both a
    // "running" and a "completed" message for the same tool call, we keep
    // only the last occurrence (which carries the final input/state).
    const lastToolUseIdx = new Map<string, number>();
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].type === 'tool_use' && raw[i].id) {
        lastToolUseIdx.set(raw[i].id!, i);
      }
    }
    const idDeduped = lastToolUseIdx.size > 0
      ? raw.filter((b, i) =>
          !(b.type === 'tool_use' && b.id && lastToolUseIdx.get(b.id) !== i))
      : raw;

    // Deduplicate thinking blocks by content text
    const seenThinking = new Set<string>();
    const thinkingDeduped = idDeduped.filter((b) => {
      if (b.type !== 'thinking' || !b.thinking) return true;
      if (seenThinking.has(b.thinking)) return false;
      seenThinking.add(b.thinking);
      return true;
    });

    return {
      allBlocks: deduplicateBlocks(thinkingDeduped),
      blockReceivedAt,
    };
  }, [messages]);

  // Only the very last thinking block can be "live", and only when the
  // thread is running, this is the last agent group, AND no text/tool
  // output has arrived after it.
  const liveThinkingBlock = useMemo(() => {
    if (!isLastGroup || threadStatus !== 'running') return null;
    for (let i = allBlocks.length - 1; i >= 0; i--) {
      const b = allBlocks[i];
      if (b.type === 'thinking') return b;
      if (b.type === 'text' || b.type === 'tool_use') return null;
    }
    return null;
  }, [isLastGroup, threadStatus, allBlocks]);

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

    const planBody = extractPlanFromText(fullText);
    if (!planBody) return null;

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
    if (!claimPlan(groupKey)) return null; // Dedupe: only first agent group shows plan

    type PlanItem =
      | { kind: 'block'; block: ContentBlock }
      | { kind: 'plan' };

    const fullText = allBlocks
      .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && !!b.text)
      .map((b) => b.text)
      .join('\n\n');
    const hasPlanMarker = hasPlanBlock(fullText);

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
        const planStartIdx = text.indexOf(PLAN_BLOCK_START);
        if (planStartIdx >= 0) {
          const preamble = text.slice(0, planStartIdx).trim();
          if (preamble) {
            items.push({ kind: 'block', block: { ...block, text: preamble } });
          }
          items.push({ kind: 'plan' });
          planInserted = true;
        } else if (hasPlanBlock(text)) {
          // Structure-based plan: skip this block, add plan once
          items.push({ kind: 'plan' });
          planInserted = true;
        } else {
          items.push({ kind: 'block', block });
        }
      }
    }

    if (!planInserted && hasPlanMarker) {
      items.push({ kind: 'plan' });
    }

    return items;
  }, [derivedPlan, allBlocks, claimPlan, groupKey]);

  return (
    <div className="bg-surface-thread/60">
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
                    threadStatus={threadStatus}
                  />
                : <ContentBlockView key={i} block={item.block} siblings={allBlocks} isLiveThinking={item.block === liveThinkingBlock} />
            )
          ) : (
            (() => {
              const fullText = allBlocks
                .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && !!b.text)
                .map((b) => b.text)
                .join('\n\n');
              // Only render plan via fallback if this group can claim it
              const canShowPlan = claimPlan(groupKey);
              const fallbackPlanBody = canShowPlan && hasPlanBlock(fullText) ? extractPlanFromText(fullText) : null;

              let planRendered = false;
              return groupConsecutiveBash(allBlocks, blockReceivedAt, messages).map((item, i) => {
                if (item.kind === 'bash_group') {
                  return <BashGroupBlock key={i} items={item.items} />;
                }
                if (item.kind === 'transient_tool') {
                  return <TransientSearchBlock key={i} block={item.block} receivedAt={item.receivedAt} />;
                }
                const block = item.block;
                // In post-build groups the agent often restates the plan; suppress it
                if (isAfterBuild && block.type === 'text' && block.text && hasPlanBlock(block.text)) {
                  return null;
                }
                if (block.type === 'text' && block.text && hasPlanBlock(block.text)) {
                  if (planRendered) return null;
                  if (fallbackPlanBody) {
                    planRendered = true;
                    const title = extractTitle(fallbackPlanBody);
                    const ts = new Date(messages[0]?.createdAt ?? 0).toISOString().replace(/[-:]/g, '').slice(0, 13);
                    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
                    return (
                      <PlanBlock
                        key={i}
                        filename={`${slug}_${ts}.md`}
                        content={fallbackPlanBody}
                        isComplete={true}
                        wasBuilt={wasBuilt}
                        threadStatus={threadStatus}
                      />
                    );
                  }
                }
                return <ContentBlockView key={i} block={block} siblings={allBlocks} isLiveThinking={block === liveThinkingBlock} />;
              });
            })()
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
    <div className="flex items-center justify-center gap-4 px-4 py-2 text-xs text-text-muted bg-surface-thread/40">
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
    <div className="flex gap-3 px-4 py-3 bg-surface-thread/60">
      <div className="shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center">
          <Info className="w-4 h-4 text-text-muted" />
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.content.map((block, i) => (
          <ContentBlockView key={i} block={block} siblings={message.content} />
        ))}
      </div>
    </div>
  );

}

// ── Content block renderer ──────────────────────────

const MIN_MARKDOWN_LEN = 200;

/** Convert bare `\n` into markdown hard breaks (`  \n`) so single newlines render visually. */
function ensureHardBreaks(text: string): string {
  return text.replace(/(?<! {2})\n/g, '  \n');
}

function ThinkingBlock({ text, isLive }: { text: string; isLive?: boolean }) {
  const { showAll } = useContext(ReasoningToggleContext);
  const contentRef = useRef<HTMLDivElement>(null);

  // Hidden entirely when reasoning is done and toggle is off
  const visible = showAll || !!isLive;

  useEffect(() => {
    if (isLive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, isLive]);

  if (!visible) return null;

  return (
    <div className="my-1 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary text-text-secondary text-xs">
        <Brain className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="font-medium">Reasoning</span>
        {isLive && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />}
      </div>
      <div
        ref={contentRef}
        className="px-3 py-2 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap border-t border-border max-h-60 overflow-y-auto"
      >
        {text}
      </div>
    </div>
  );
}

function ContentBlockView({ block, siblings, isLiveThinking }: { block: ContentBlock; siblings?: ContentBlock[]; isLiveThinking?: boolean }) {
  if (block.type === 'text' && block.text) {
    if (block.text.length >= MIN_MARKDOWN_LEN && HEADING_RE.test(block.text)) {
      const title = extractTitle(block.text);
      return <MarkdownBlock title={title} content={ensureHardBreaks(block.text)} />;
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
            {ensureHardBreaks(block.text)}
          </Markdown>
        </article>
      </div>
    );
  }

  if (block.type === 'thinking' && block.thinking) {
    return <ThinkingBlock text={block.thinking} isLive={isLiveThinking} />;
  }

  if (block.type === 'tool_use') {
    const resultBlock = siblings?.find(b => b.type === 'tool_result' && b.tool_use_id === block.id);
    return <ToolUseBlock block={block} resultContent={resultBlock?.content} />;
  }

  if (block.type === 'tool_result') {
    return null;
  }

  return null;
}
