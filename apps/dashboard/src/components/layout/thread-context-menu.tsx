import { useEffect, useRef } from 'react';
import { GitFork, Pencil, Trash2 } from 'lucide-react';
import type { Thread } from '../../api/client';

export interface ContextMenuAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  danger?: boolean;
}

interface ThreadContextMenuProps {
  x: number;
  y: number;
  thread: Thread;
  onRename: (thread: Thread) => void;
  onFork: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
  onClose: () => void;
}

export function ThreadContextMenu({ x, y, thread, onRename, onFork, onDelete, onClose }: ThreadContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const actions = buildThreadActions({ thread, onRename, onFork, onDelete });

  useEffect(() => {
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') { onClose(); return; }
      if (e instanceof MouseEvent && ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-md border border-panel-border bg-surface-secondary py-1 shadow-xl text-[13px]"
      style={{ left: x, top: y }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          className={[
            'flex w-full items-center gap-2 px-3 py-1.5 text-left',
            'hover:bg-sidebar-hover',
            action.danger ? 'text-red-400 hover:text-red-300' : 'text-panel-text-muted hover:text-panel-text',
          ].join(' ')}
          onClick={() => { action.onClick(); onClose(); }}
        >
          <action.icon className="w-3.5 h-3.5 shrink-0" />
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function buildThreadActions(opts: {
  thread: Thread;
  onRename: (thread: Thread) => void;
  onFork: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
}): ContextMenuAction[] {
  return [
    {
      label: 'Rename',
      icon: Pencil,
      onClick: () => opts.onRename(opts.thread),
    },
    {
      label: 'Fork',
      icon: GitFork,
      onClick: () => opts.onFork(opts.thread),
    },
    {
      label: 'Delete',
      icon: Trash2,
      onClick: () => opts.onDelete(opts.thread),
      danger: true,
    },
  ];
}