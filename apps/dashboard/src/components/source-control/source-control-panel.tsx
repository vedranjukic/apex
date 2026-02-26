import { useState, useCallback, useRef, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Undo2,
  ArrowUpDown,
  Check,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { useGitStore, type GitFileEntry } from '../../stores/git-store';
import type { GitActions } from '../../hooks/use-git-socket';
import { chatsApi, type Message } from '../../api/client';

interface SourceControlPanelProps {
  gitActions: GitActions;
  projectId: string;
  socket: { current: Socket | null };
  sendPrompt: (chatId: string, prompt: string, mode?: string, model?: string) => void;
}

export function SourceControlPanel({ gitActions, projectId, socket, sendPrompt }: SourceControlPanelProps) {
  const branch = useGitStore((s) => s.branch);
  const staged = useGitStore((s) => s.staged);
  const unstaged = useGitStore((s) => s.unstaged);
  const untracked = useGitStore((s) => s.untracked);
  const conflicted = useGitStore((s) => s.conflicted);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const loading = useGitStore((s) => s.loading);
  const commitMessage = useGitStore((s) => s.commitMessage);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const optimisticStage = useGitStore((s) => s.optimisticStage);
  const optimisticUnstage = useGitStore((s) => s.optimisticUnstage);
  const optimisticDiscard = useGitStore((s) => s.optimisticDiscard);
  const [generating, setGenerating] = useState(false);
  const generatingChatId = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [commitMessage]);

  const stageFiles = useCallback((paths: string[]) => {
    optimisticStage(paths);
    gitActions.stage(paths);
  }, [optimisticStage, gitActions]);

  const unstageFiles = useCallback((paths: string[]) => {
    optimisticUnstage(paths);
    gitActions.unstage(paths);
  }, [optimisticUnstage, gitActions]);

  const discardFiles = useCallback((paths: string[]) => {
    optimisticDiscard(paths);
    gitActions.discard(paths);
  }, [optimisticDiscard, gitActions]);

  // Clean up socket listener on unmount
  useEffect(() => {
    return () => { generatingChatId.current = null; };
  }, []);

  const handleGenerateMessage = useCallback(async () => {
    if (generating || staged.length === 0) return;
    setGenerating(true);
    setCommitMessage('');

    try {
      const stagedPaths = staged.map((f) => f.path);
      const basenames = new Set(stagedPaths.map((p) => {
        const i = p.lastIndexOf('/');
        return i >= 0 ? p.slice(i + 1) : p;
      }));

      // Gather context from existing chats
      const chats = await chatsApi.listByProject(projectId);
      let context = '';
      const MAX_CONTEXT = 4000;

      for (const chat of chats.slice(0, 10)) {
        if (context.length >= MAX_CONTEXT) break;
        let messages: Message[];
        try { messages = await chatsApi.messages(chat.id); } catch { continue; }

        for (const msg of messages) {
          if (context.length >= MAX_CONTEXT) break;
          const refFiles = (msg.metadata?.referencedFiles as string[] | undefined) ?? [];
          const hasRefMatch = refFiles.some((rf) => stagedPaths.some((sp) => rf.endsWith(sp) || sp.endsWith(rf)));

          const textContent = msg.content
            ?.filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text)
            .join(' ') ?? '';

          const hasTextMatch = !hasRefMatch && [...basenames].some((bn) => textContent.includes(bn));

          if (hasRefMatch || hasTextMatch) {
            const excerpt = textContent.slice(0, 500);
            context += `[${msg.role}]: ${excerpt}\n\n`;
          }
        }
      }

      const prompt = [
        'Generate a concise conventional commit message (subject line only, no quotes, no prefix like "commit:") for the following staged files.',
        '',
        'Staged files:',
        ...stagedPaths.map((p) => `- ${p}`),
        '',
        context
          ? `Relevant conversation context:\n${context.slice(0, MAX_CONTEXT)}`
          : 'No conversation context available. Infer the purpose from the file names.',
        '',
        'Respond with ONLY the commit message, nothing else.',
      ].join('\n');

      // Create a temporary chat and send the prompt
      const tempChat = await chatsApi.create(projectId, { prompt: 'generate commit message' });
      generatingChatId.current = tempChat.id;

      const sock = socket.current;
      if (!sock) { setGenerating(false); return; }

      let accumulated = '';
      const onMessage = (data: { chatId?: string; message?: { type: string; message?: { content?: Array<{ type: string; text?: string }> } } }) => {
        if (data.chatId !== generatingChatId.current) return;
        const msg = data.message;
        if (!msg) return;

        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              accumulated = block.text;
              setCommitMessage(accumulated.replace(/^["']|["']$/g, '').trim());
            }
          }
        }
        if (msg.type === 'result') {
          sock.off('agent_message', onMessage);
          generatingChatId.current = null;
          setGenerating(false);
          // Clean up the temp chat
          chatsApi.delete(tempChat.id).catch(() => {});
        }
      };

      sock.on('agent_message', onMessage);
      sendPrompt(tempChat.id, prompt, 'ask');

      // Safety timeout
      setTimeout(() => {
        if (generatingChatId.current === tempChat.id) {
          sock.off('agent_message', onMessage);
          generatingChatId.current = null;
          setGenerating(false);
        }
      }, 60_000);
    } catch (err) {
      console.error('Failed to generate commit message:', err);
      setGenerating(false);
    }
  }, [generating, staged, projectId, socket, sendPrompt, setCommitMessage]);

  const hasStaged = staged.length > 0;
  const hasChanges = unstaged.length > 0 || untracked.length > 0;
  const isClean = !hasStaged && !hasChanges && conflicted.length === 0;
  const hasSyncable = ahead > 0 || behind > 0;

  const handleCommit = useCallback(() => {
    const msg = commitMessage.trim();
    if (!msg) return;
    if (hasStaged) {
      gitActions.commit(msg);
    } else if (hasChanges) {
      gitActions.commit(msg, true);
    }
    setCommitMessage('');
  }, [commitMessage, hasStaged, hasChanges, gitActions, setCommitMessage]);

  const handleSync = useCallback(() => {
    if (behind > 0) gitActions.pull();
    if (ahead > 0) gitActions.push();
  }, [ahead, behind, gitActions]);

  const handleMainAction = useCallback(() => {
    if (!isClean && commitMessage.trim()) {
      handleCommit();
    } else if (isClean && hasSyncable) {
      handleSync();
    }
  }, [isClean, hasSyncable, commitMessage, handleCommit, handleSync]);

  const getButtonLabel = () => {
    if (loading) return 'Working…';
    if (!isClean && commitMessage.trim()) {
      return hasStaged ? 'Commit' : 'Commit All';
    }
    if (isClean && hasSyncable) {
      const parts: string[] = [];
      if (ahead > 0) parts.push(`${ahead}↑`);
      if (behind > 0) parts.push(`${behind}↓`);
      return `Sync Changes ${parts.join(' ')}`;
    }
    if (isClean) return 'No Changes';
    return 'Commit';
  };

  const isButtonDisabled =
    loading ||
    (isClean && !hasSyncable) ||
    (!isClean && !commitMessage.trim());

  return (
    <div className="flex flex-col gap-2 text-sm">
      {branch && (
        <div className="text-[11px] text-text-muted truncate px-0.5">
          On branch <span className="text-text-secondary font-medium">{branch}</span>
        </div>
      )}

      <div className="flex items-start w-full bg-sidebar-hover rounded focus-within:ring-1 focus-within:ring-primary">
        <textarea
          ref={textareaRef}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Message (press Enter to commit)"
          rows={1}
          className="flex-1 min-w-0 px-2 py-1.5 bg-transparent text-xs text-panel-text placeholder:text-text-muted focus:outline-none resize-none min-h-[28px] max-h-[120px] overflow-y-auto"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleMainAction();
            }
          }}
        />
        <div className="flex items-center shrink-0 pr-1 pt-1">
          <button
            onClick={handleGenerateMessage}
            disabled={generating || staged.length === 0}
            title="Generate commit message with AI"
            className={cn(
              'p-1 rounded transition-colors',
              generating
                ? 'text-primary'
                : staged.length === 0
                  ? 'text-text-muted cursor-not-allowed'
                  : 'text-text-muted hover:text-primary hover:bg-sidebar-active',
            )}
          >
            {generating
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <button
        onClick={handleMainAction}
        disabled={isButtonDisabled}
        className={cn(
          'w-full py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
          isButtonDisabled
            ? 'bg-sidebar-hover text-text-muted cursor-not-allowed'
            : isClean && hasSyncable
              ? 'bg-primary hover:bg-primary-hover text-white'
              : 'bg-primary hover:bg-primary-hover text-white',
        )}
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : isClean && hasSyncable ? (
          <ArrowUpDown className="w-3 h-3" />
        ) : !isClean && commitMessage.trim() ? (
          <Check className="w-3 h-3" />
        ) : null}
        {getButtonLabel()}
      </button>

      {conflicted.length > 0 && (
        <FileSection
          title="Merge Conflicts"
          files={conflicted}
          variant="conflicted"
          actions={{
            onStage: stageFiles,
          }}
        />
      )}

      {staged.length > 0 && (
        <FileSection
          title="Staged Changes"
          files={staged}
          variant="staged"
          actions={{
            onUnstage: unstageFiles,
            onUnstageAll: () => unstageFiles(staged.map((f) => f.path)),
          }}
        />
      )}

      {unstaged.length > 0 && (
        <FileSection
          title="Changes"
          files={unstaged}
          variant="unstaged"
          actions={{
            onStage: stageFiles,
            onDiscard: discardFiles,
            onStageAll: () => stageFiles(unstaged.map((f) => f.path)),
            onDiscardAll: () => discardFiles(unstaged.map((f) => f.path)),
          }}
        />
      )}

      {untracked.length > 0 && (
        <FileSection
          title="Untracked"
          files={untracked}
          variant="untracked"
          actions={{
            onStage: stageFiles,
            onDiscard: discardFiles,
            onStageAll: () => stageFiles(untracked.map((f) => f.path)),
            onDiscardAll: () => discardFiles(untracked.map((f) => f.path)),
          }}
        />
      )}

      {isClean && !hasSyncable && (
        <div className="text-xs text-text-muted text-center py-4 opacity-60">
          Working tree clean
        </div>
      )}
    </div>
  );
}

// ── Section Component ──────────────────────────────────

type SectionVariant = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

interface SectionActions {
  onStage?: (paths: string[]) => void;
  onUnstage?: (paths: string[]) => void;
  onDiscard?: (paths: string[]) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onDiscardAll?: () => void;
}

function FileSection({
  title,
  files,
  variant,
  actions,
}: {
  title: string;
  files: GitFileEntry[];
  variant: SectionVariant;
  actions: SectionActions;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 cursor-pointer select-none group"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary flex-1 truncate">
          {title}
        </span>
        <span className="text-[10px] text-text-muted tabular-nums mr-1">{files.length}</span>

        <div className="hidden group-hover:flex items-center gap-0.5">
          {actions.onStageAll && (
            <ActionButton
              icon={<Plus className="w-3 h-3" />}
              title="Stage All"
              onClick={(e) => { e.stopPropagation(); actions.onStageAll!(); }}
            />
          )}
          {actions.onUnstageAll && (
            <ActionButton
              icon={<Minus className="w-3 h-3" />}
              title="Unstage All"
              onClick={(e) => { e.stopPropagation(); actions.onUnstageAll!(); }}
            />
          )}
          {actions.onDiscardAll && (
            <ActionButton
              icon={<Undo2 className="w-3 h-3" />}
              title="Discard All"
              onClick={(e) => { e.stopPropagation(); actions.onDiscardAll!(); }}
            />
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="flex flex-col">
          {files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              variant={variant}
              actions={actions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── File Row Component ─────────────────────────────────

const statusBadge: Record<string, { letter: string; color: string }> = {
  modified: { letter: 'M', color: 'text-yellow-400' },
  added: { letter: 'A', color: 'text-green-400' },
  deleted: { letter: 'D', color: 'text-red-400' },
  renamed: { letter: 'R', color: 'text-blue-400' },
  untracked: { letter: 'U', color: 'text-green-400' },
  conflicted: { letter: 'C', color: 'text-red-500' },
};

function FileRow({
  file,
  variant,
  actions,
}: {
  file: GitFileEntry;
  variant: SectionVariant;
  actions: SectionActions;
}) {
  const badge = statusBadge[file.status] ?? { letter: '?', color: 'text-text-muted' };
  const lastSlash = file.path.lastIndexOf('/');
  const basename = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;
  const dirname = lastSlash >= 0 ? file.path.slice(0, lastSlash) : '';

  return (
    <div className="flex items-center gap-1 pl-4 pr-1 py-0.5 rounded hover:bg-sidebar-hover group/row min-h-[22px]">
      <span className="text-xs text-text-primary truncate shrink-0">{basename}</span>
      <span className="flex-1" />
      {dirname && (
        <span className="text-[10px] text-text-muted truncate mr-1 max-w-[40%] text-right">{dirname}</span>
      )}
      <span className={cn('w-3 text-[10px] font-bold shrink-0 text-center', badge.color)}>
        {badge.letter}
      </span>

      <div className="hidden group-hover/row:flex items-center gap-0.5 shrink-0">
        {(variant === 'unstaged' || variant === 'untracked' || variant === 'conflicted') && actions.onStage && (
          <ActionButton
            icon={<Plus className="w-3 h-3" />}
            title="Stage"
            onClick={() => actions.onStage!([file.path])}
          />
        )}
        {variant === 'staged' && actions.onUnstage && (
          <ActionButton
            icon={<Minus className="w-3 h-3" />}
            title="Unstage"
            onClick={() => actions.onUnstage!([file.path])}
          />
        )}
        {(variant === 'unstaged' || variant === 'untracked') && actions.onDiscard && (
          <ActionButton
            icon={<Undo2 className="w-3 h-3" />}
            title="Discard"
            onClick={() => actions.onDiscard!([file.path])}
          />
        )}
      </div>
    </div>
  );
}

// ── Tiny icon button ───────────────────────────────────

function ActionButton({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-0.5 rounded hover:bg-sidebar-active text-text-muted hover:text-text-primary transition-colors"
    >
      {icon}
    </button>
  );
}
