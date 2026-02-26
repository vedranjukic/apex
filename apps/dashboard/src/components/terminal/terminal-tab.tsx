import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useThemeStore } from '../../stores/theme-store';
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
  const themeId = useThemeStore((s) => s.themeId);

  // Create xterm instance on mount
  useEffect(() => {
    if (!containerRef.current) return;
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

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore if not visible yet
      }
    });

    xterm.onData((data) => {
      onInput(terminalId, data);
    });

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;
    registerXterm(terminalId, xterm);

    return () => {
      unregisterXterm(terminalId);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  // Fit when active tab changes or container resizes
  const handleFit = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current) return;
    try {
      fitAddonRef.current.fit();
      const { cols, rows } = xtermRef.current;
      onResize(terminalId, cols, rows);
    } catch {
      // ignore
    }
  }, [terminalId, onResize]);

  useEffect(() => {
    if (isActive) {
      // Re-fit when tab becomes active
      requestAnimationFrame(handleFit);
    }
  }, [isActive, handleFit]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (!xtermRef.current) return;
    const t = themes[themeId];
    xtermRef.current.options.theme = t.terminalTheme;
  }, [themeId]);

  // Watch for container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isActive) handleFit();
    });
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
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
