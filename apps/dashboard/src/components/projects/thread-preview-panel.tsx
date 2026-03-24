import { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { AgentThread } from '../agent/agent-thread';
import { useThreadsStore } from '../../stores/tasks-store';
import type { CodeSelection } from '../../stores/editor-store';
import type { ImageAttachment } from '../agent/prompt-input';

interface Props {
  projectId: string;
  threadId: string | null;
  projectName: string;
  onClose: () => void;
  onSendPrompt: (threadId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => void;
  onSendSilentPrompt: (threadId: string, prompt: string, mode?: string, model?: string, agentType?: string) => void;
  onExecuteThread: (threadId: string, mode?: string, model?: string) => void;
  onSendUserAnswer: (threadId: string, toolUseId: string, answer: string) => void;
  onStopAgent?: (threadId: string) => void;
}

export function ThreadPreviewPanel({
  projectId,
  threadId,
  projectName,
  onClose,
  onSendPrompt,
  onSendSilentPrompt,
  onExecuteThread,
  onSendUserAnswer,
  onStopAgent,
}: Props) {
  const fetchThreads = useThreadsStore((s) => s.fetchThreads);
  const setActiveThread = useThreadsStore((s) => s.setActiveThread);
  const startNewThread = useThreadsStore((s) => s.startNewThread);
  const prevProjectRef = useRef<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const isNewProject = prevProjectRef.current !== projectId;
    prevProjectRef.current = projectId;

    if (!threadId) {
      if (isNewProject) {
        fetchThreads(projectId).then(() => startNewThread());
      } else {
        startNewThread();
      }
      return;
    }

    if (isNewProject) {
      fetchThreads(projectId).then(() => setActiveThread(threadId));
    } else {
      setActiveThread(threadId);
    }
  }, [projectId, threadId, fetchThreads, setActiveThread, startNewThread]);

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
        <AgentThread
          projectId={projectId}
          onSendPrompt={onSendPrompt}
          onSendSilentPrompt={onSendSilentPrompt}
          onExecuteThread={onExecuteThread}
          onSendUserAnswer={onSendUserAnswer}
          onStopAgent={onStopAgent}
        />
      </div>
    </div>
  );
}
