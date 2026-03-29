import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

export interface EditorMenuAction {
  type: 'action';
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
}

export interface EditorMenuSeparator {
  type: 'separator';
}

export type EditorMenuItem = EditorMenuAction | EditorMenuSeparator;

interface EditorContextMenuProps {
  x: number;
  y: number;
  items: EditorMenuItem[];
  onAction: (id: string) => void;
  onClose: () => void;
}

export function EditorContextMenu({ x, y, items, onAction, onClose }: EditorContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') {
        onClose();
        return;
      }
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

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      ref.current.style.left = `${Math.max(4, x - rect.width)}px`;
    }
    if (rect.bottom > vh) {
      ref.current.style.top = `${Math.max(4, y - rect.height)}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[220px] rounded-md border border-panel-border bg-surface-secondary py-1 shadow-xl text-[13px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={`sep-${i}`} className="my-1 h-px bg-panel-border mx-2" />;
        }
        return (
          <button
            key={item.id}
            disabled={item.disabled}
            className={cn(
              'flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left',
              item.disabled
                ? 'text-text-muted cursor-default'
                : 'text-panel-text-muted hover:bg-sidebar-hover hover:text-panel-text',
            )}
            onClick={() => {
              if (!item.disabled) {
                onAction(item.id);
                onClose();
              }
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-[11px] text-text-muted ml-4">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
