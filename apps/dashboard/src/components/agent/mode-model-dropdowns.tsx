import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Bot, ClipboardList, HelpCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  useAgentSettingsStore,
  AGENT_MODES,
  AGENT_MODELS,
  type AgentMode,
} from '../../stores/agent-settings-store';

const MODE_ICONS: Record<AgentMode, React.ReactNode> = {
  agent: <Bot className="w-3.5 h-3.5" />,
  plan: <ClipboardList className="w-3.5 h-3.5" />,
  ask: <HelpCircle className="w-3.5 h-3.5" />,
};

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

export function ModeDropdown() {
  const mode = useAgentSettingsStore((s) => s.mode);
  const setMode = useAgentSettingsStore((s) => s.setMode);
  const { open, ref, toggle, close } = useDropdown();

  const current = AGENT_MODES.find((m) => m.value === mode)!;

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
        {MODE_ICONS[mode]}
        <span>{current.label}</span>
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-52 rounded-lg border border-border bg-sidebar shadow-xl z-50 py-1">
          {AGENT_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => { setMode(m.value); close(); }}
              className={cn(
                'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
                'hover:bg-sidebar-hover',
                m.value === mode && 'bg-sidebar-active',
              )}
            >
              <span className="mt-0.5 text-text-secondary">{MODE_ICONS[m.value]}</span>
              <div>
                <div className="text-xs font-medium text-text-primary">{m.label}</div>
                <div className="text-[11px] text-text-muted leading-tight">{m.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ModelDropdown() {
  const model = useAgentSettingsStore((s) => s.model);
  const setModel = useAgentSettingsStore((s) => s.setModel);
  const { open, ref, toggle, close } = useDropdown();

  const current = AGENT_MODELS.find((m) => m.value === model)!;

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
        <span>{current.label}</span>
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-48 rounded-lg border border-border bg-sidebar shadow-xl z-50 py-1">
          {AGENT_MODELS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => { setModel(m.value); close(); }}
              className={cn(
                'w-full px-3 py-1.5 text-left text-xs transition-colors',
                'hover:bg-sidebar-hover',
                m.value === model
                  ? 'text-text-primary font-medium bg-sidebar-active'
                  : 'text-text-secondary',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
