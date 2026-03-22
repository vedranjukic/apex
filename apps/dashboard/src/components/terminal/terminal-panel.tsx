import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronDown, TerminalSquare } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminal-store';
import { TerminalTabs } from './terminal-tabs';
import { TerminalTab } from './terminal-tab';
import { PortsPanel } from '../ports/ports-panel';
import type { Terminal } from '@xterm/xterm';

interface TerminalPanelProps {
  projectId: string;
  sandboxReady: boolean;
  createTerminal: (
    terminalId: string,
    cols: number,
    rows: number,
    name?: string,
  ) => void;
  sendInput: (terminalId: string, data: string) => void;
  resize: (terminalId: string, cols: number, rows: number) => void;
  closeTerminal: (terminalId: string) => void;
  registerXterm: (terminalId: string, xterm: Terminal) => void;
  unregisterXterm: (terminalId: string) => void;
  requestPreviewUrl: (port: number) => Promise<{ url: string; token?: string }>;
  forwardPort: (port: number) => Promise<{ localPort: number; url: string }>;
  provider: string;
}

const MIN_PANEL_HEIGHT = 120;

export function TerminalPanel({
  sandboxReady,
  createTerminal,
  sendInput,
  resize,
  closeTerminal,
  registerXterm,
  unregisterXterm,
  requestPreviewUrl,
  forwardPort,
  provider,
}: TerminalPanelProps) {
  const terminals = useTerminalStore((s) => s.terminals);
  const terminalsLoaded = useTerminalStore((s) => s.terminalsLoaded);
  const bridgeResponded = useTerminalStore((s) => s.bridgeResponded);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const activeBottomTab = useTerminalStore((s) => s.activeBottomTab);
  const panelOpen = useTerminalStore((s) => s.panelOpen);
  const panelHeight = useTerminalStore((s) => s.panelHeight);
  const togglePanel = useTerminalStore((s) => s.togglePanel);
  const setPanelHeight = useTerminalStore((s) => s.setPanelHeight);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const getNextTerminalNumber = useTerminalStore((s) => s.getNextTerminalNumber);

  const handleCreateTerminal = useCallback(() => {
    const num = getNextTerminalNumber();
    const id = `term-${crypto.randomUUID().slice(0, 8)}`;
    const name = `Terminal ${num}`;
    addTerminal({ id, name, status: 'alive' });
    createTerminal(id, 80, 24, name);
  }, [createTerminal, addTerminal, getNextTerminalNumber]);

  const handleCloseTerminal = useCallback(
    (terminalId: string) => {
      closeTerminal(terminalId);
    },
    [closeTerminal],
  );

  const autoCreated = useRef(false);
  useEffect(() => {
    if (!terminalsLoaded || !bridgeResponded || !sandboxReady) return;
    if (autoCreated.current) return;
    if (terminals.length > 0) {
      autoCreated.current = true;
      return;
    }
    autoCreated.current = true;
    const id = `term-${crypto.randomUUID().slice(0, 8)}`;
    const num = getNextTerminalNumber();
    const name = `Terminal ${num}`;
    addTerminal({ id, name, status: 'alive' }, { silent: true });
    createTerminal(id, 80, 24, name);
  }, [terminalsLoaded, bridgeResponded, sandboxReady, terminals, addTerminal, createTerminal, getNextTerminalNumber]);

  // ── Drag resize ──

  const handleDragStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startHeight: panelHeight };

      const handleDragMove = (ev: globalThis.MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - ev.clientY;
        const newHeight = Math.max(
          MIN_PANEL_HEIGHT,
          dragRef.current.startHeight + delta,
        );
        setPanelHeight(newHeight);
      };

      const handleDragEnd = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
      };

      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
    },
    [panelHeight],
  );

  if (!panelOpen) {
    return null;
  }

  const showPorts = activeBottomTab === 'ports';

  return (
    <div
      className="flex flex-col border-t border-border"
      style={{ height: panelHeight, minHeight: MIN_PANEL_HEIGHT }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="h-1 cursor-row-resize bg-sidebar hover:bg-primary/40 transition-colors flex-shrink-0"
      />

      {/* Header: tabs + toggle */}
      <div className="flex items-center bg-sidebar flex-shrink-0 border-b border-border">
        <TerminalTabs
          onCreateTerminal={handleCreateTerminal}
          onCloseTerminal={handleCloseTerminal}
        />
        <button
          onClick={togglePanel}
          className="flex items-center gap-1 px-2 py-1 ml-auto text-xs text-text-muted hover:text-text-secondary transition-colors flex-shrink-0"
          title="Hide Panel"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Viewport */}
      <div className="flex-1 overflow-hidden bg-terminal-bg">
        {showPorts ? (
          <PortsPanel requestPreviewUrl={requestPreviewUrl} forwardPort={forwardPort} provider={provider} />
        ) : terminals.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            <button
              onClick={handleCreateTerminal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-sidebar transition-colors"
            >
              <TerminalSquare className="w-4 h-4" />
              <span>Create a terminal</span>
            </button>
          </div>
        ) : (
          terminals.map((t) => (
            <TerminalTab
              key={t.id}
              terminalId={t.id}
              isActive={t.id === activeTerminalId && !showPorts}
              onInput={sendInput}
              onResize={resize}
              registerXterm={registerXterm}
              unregisterXterm={unregisterXterm}
            />
          ))
        )}
      </div>
    </div>
  );
}
