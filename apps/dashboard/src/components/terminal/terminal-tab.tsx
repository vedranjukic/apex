import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useThemeStore } from '../../stores/theme-store';
import { useTerminalStore } from '../../stores/terminal-store';
import { themes } from '../../lib/themes';

interface TerminalTabProps {
  terminalId: string;
  isActive: boolean;
  onInput: (terminalId: string, data: string) => void;
  onResize: (terminalId: string, cols: number, rows: number) => void;
  registerXterm: (terminalId: string, xterm: Terminal) => void;
  unregisterXterm: (terminalId: string) => void;
}

export function TerminalTab({
  terminalId,
  isActive,
  onInput,
  onResize,
  registerXterm,
  unregisterXterm,
}: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const registeredRef = useRef(false);
  const themeId = useThemeStore((s) => s.themeId);
  const panelOpen = useTerminalStore((s) => s.panelOpen);

  // Create xterm instance on mount
  useEffect(() => {
    if (!containerRef.current) return;
    registeredRef.current = false;
    const currentTheme = themes[useThemeStore.getState().themeId];

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: currentTheme.terminalTheme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);

    xterm.onData((data) => {
      onInput(terminalId, data);
    });

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;
    lastSizeRef.current = null;

    return () => {
      registeredRef.current = false;
      unregisterXterm(terminalId);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      lastSizeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  const handleFit = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current) return;
    try {
      fitAddonRef.current.fit();
      const { cols, rows } = xtermRef.current;
      const prev = lastSizeRef.current;
      if (prev && prev.cols === cols && prev.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      onResize(terminalId, cols, rows);
    } catch {
      // ignore
    }
  }, [terminalId, onResize]);

  // Register xterm (replay buffered scrollback) only when the tab is
  // visible so fit() returns correct dimensions. Hidden tabs (display:none)
  // would produce wrong dimensions and garbled scrollback.
  useEffect(() => {
    if (isActive && panelOpen && xtermRef.current && !registeredRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!xtermRef.current || registeredRef.current) return;
          handleFit();
          registeredRef.current = true;
          registerXterm(terminalId, xtermRef.current);
        });
      });
    }
  }, [isActive, panelOpen, terminalId, registerXterm, handleFit]);

  useEffect(() => {
    if (isActive && panelOpen && registeredRef.current) {
      requestAnimationFrame(() => {
        handleFit();
        xtermRef.current?.refresh(0, xtermRef.current.rows - 1);
      });
    }
  }, [isActive, panelOpen, handleFit]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (!xtermRef.current) return;
    const t = themes[themeId];
    xtermRef.current.options.theme = t.terminalTheme;
  }, [themeId]);

  // Watch for container resize (debounced to avoid SIGWINCH storms)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (!isActive) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { rafId = null; handleFit(); });
    });
    resizeObserver.observe(el);
    return () => {
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isActive, handleFit]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-terminal-bg"
      style={{
        display: isActive ? 'block' : 'none',
        padding: '4px',
      }}
    />
  );
}
