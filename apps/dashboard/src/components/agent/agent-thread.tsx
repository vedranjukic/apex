import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { MessageSquare, Loader2, Sparkles, AlertCircle, ListTodo, RotateCcw, MessageCircleQuestion, CirclePause, Send, Brain, BarChart3, X, Play } from 'lucide-react';
import { useThreadsStore } from '../../stores/tasks-store';
import { groupMessages, MessageGroupView, PlanShownProvider, ReasoningToggleProvider, useReasoningToggle } from './message-bubble';
import { PromptInput, type PromptInputHandle, type ImageAttachment } from './prompt-input';
import { ThreadActionsContext } from './thread-actions-context';
import { ThreadStatsBar } from './thread-stats-bar';
import { useAgentSettingsStore, AGENT_TYPES, DEFAULT_MODEL_BY_TYPE, type AgentTypeId } from '../../stores/agent-settings-store';
import { usePlanStore } from '../../stores/plan-store';
import type { CodeSelection } from '../../stores/editor-store';
import type { GitHubContextData } from '../../api/client';

interface Props {
  projectId: string;
  projectAgentType?: string;
  onSendPrompt: (threadId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => void;
  onSendSilentPrompt: (threadId: string, prompt: string, mode?: string, model?: string, agentType?: string) => void;
  onExecuteThread: (threadId: string, mode?: string, model?: string, agentType?: string) => void;
  onSendUserAnswer?: (threadId: string, toolUseId: string, answer: string) => void;
  onStopAgent?: (threadId: string) => void;
  requestListing?: (path: string) => void;
  githubContext?: GitHubContextData | null;
  canCreatePr?: boolean;
  projectDir?: string | null;
}

const SCROLL_SAVE_DEBOUNCE_MS = 300;
const SCROLL_FOLLOW_THRESHOLD = 150;

export function AgentThread({ projectId, projectAgentType, onSendPrompt, onSendSilentPrompt, onExecuteThread, onSendUserAnswer, onStopAgent, requestListing, githubContext, canCreatePr, projectDir }: Props) {
  const { activeThreadId, composingNew, messages, threads, createThread, threadScrollOffsets, setThreadScrollOffset } =
    useThreadsStore();
  const threadScrollOffset = activeThreadId ? (threadScrollOffsets[activeThreadId] ?? 0) : 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<PromptInputHandle>(null);
  const restoredScrollRef = useRef(false);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevMessageCount = useRef(0);
  const isFollowingRef = useRef(true);

  const [showStats, setShowStats] = useState(false);
  const [promptQueue, setPromptQueue] = useState<{ id: string; text: string; files?: string[]; mode?: string; model?: string; snippets?: CodeSelection[]; agentType?: string; images?: ImageAttachment[] }[]>([]);
  const pendingSendRef = useRef<typeof promptQueue[number] | null>(null);

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
  const isRunning = activeThread?.status === 'running';
  const prevRunningRef = useRef(false);

  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      if (pendingSendRef.current) {
        const item = pendingSendRef.current;
        pendingSendRef.current = null;
        setPromptQueue((q) => q.filter((p) => p.id !== item.id));
        if (activeThreadId) onSendPrompt(activeThreadId, item.text, item.files, item.mode, item.model, item.snippets, item.agentType, item.images);
      } else {
        setPromptQueue((prev) => {
          if (prev.length === 0) return prev;
          const [first, ...rest] = prev;
          if (activeThreadId) onSendPrompt(activeThreadId, first.text, first.files, first.mode, first.model, first.snippets, first.agentType, first.images);
          return rest;
        });
      }
    }
    prevRunningRef.current = !!isRunning;
  }, [isRunning, activeThreadId, onSendPrompt]);

  useEffect(() => {
    setPromptQueue([]);
    pendingSendRef.current = null;
  }, [activeThreadId]);

  const handlePromptSubmit = useCallback(
    (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => {
      if (!activeThreadId) return;
      if (isRunning) {
        setPromptQueue((q) => [...q, { id: crypto.randomUUID(), text: prompt, files, mode, model, snippets, agentType, images }]);
      } else {
        onSendPrompt(activeThreadId, prompt, files, mode, model, snippets, agentType, images);
      }
    },
    [activeThreadId, isRunning, onSendPrompt],
  );

  const handleSendFromQueue = useCallback(
    (item: typeof promptQueue[number]) => {
      if (!activeThreadId) return;
      if (isRunning && onStopAgent) {
        pendingSendRef.current = item;
        onStopAgent(activeThreadId);
      } else {
        setPromptQueue((q) => q.filter((p) => p.id !== item.id));
        onSendPrompt(activeThreadId, item.text, item.files, item.mode, item.model, item.snippets, item.agentType, item.images);
      }
    },
    [activeThreadId, isRunning, onStopAgent, onSendPrompt],
  );

  const handleRemoveFromQueue = useCallback((id: string) => {
    setPromptQueue((q) => q.filter((p) => p.id !== id));
    if (pendingSendRef.current?.id === id) pendingSendRef.current = null;
  }, []);

  const handleStop = useCallback(() => {
    if (activeThreadId && onStopAgent) onStopAgent(activeThreadId);
  }, [activeThreadId, onStopAgent]);

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

  const hasResultData = useMemo(
    () => messages.some((m) =>
      m.role === 'system' && m.content.length === 0 && m.metadata &&
      (m.metadata.costUsd != null || m.metadata.numTurns != null),
    ),
    [messages],
  );

  const taskInfo = useMemo(() => {
    let assistantCount = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;
      assistantCount++;
      if (assistantCount > 3) break;
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
    async (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => {
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
      // TODO: forward images for new thread creation once backend supports it
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
        githubContext={githubContext}
        canCreatePr={canCreatePr}
        projectDir={projectDir}
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
          githubContext={githubContext}
          canCreatePr={canCreatePr}
          projectDir={projectDir}
        />
      </div>
    );
  }

  if (!activeThread) return null;

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
          {hasResultData && (
            <StatsToggleButton active={showStats} onToggle={() => setShowStats((v) => !v)} />
          )}
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
              onClick={() => sendSilentPrompt('Continue. Execute the pending tasks.')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-on-primary hover:bg-primary-hover transition-colors font-medium shrink-0"
            >
              <Send className="w-3 h-3" />
              Continue
            </button>
          </div>
        )}

        {/* Queued prompts */}
        {promptQueue.length > 0 && (
          <div className="border-t border-border bg-sidebar/50">
            <div className="max-w-3xl mx-auto px-4 py-2 space-y-1.5">
              <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Queued</span>
              {promptQueue.map((item) => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-thread border border-border">
                  <span className="flex-1 text-xs text-text-secondary truncate">{item.text}</span>
                  <button
                    type="button"
                    onClick={() => handleSendFromQueue(item)}
                    title="Stop current and send this"
                    className="shrink-0 p-1 rounded text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveFromQueue(item.id)}
                    title="Remove from queue"
                    className="shrink-0 p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <PromptInput
          ref={promptRef}
          onSend={handlePromptSubmit}
          isRunning={isRunning}
          onStop={handleStop}
          requestListing={requestListing}
          githubContext={githubContext}
          canCreatePr={canCreatePr}
          projectDir={projectDir}
        />

        {/* Thread stats bar */}
        {showStats && activeThreadId && (
          <ThreadStatsBar threadId={activeThreadId} messages={messages} />
        )}
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
          : 'bg-surface-secondary text-text-muted hover:text-text-secondary hover:bg-sidebar-hover'
      }`}
    >
      <Brain className="w-3 h-3" />
      <span>{showAll ? 'Collapse all' : 'Expand all'}</span>
    </button>
  );
}

function StatsToggleButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={active ? 'Hide thread stats' : 'Show thread stats'}
      className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
        active
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-surface-secondary text-text-muted hover:text-text-secondary hover:bg-sidebar-hover'
      }`}
    >
      <BarChart3 className="w-3 h-3" />
      <span>Stats</span>
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
  githubContext,
  canCreatePr,
  projectDir,
}: {
  hasThreads: boolean;
  onSend: (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => void;
  requestListing?: (path: string) => void;
  githubContext?: GitHubContextData | null;
  canCreatePr?: boolean;
  projectDir?: string | null;
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
            githubContext={githubContext}
            canCreatePr={canCreatePr}
            projectDir={projectDir}
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
