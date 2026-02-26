import { useEffect, useRef } from 'react';
import { FilePlus, FolderPlus, Pencil, Trash2 } from 'lucide-react';

export interface ContextMenuAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  danger?: boolean;
}

interface FileContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function FileContextMenu({ x, y, actions, onClose }: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

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

export function buildFileActions(opts: {
  path: string;
  isDirectory: boolean;
  isRoot: boolean;
  onNewFile: (parentDir: string) => void;
  onNewFolder: (parentDir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];
  const parentDir = opts.isDirectory ? opts.path : opts.path.substring(0, opts.path.lastIndexOf('/'));

  actions.push({
    label: 'New File',
    icon: FilePlus,
    onClick: () => opts.onNewFile(parentDir),
  });
  actions.push({
    label: 'New Folder',
    icon: FolderPlus,
    onClick: () => opts.onNewFolder(parentDir),
  });

  if (!opts.isRoot) {
    actions.push({
      label: 'Rename',
      icon: Pencil,
      onClick: () => opts.onRename(opts.path),
    });
    actions.push({
      label: 'Delete',
      icon: Trash2,
      onClick: () => opts.onDelete(opts.path),
      danger: true,
    });
  }

  return actions;
}
