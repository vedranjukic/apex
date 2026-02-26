import { Plus, X, TerminalSquare, Radio } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminal-store';
import { usePortsStore } from '../../stores/ports-store';
import { cn } from '../../lib/cn';

interface TerminalTabsProps {
  onCreateTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
}

export function TerminalTabs({
  onCreateTerminal,
  onCloseTerminal,
}: TerminalTabsProps) {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const activeBottomTab = useTerminalStore((s) => s.activeBottomTab);
  const setActive = useTerminalStore((s) => s.setActive);
  const setActiveBottomTab = useTerminalStore((s) => s.setActiveBottomTab);
  const portCount = usePortsStore((s) => s.ports.length);

  const isPortsActive = activeBottomTab === 'ports';

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-sidebar border-b border-border min-h-[36px] overflow-x-auto">
      {terminals.map((t) => {
        const isActive = t.id === activeTerminalId && !isPortsActive;
        return (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              'group flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-colors whitespace-nowrap',
              isActive
                ? 'bg-terminal-bg text-text-primary'
                : 'text-text-muted hover:text-text-secondary hover:bg-terminal-bg/50',
            )}
          >
            <TerminalSquare className="w-3 h-3" />
            <span>{t.name}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTerminal(t.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  onCloseTerminal(t.id);
                }
              }}
              className="ml-1 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        );
      })}

      <button
        onClick={onCreateTerminal}
        className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
        title="New Terminal"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <div className="ml-auto flex items-center">
        <button
          onClick={() => setActiveBottomTab('ports')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-colors whitespace-nowrap',
            isPortsActive
              ? 'bg-terminal-bg text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-terminal-bg/50',
          )}
          title="Forwarded Ports"
        >
          <Radio className="w-3 h-3" />
          <span>Ports</span>
          {portCount > 0 && (
            <span className="ml-0.5 px-1.5 py-0 rounded-full bg-primary/20 text-primary text-[10px] leading-4 font-medium">
              {portCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
