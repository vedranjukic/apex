import { useState, useCallback } from 'react';
import { ScrollText, ChevronDown, ChevronRight, Play, Loader2, Check, ArrowRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useThreadActions } from './thread-actions-context';
import { useAgentSettingsStore } from '../../stores/agent-settings-store';
import { BUILD_PROMPT_PREFIX } from '../../stores/plan-store';

interface PlanBlockProps {
  filename: string;
  content: string;
  isComplete: boolean;
  wasBuilt?: boolean;
  threadStatus?: string;
}

export function PlanBlock({ filename, content, isComplete, wasBuilt, threadStatus }: PlanBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const { sendSilentPrompt } = useThreadActions();
  const agentType = useAgentSettingsStore((s) => s.agentType);
  const isRunning = threadStatus === 'running';
  const actionDisabled = !isComplete || isRunning || !!wasBuilt;
  const isPlanAgent = agentType === 'plan';

  const handleAction = useCallback(() => {
    if (actionDisabled) return;
    if (isPlanAgent) {
      useAgentSettingsStore.getState().setAgentType('build');
      sendSilentPrompt(`${BUILD_PROMPT_PREFIX}${content}`, 'agent', 'build');
    } else {
      sendSilentPrompt('Continue. Execute the tasks outlined above.');
    }
  }, [content, actionDisabled, isPlanAgent, sendSilentPrompt]);

  return (
    <div className="rounded-md overflow-hidden border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1 text-text-secondary text-xs hover:bg-surface-secondary/50 transition-colors"
      >
        <ScrollText className="w-3 h-3 text-primary shrink-0" />
        <span className="font-bold text-text-primary truncate">{filename}</span>
        {!isComplete && (
          <Loader2 className="w-3 h-3 animate-spin text-yellow-500 shrink-0" />
        )}
        {isComplete && (
          <span className="text-[10px] px-1 py-px rounded bg-accent/15 text-accent font-medium shrink-0">
            READY
          </span>
        )}
        <span className="ml-auto shrink-0">
          {expanded
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>

      {expanded && (
        <div className="px-2.5 py-2 bg-surface-secondary overflow-x-auto border-t border-border">
          <article className="plan-markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </article>
        </div>
      )}

      <div className="flex items-center justify-between px-2.5 py-1 bg-surface-secondary border-t border-border">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-text-secondary flex items-center gap-1 hover:text-text-primary transition-colors"
        >
          {expanded
            ? <><ChevronDown className="w-3 h-3" /> Collapse</>
            : <><ChevronRight className="w-3 h-3" /> Expand</>}
        </button>
        <button
          onClick={handleAction}
          disabled={actionDisabled}
          className={[
            'flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium transition-all',
            actionDisabled
              ? 'bg-surface text-text-muted border border-border cursor-not-allowed opacity-60'
              : 'bg-primary text-on-primary hover:bg-primary-hover cursor-pointer',
          ].join(' ')}
        >
          {isRunning
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</>
            : wasBuilt
              ? <><Check className="w-3 h-3" /> Done</>
              : isComplete
                ? isPlanAgent
                  ? <><Play className="w-3 h-3" /> Build</>
                  : <><ArrowRight className="w-3 h-3" /> Continue</>
                : <><Loader2 className="w-3 h-3 animate-spin" /> Preparing…</>}
        </button>
      </div>
    </div>
  );
}
