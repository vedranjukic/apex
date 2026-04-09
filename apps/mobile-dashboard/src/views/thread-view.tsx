import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Message, type ContentBlock } from '../api';
import { BackButton } from '../components';

interface Props {
  threadId: string;
  projectId: string;
  projectName: string;
  threadTitle: string;
}

export function ThreadView({ threadId, projectId, projectName, threadTitle }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setMessages(await api.threadMessages(threadId));
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    if (!prompt.trim() || sending) return;
    setSending(true);
    setSent(false);
    try {
      await api.submitPrompt(projectId, threadId, prompt.trim());
      setPrompt('');
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch {
      // error handled silently
    } finally {
      setSending(false);
    }
  };

  const backHref = `#/project/${projectId}?name=${encodeURIComponent(projectName)}`;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <BackButton href={backHref} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{threadTitle || 'Thread'}</div>
          <div className="truncate text-xs text-text-muted">{projectName}</div>
        </div>
        <button onClick={load} className="text-sm text-text-secondary active:text-text">Refresh</button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && messages.length === 0 && (
          <p className="py-12 text-center text-text-muted">Loading messages...</p>
        )}

        <div className="space-y-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>

        {!loading && messages.length === 0 && (
          <p className="py-12 text-center text-text-muted">No messages synced yet</p>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border bg-surface p-3">
        {sent && (
          <p className="mb-2 text-center text-xs text-accent">Prompt queued -- will execute when desktop picks it up</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Send a prompt..."
            rows={1}
            className="min-h-[44px] max-h-32 flex-1 resize-none rounded-xl border border-border bg-surface-card px-4 py-3 text-sm text-text placeholder-text-muted outline-none focus:border-primary"
          />
          <button
            onClick={handleSend}
            disabled={!prompt.trim() || sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-40"
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    const text = message.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
    if (!text) return null;
    return (
      <div className="ml-8 rounded-2xl rounded-br-md bg-user-bubble px-4 py-3 text-sm text-text">
        <pre className="whitespace-pre-wrap font-sans">{text}</pre>
      </div>
    );
  }

  if (message.role === 'assistant') {
    return (
      <div className="mr-8 space-y-2">
        {message.content.map((block, i) => (
          <ContentBlockView key={i} block={block} />
        ))}
      </div>
    );
  }

  if (message.role === 'system') {
    const meta = message.metadata || {};
    const cost = meta.costUsd as number | undefined;
    const turns = meta.numTurns as number | undefined;
    if (!cost && !turns) return null;
    return (
      <div className="text-center text-xs text-text-muted">
        {turns != null && <span>{turns} turn{turns !== 1 ? 's' : ''}</span>}
        {cost != null && <span> · ${cost.toFixed(4)}</span>}
      </div>
    );
  }

  return null;
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  if (block.type === 'text' && block.text) {
    return (
      <div className="rounded-2xl rounded-bl-md bg-surface-card px-4 py-3 text-sm text-text">
        <pre className="whitespace-pre-wrap font-sans">{block.text}</pre>
      </div>
    );
  }

  if (block.type === 'thinking' && block.thinking) {
    return (
      <div className="rounded-xl border border-border bg-surface-card text-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-text-secondary"
        >
          <span className="text-xs">{expanded ? '▼' : '▶'}</span>
          <span>Reasoning</span>
        </button>
        {expanded && (
          <div className="border-t border-border px-4 py-3 text-text-muted">
            <pre className="whitespace-pre-wrap font-sans">{block.thinking}</pre>
          </div>
        )}
      </div>
    );
  }

  if (block.type === 'tool_use') {
    return (
      <div className="rounded-xl border border-border bg-surface-card text-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-text-secondary"
        >
          <span className="text-xs">{expanded ? '▼' : '▶'}</span>
          <span className="font-mono text-xs">{block.name || 'tool'}</span>
        </button>
        {expanded && block.input && (
          <div className="border-t border-border px-4 py-3">
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-text-muted">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return null;
}
