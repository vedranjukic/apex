import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useCommandStore, type Command } from '../../stores/command-store';
import { formatShortcutDisplay } from '../../hooks/use-global-commands';
import { cn } from '../../lib/cn';

export function CommandPalette() {
  const open = useCommandStore((s) => s.paletteOpen);
  const closePalette = useCommandStore((s) => s.closePalette);
  const commands = useCommandStore((s) => s.commands);

  if (!open) return null;

  return (
    <CommandPaletteInner
      commands={commands}
      onClose={closePalette}
    />
  );
}

interface InnerProps {
  commands: Map<string, Command>;
  onClose: () => void;
}

function CommandPaletteInner({ commands, onClose }: InnerProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keybindings = useCommandStore((s) => s.keybindings);

  const allCommands = useMemo(
    () => Array.from(commands.values()).filter((c) => c.id !== 'commandPalette.open'),
    [commands],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q),
    );
  }, [allCommands, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Command[]>();
    for (const cmd of filtered) {
      const list = groups.get(cmd.category) || [];
      list.push(cmd);
      groups.set(cmd.category, list);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const executeSelected = useCallback(() => {
    const cmd = filtered[selectedIndex];
    if (cmd) {
      onClose();
      requestAnimationFrame(() => cmd.execute());
    }
  }, [filtered, selectedIndex, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          executeSelected();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered.length, executeSelected, onClose],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-xl bg-surface rounded-xl shadow-2xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-text-muted">
              No matching commands
            </div>
          ) : (
            Array.from(grouped.entries()).map(([category, cmds]) => (
              <div key={category}>
                <div className="px-4 pt-2 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    {category}
                  </span>
                </div>
                {cmds.map((cmd) => {
                  flatIndex++;
                  const isSelected = flatIndex === selectedIndex;
                  const idx = flatIndex;
                  const shortcut = keybindings[cmd.id];
                  return (
                    <button
                      key={cmd.id}
                      data-selected={isSelected}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'text-text-primary hover:bg-surface-secondary',
                      )}
                      onClick={() => {
                        onClose();
                        requestAnimationFrame(() => cmd.execute());
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="flex-1 text-left truncate">{cmd.label}</span>
                      {shortcut && (
                        <kbd className="text-[11px] font-mono text-text-muted bg-surface-secondary px-1.5 py-0.5 rounded border border-border">
                          {formatShortcutDisplay(shortcut)}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
