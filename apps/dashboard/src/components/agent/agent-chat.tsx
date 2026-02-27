import { useEffect, useRef, useMemo, useCallback } from 'react';
import { MessageSquare, Loader2, Sparkles, AlertCircle, ListTodo, RotateCcw } from 'lucide-react';
import { useChatsStore } from '../../stores/tasks-store';
import { groupMessages, MessageGroupView } from './message-bubble';
import { PromptInput, type PromptInputHandle } from './prompt-input';
import { ChatActionsContext } from './chat-actions-context';
import type { CodeSelection } from '../../stores/editor-store';

interface Props {
  projectId: string;
  onSendPrompt: (chatId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => void;
  onSendSilentPrompt: (chatId: string, prompt: string, mode?: string, model?: string) => void;
  onExecuteChat: (chatId: string, mode?: string, model?: string) => void;
  onSendUserAnswer?: (chatId: string, toolUseId: string, answer: string) => void;
  requestListing?: (path: string) => void;
}

const SCROLL_SAVE_DEBOUNCE_MS = 300;
const SCROLL_FOLLOW_THRESHOLD = 150;

export function AgentChat({ projectId, onSendPrompt, onSendSilentPrompt, onExecuteChat, onSendUserAnswer, requestListing }: Props) {
  const { activeChatId, composingNew, messages, chats, createChat, chatScrollOffsets, setChatScrollOffset } =
    useChatsStore();
  const chatScrollOffset = activeChatId ? (chatScrollOffsets[activeChatId] ?? 0) : 0;
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
    if (activeChatId) {
      onSendPrompt(activeChatId, text);
    }
  }, [activeChatId, onSendPrompt]);

  const sendSilentPrompt = useCallback((text: string, mode?: string) => {
    if (activeChatId) {
      useChatsStore.getState().addMessage({
        id: crypto.randomUUID(),
        taskId: activeChatId,
        role: 'user',
        content: [{ type: 'text', text }],
        metadata: null,
        createdAt: new Date().toISOString(),
      });
      onSendSilentPrompt(activeChatId, text, mode);
    }
  }, [activeChatId, onSendSilentPrompt]);

  const sendUserAnswer = useCallback((toolUseId: string, answer: string) => {
    if (activeChatId && onSendUserAnswer) {
      onSendUserAnswer(activeChatId, toolUseId, answer);
    }
  }, [activeChatId, onSendUserAnswer]);

  const activeChat = chats.find((c) => c.id === activeChatId);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  const currentTask = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const block = msg.content[j];
        if (block.type === 'tool_use' && block.name === 'TodoWrite' && block.input) {
          const todos = (block.input as Record<string, unknown>).todos;
          if (Array.isArray(todos)) {
            const ip = todos.find((t: any) => t.status === 'in_progress');
            if (ip && (ip as any).content) return (ip as any).content as string;
          }
        }
      }
    }
    return null;
  }, [messages]);

  useEffect(() => {
    restoredScrollRef.current = false;
    prevMessageCount.current = 0;
    isFollowingRef.current = true;
  }, [activeChatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || restoredScrollRef.current || messages.length === 0) return;
    if (chatScrollOffset > 0) {
      el.scrollTop = chatScrollOffset;
      isFollowingRef.current =
        el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_FOLLOW_THRESHOLD;
    }
    restoredScrollRef.current = true;
  }, [messages.length, chatScrollOffset]);

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
      if (activeChatId) setChatScrollOffset(activeChatId, el.scrollTop);
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }, [activeChatId, setChatScrollOffset]);

  const handleNewChatPrompt = useCallback(
    async (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => {
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
      const chat = await createChat(projectId, { prompt: fullPrompt });
      onExecuteChat(chat.id, mode, model);
    },
    [createChat, projectId, onExecuteChat],
  );

  if (!activeChatId && !composingNew) {
    return (
      <WelcomePrompt
        hasChats={chats.length > 0}
        onSend={handleNewChatPrompt}
        requestListing={requestListing}
      />
    );
  }

  if (composingNew && !activeChatId) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-chat">
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="text-center">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">What would you like the agent to do?</p>
          </div>
        </div>

        <PromptInput
          onSend={handleNewChatPrompt}
          placeholder="Describe what the agent should do…"
          autoFocus
          requestListing={requestListing}
        />
      </div>
    );
  }

  if (!activeChat) return null;

  const isRunning = activeChat.status === 'running';
  const isError = activeChat.status === 'error';

  return (
    <ChatActionsContext.Provider value={{ fillPrompt, sendPrompt, sendSilentPrompt, sendUserAnswer }}>
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-chat">
        {/* Chat header: title + current task inline, progress icon when running */}
        <div className="px-4 py-3 border-b border-border bg-surface-chat flex items-center gap-2 min-h-[44px] min-w-0">
          <h2 className="font-semibold text-sm truncate min-w-0">
            {activeChat.title}
            {currentTask && (
              <>
                <span className="font-normal text-text-muted mx-1.5">·</span>
                <span className="inline-flex items-center gap-1 font-normal text-text-secondary">
                  <ListTodo className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  {currentTask}
                </span>
              </>
            )}
          </h2>
          {isRunning && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500 shrink-0" />
          )}
          {isError && (
            <div className="flex items-center gap-2 shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              <button
                type="button"
                onClick={() => onExecuteChat(activeChatId!)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              No messages yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {groups.map((group, i) => (
                <MessageGroupView key={i} group={group} />
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <PromptInput
          ref={promptRef}
          onSend={(prompt, files, mode, model, snippets) => onSendPrompt(activeChatId!, prompt, files, mode, model, snippets)}
          disabled={isRunning}
          requestListing={requestListing}
        />
      </div>
    </ChatActionsContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Welcome / empty-state prompt panel                                */
/* ------------------------------------------------------------------ */

function WelcomePrompt({
  hasChats,
  onSend,
  requestListing,
}: {
  hasChats: boolean;
  onSend: (prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => void;
  requestListing?: (path: string) => void;
}) {
  const suggestions = [
    'Create a REST API with Express and TypeScript',
    'Build a landing page with Tailwind CSS',
    'Write unit tests for the auth module',
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 bg-surface-chat">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary">
            {hasChats ? 'Start a new task' : 'What would you like to build?'}
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

        {!hasChats && (
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
