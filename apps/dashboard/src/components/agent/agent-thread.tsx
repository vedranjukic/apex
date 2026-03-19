import { useEffect, useRef, useMemo, useCallback } from 'react';
import { MessageSquare, Loader2, Sparkles, AlertCircle, ListTodo, RotateCcw, MessageCircleQuestion, CirclePause, Send, Brain } from 'lucide-react';
import { useThreadsStore } from '../../stores/tasks-store';
import { groupMessages, MessageGroupView, PlanShownProvider, ReasoningToggleProvider, useReasoningToggle } from './message-bubble';
import { PromptInput, type PromptInputHandle } from './prompt-input';
import { ThreadActionsContext } from './thread-actions-context';
import { useAgentSettingsStore, AGENT_TYPES, DEFAULT_MODEL_BY_TYPE, type AgentTypeId } from '../../stores/agent-settings-store';
import { usePlanStore } from '../../stores/plan-store';
import type { CodeSelection } from '../../stores/editor-store';

interface Props {
  projectId: string;
  projectAgentType?: string;
  onSendPrompt: (threadId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string) => void;
  onSendSilentPrompt: (threadId: string, prompt: string, mode?: string, model?: string, agentType?: string) => void;
  onExecuteThread: (threadId: string, mode?: string, model?: string, agentType?: string) => void;
  onSendUserAnswer?: (threadId: string, toolUseId: string, answer: string) => void;
  requestListing?: (path: string) => void;
}

const SCROLL_SAVE_DEBOUNCE_MS = 300;
const SCROLL_FOLLOW_THRESHOLD = 150;

export function AgentThread({ projectId, projectAgentType, onSendPrompt, onSendSilentPrompt, onExecuteThread, onSendUserAnswer, requestListing }: Props) {
  const { activeThreadId, composingNew, messages, threads, createThread, threadScrollOffsets, setThreadScrollOffset } =
    useThreadsStore();
  const threadScrollOffset = activeThreadId ? (threadScrollOffsets[activeThreadId] ?? 0) : 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<PromptInputHandle>(null);
  const restoredScrollRef = useRef(false);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevMessageCount = useRef(0);
  const isFollowingRef = useRef(true);

  const fillPrompt = useCallback((text: string) => {
    promptRef.current?.fill(text);
  }, []);

  const sendPrompt = useCallback((text: string) => {
    if (activeThreadId) {
      onSendPrompt(activeThreadId, text);
    }
  }, [activeThreadId, onSendPrompt]);

  const sendSilentPrompt = useCallback((text: string, mode?: string, agentType?: string) => {
    if (activeThreadId) {
      useThreadsStore.getState().addMessage({
        id: crypto.randomUUID(),
        taskId: activeThreadId,
        role: 'user',
        content: [{ type: 'text', text }],
        metadata: null,
        createdAt: new Date().toISOString(),
      });
      const model = useAgentSettingsStore.getState().model || undefined;
      onSendSilentPrompt(activeThreadId, text, mode, model, agentType);
    }
  }, [activeThreadId, onSendSilentPrompt]);

  const sendUserAnswer = useCallback((toolUseId: string, answer: string) => {
    if (activeThreadId && onSendUserAnswer) {
      onSendUserAnswer(activeThreadId, toolUseId, answer);
    }
  }, [activeThreadId, onSendUserAnswer]);

  const activeThread = threads.find((c) => c.id === activeThreadId);

  useEffect(() => {
    const store = useAgentSettingsStore.getState();
    if (activeThread?.agentType) {
      const at = activeThread.agentType as AgentTypeId;
      if (store.agentType !== at) {
        store.setAgentType(at);
      }
      if (activeThread.model != null && store.model !== activeThread.model) {
        store.setModel(activeThread.model);
      }
    } else if (!activeThreadId && projectAgentType) {
      const pat = projectAgentType as AgentTypeId;
      if (store.agentType !== pat) {
        store.setAgentType(pat);
      }
    }
  }, [activeThreadId, activeThread?.id, activeThread?.agentType, activeThread?.model, projectAgentType]);

  useEffect(() => {
    if (!activeThreadId || !activeThread?.planData) return;
    const planStore = usePlanStore.getState();
    if (planStore.getPlanByThreadId(activeThreadId)) return;
    planStore.markThreadAsPlan(activeThreadId);
    const { id, title, filename, content } = activeThread.planData;
    const plan = {
      id,
      threadId: activeThreadId,
      title,
      filename,
      content,
      isComplete: true,
      createdAt: activeThread.createdAt,
    };
    usePlanStore.setState((s) => ({ plans: [...s.plans, plan] }));
  }, [activeThreadId, activeThread?.planData]);

  const groups = useMemo(() => groupMessages(messages), [messages]);
  const lastAgentGroupIdx = useMemo(
    () => groups.reduce((last, g, i) => (g.type === 'agent' ? i : last), -1),
    [groups],
  );
  const hasThinkingBlocks = useMemo(
    () => messages.some((m) => m.content.some((b) => b.type === 'thinking')),
    [messages],
  );

  const taskInfo = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const block = msg.content[j];
        const bName = (block.name ?? '').toLowerCase();
        if (block.type === 'tool_use' && (bName === 'todowrite' || bName === 'todo_write') && block.input) {
          const todos = (block.input as Record<string, unknown>).todos;
          if (Array.isArray(todos)) {
            const ip = todos.find((t: any) => t.status === 'in_progress');
            const hasPending = todos.some((t: any) => t.status === 'pending' || t.status === 'in_progress');
            const allDone = todos.length > 0 && todos.every((t: any) => t.status === 'completed');
            return {
              currentTask: ip && (ip as any).content ? (ip as any).content as string : null,
              hasPending: hasPending && !allDone,
            };
          }
        }
      }
    }
    return { currentTask: null, hasPending: false };
  }, [messages]);
  const currentTask = taskInfo.currentTask;

  useEffect(() => {
    restoredScrollRef.current = false;
    prevMessageCount.current = 0;
    isFollowingRef.current = true;
  }, [activeThreadId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || restoredScrollRef.current || messages.length === 0) return;
    if (threadScrollOffset > 0) {
      el.scrollTop = threadScrollOffset;
      isFollowingRef.current =
        el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_FOLLOW_THRESHOLD;
    }
    restoredScrollRef.current = true;
  }, [messages.length, threadScrollOffset]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0 || !restoredScrollRef.current) return;
    if (isFollowingRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCount.current = messages.length;
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isFollowingRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_FOLLOW_THRESHOLD;
    clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      if (activeThreadId) setThreadScrollOffset(activeThreadId, el.scrollTop);
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }, [activeThreadId, setThreadScrollOffset]);

  const handleNewThreadPrompt = useCallback(
    async (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string) => {
      let fullPrompt = prompt;
      if (files && files.length > 0) {
        fullPrompt = `Referenced files:\n${files.map((f) => `- ${f}`).join('\n')}\n\n${fullPrompt}`;
      }
      if (snippets && snippets.length > 0) {
        const snippetRefs = snippets.map(
          (s) => `- ${s.filePath} lines ${s.startLine}:${s.startChar}-${s.endLine}:${s.endChar}`,
        );
        fullPrompt = `Referenced code selections:\n${snippetRefs.join('\n')}\n\n${fullPrompt}`;
      }
      const thread = await createThread(projectId, { prompt: fullPrompt, agentType });
      onExecuteThread(thread.id, mode, model, agentType);
    },
    [createThread, projectId, onExecuteThread],
  );

  if (!activeThreadId && !composingNew) {
    return (
      <WelcomePrompt
        hasThreads={threads.length > 0}
        onSend={handleNewThreadPrompt}
        requestListing={requestListing}
      />
    );
  }

  if (composingNew && !activeThreadId) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-thread">
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="text-center">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">What would you like the agent to do?</p>
          </div>
        </div>

        <PromptInput
          onSend={handleNewThreadPrompt}
          placeholder="Describe what the agent should do…"
          autoFocus
          requestListing={requestListing}
        />
      </div>
    );
  }

  if (!activeThread) return null;

  const isRunning = activeThread.status === 'running';
  const isError = activeThread.status === 'error';
  const isWaitingForInput = activeThread.status === 'waiting_for_input';
  const isWaitingForAction = activeThread.status === 'waiting_for_user_action';

  return (
    <ThreadActionsContext.Provider value={{ fillPrompt, sendPrompt, sendSilentPrompt, sendUserAnswer }}>
      <ReasoningToggleProvider>
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-thread">
        {/* Thread header: title + agent + thread id, progress icon when running */}
        <div className="px-4 py-3 border-b border-border bg-surface-thread flex items-center gap-2 min-h-[44px] min-w-0">
          <h2 className="font-semibold text-sm truncate min-w-0">
            {activeThread.title}
          </h2>
          {(() => {
            const agentLabel = AGENT_TYPES.find((a) => a.value === (activeThread.agentType ?? projectAgentType))?.label;
            return agentLabel ? (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                {agentLabel}
              </span>
            ) : null;
          })()}
          <span className="shrink-0 text-[10px] text-text-muted font-mono" title={activeThread.id}>
            {activeThread.id.slice(0, 8)}
          </span>
          {currentTask && (
            <span className="inline-flex items-center gap-1 text-xs text-text-secondary truncate min-w-0">
              <span className="text-text-muted">·</span>
              <ListTodo className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              {currentTask}
            </span>
          )}
          {hasThinkingBlocks && <ReasoningToggleButton />}
          {isRunning && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500 shrink-0" />
          )}
          {isError && (
            <div className="flex items-center gap-2 shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              <button
                type="button"
                onClick={() => onExecuteThread(activeThreadId!)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            </div>
          )}
          {isWaitingForInput && (
            <span className="flex items-center gap-1 text-xs text-yellow-400 shrink-0 animate-pulse">
              <MessageCircleQuestion className="w-3.5 h-3.5" />
              Waiting for your response
            </span>
          )}
          {isWaitingForAction && (
            <span className="flex items-center gap-1 text-xs text-yellow-400 shrink-0">
              <CirclePause className="w-3.5 h-3.5" />
              Waiting for user action
            </span>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              No messages yet
            </div>
          ) : (
            <PlanShownProvider threadId={activeThreadId}>
              <div className="divide-y divide-border">
                {groups.map((group, i) => (
                  <MessageGroupView key={i} group={group} isLastGroup={i === lastAgentGroupIdx} />
                ))}
              </div>
            </PlanShownProvider>
          )}
        </div>

        {/* Continue banner — shown when agent stopped with pending tasks */}
        {taskInfo.hasPending && !isRunning && (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-primary/5">
            <ListTodo className="w-4 h-4 text-violet-400 shrink-0" />
            <span className="text-xs text-text-secondary flex-1">The agent has pending tasks to complete.</span>
            <button
              type="button"
              onClick={() => onSendSilentPrompt(activeThreadId!, 'Continue. Execute the pending tasks.')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary-hover transition-colors font-medium shrink-0"
            >
              <Send className="w-3 h-3" />
              Continue
            </button>
          </div>
        )}

        {/* Input */}
        <PromptInput
          ref={promptRef}
          onSend={(prompt, files, mode, model, snippets, agentType) => onSendPrompt(activeThreadId!, prompt, files, mode, model, snippets, agentType)}
          disabled={isRunning}
          requestListing={requestListing}
        />
      </div>
      </ReasoningToggleProvider>
    </ThreadActionsContext.Provider>
  );
}

function ReasoningToggleButton() {
  const { showAll, toggle } = useReasoningToggle();
  return (
    <button
      type="button"
      onClick={toggle}
      title={showAll ? 'Collapse all reasoning' : 'Expand all reasoning'}
      className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
        showAll
          ? 'bg-violet-500/15 text-violet-400'
          : 'bg-white/5 text-text-muted hover:text-text-secondary hover:bg-white/10'
      }`}
    >
      <Brain className="w-3 h-3" />
      <span>{showAll ? 'Collapse all' : 'Expand all'}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Welcome / empty-state prompt panel                                */
/* ------------------------------------------------------------------ */

function WelcomePrompt({
  hasThreads,
  onSend,
  requestListing,
}: {
  hasThreads: boolean;
  onSend: (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string) => void;
  requestListing?: (path: string) => void;
}) {
  const suggestions = [
    'Create a REST API with Express and TypeScript',
    'Build a landing page with Tailwind CSS',
    'Write unit tests for the auth module',
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 bg-surface-thread">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary">
            {hasThreads ? 'Start a new task' : 'What would you like to build?'}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Describe what you need and the agent will get to work.
          </p>
        </div>

        <div className="w-full">
          <PromptInput
            onSend={onSend}
            placeholder="Describe a task for the agent…"
            autoFocus
            requestListing={requestListing}
          />
        </div>

        {!hasThreads && (
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="px-3 py-1.5 text-xs rounded-full border border-border text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
