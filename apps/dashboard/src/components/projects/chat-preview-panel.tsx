import { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { AgentChat } from '../agent/agent-chat';
import { useChatsStore } from '../../stores/tasks-store';
import type { CodeSelection } from '../../stores/editor-store';

interface Props {
  projectId: string;
  chatId: string;
  projectName: string;
  onClose: () => void;
  onSendPrompt: (chatId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => void;
  onSendSilentPrompt: (chatId: string, prompt: string, mode?: string, model?: string) => void;
  onExecuteChat: (chatId: string, mode?: string, model?: string) => void;
  onSendUserAnswer: (chatId: string, toolUseId: string, answer: string) => void;
}

export function ChatPreviewPanel({
  projectId,
  chatId,
  projectName,
  onClose,
  onSendPrompt,
  onSendSilentPrompt,
  onExecuteChat,
  onSendUserAnswer,
}: Props) {
  const fetchChats = useChatsStore((s) => s.fetchChats);
  const setActiveChat = useChatsStore((s) => s.setActiveChat);
  const prevProjectRef = useRef<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const isNewProject = prevProjectRef.current !== projectId;
    prevProjectRef.current = projectId;

    if (isNewProject) {
      fetchChats(projectId).then(() => setActiveChat(chatId));
    } else {
      setActiveChat(chatId);
    }
  }, [projectId, chatId, fetchChats, setActiveChat]);

  return (
    <div className={expanded
      ? 'absolute inset-0 z-10 flex flex-col bg-surface overflow-hidden'
      : 'w-[480px] shrink-0 border-l border-border flex flex-col bg-surface overflow-hidden'
    }>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-secondary/50">
        <span className="text-xs font-medium text-text-secondary truncate">
          {projectName}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-surface-secondary text-text-muted hover:text-text-primary transition-colors"
            title={expanded ? 'Collapse panel' : 'Expand panel'}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-secondary text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        <AgentChat
          projectId={projectId}
          onSendPrompt={onSendPrompt}
          onSendSilentPrompt={onSendSilentPrompt}
          onExecuteChat={onExecuteChat}
          onSendUserAnswer={onSendUserAnswer}
        />
      </div>
    </div>
  );
}
