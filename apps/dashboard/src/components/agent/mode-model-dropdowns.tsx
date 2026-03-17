import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Hammer, ClipboardList, Network } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  useAgentSettingsStore,
  AGENTS,
  getModelsForAgent,
} from '../../stores/agent-settings-store';

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  return { open, ref, toggle, close };
}

const AGENT_ICONS: Record<string, React.ReactNode> = {
  build: <Hammer className="w-3.5 h-3.5" />,
  plan: <ClipboardList className="w-3.5 h-3.5" />,
  sisyphus: <Network className="w-3.5 h-3.5" />,
};

export function AgentDropdown() {
  const agentType = useAgentSettingsStore((s) => s.agentType);
  const setAgentType = useAgentSettingsStore((s) => s.setAgentType);
  const { open, ref, toggle, close } = useDropdown();

  const current = AGENTS.find((a) => a.value === agentType) ?? AGENTS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
          'text-text-secondary hover:text-text-primary hover:bg-sidebar-hover',
          open && 'bg-sidebar-hover text-text-primary',
        )}
      >
        {AGENT_ICONS[agentType] ?? <Hammer className="w-3.5 h-3.5" />}
        <span>{current.label}</span>
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-52 rounded-lg border border-border bg-sidebar shadow-xl z-50 py-1">
          {AGENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => { setAgentType(a.value); close(); }}
              className={cn(
                'w-full flex items-start gap-2 px-3 py-2 text-left transition-colors',
                'hover:bg-sidebar-hover',
                a.value === agentType && 'bg-sidebar-active',
              )}
            >
              <span className="mt-0.5 text-text-secondary">
                {AGENT_ICONS[a.value] ?? <Hammer className="w-3.5 h-3.5" />}
              </span>
              <div>
                <div className="text-xs font-medium text-text-primary">{a.label}</div>
                <div className="text-[11px] text-text-muted leading-tight">{a.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** @deprecated Replaced by AgentDropdown — kept for backward compat */
export const ModeDropdown = AgentDropdown;

/**
 * Model selector — combobox with suggestions and free-text input.
 * Users can pick from the suggestion list OR type any provider/model ID
 * that OpenCode supports (e.g., "anthropic/claude-sonnet-4-20250514").
 */
export function ModelDropdown() {
  const agentType = useAgentSettingsStore((s) => s.agentType);
  const model = useAgentSettingsStore((s) => s.model);
  const setModel = useAgentSettingsStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const availableModels = getModelsForAgent(agentType);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const displayLabel = model
    ? (availableModels.find((m) => m.value === model)?.label ?? model)
    : 'Auto';

  const filtered = query
    ? availableModels.filter(
        (m) =>
          m.label.toLowerCase().includes(query.toLowerCase()) ||
          m.value.toLowerCase().includes(query.toLowerCase()),
      )
    : availableModels;

  const handleOpen = () => {
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectModel = (value: string) => {
    setModel(value);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed) {
        const exact = filtered.find(
          (m) => m.value.toLowerCase() === trimmed.toLowerCase(),
        );
        selectModel(exact ? exact.value : trimmed);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
          'text-text-secondary hover:text-text-primary hover:bg-sidebar-hover',
          open && 'bg-sidebar-hover text-text-primary',
        )}
      >
        <span className="max-w-[140px] truncate">{displayLabel}</span>
        <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-72 rounded-lg border border-border bg-sidebar shadow-xl z-50">
          <div className="p-1.5 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type provider/model or search…"
              className="w-full px-2 py-1 text-xs bg-transparent border border-border rounded focus:outline-none focus:border-primary text-text-primary placeholder:text-text-muted"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length > 0 ? (
              filtered.map((m, i) => (
                <button
                  key={m.value || `auto-${i}`}
                  type="button"
                  onClick={() => selectModel(m.value)}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs transition-colors',
                    'hover:bg-sidebar-hover',
                    m.value === model
                      ? 'text-text-primary font-medium bg-sidebar-active'
                      : 'text-text-secondary',
                  )}
                >
                  <span>{m.label}</span>
                  {m.value && (
                    <span className="ml-1.5 text-text-muted opacity-60">{m.value}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-text-muted">
                Press Enter to use <span className="font-mono text-text-secondary">{query}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
