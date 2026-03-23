import { useEffect, useCallback, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { Terminal } from '@xterm/xterm';
import { useTerminalStore, type TerminalInfo } from '../stores/terminal-store';

class XtermRegistry {
  private map = new Map<string, Terminal>();
  private buffers = new Map<string, Array<{ type: string; data: any }>>();
  private pendingScrollback = new Map<string, { data: string; cols: number; rows: number }>();

  get(id: string): Terminal | undefined { return this.map.get(id); }
  values(): IterableIterator<Terminal> { return this.map.values(); }
  entries(): IterableIterator<[string, Terminal]> { return this.map.entries(); }

  /** Store scrollback with its original terminal dimensions for proper replay. */
  setScrollback(id: string, data: string, cols: number, rows: number) {
    this.pendingScrollback.set(id, { data, cols, rows });
  }

  register(id: string, xterm: Terminal) {
    this.map.set(id, xterm);

    // Replay pending scrollback at the dimensions it was captured at,
    // then resize back to the fitted dimensions.
    const sb = this.pendingScrollback.get(id);
    if (sb) {
      const fittedCols = xterm.cols;
      const fittedRows = xterm.rows;
      xterm.resize(sb.cols, sb.rows);
      xterm.write(sb.data);
      if (fittedCols !== sb.cols || fittedRows !== sb.rows) {
        xterm.resize(fittedCols, fittedRows);
      }
      this.pendingScrollback.delete(id);
    }

    // Then replay any other buffered events (real-time output that
    // arrived between terminal_list and xterm mount).
    const buf = this.buffers.get(id);
    if (buf) {
      for (const evt of buf) {
        if (evt.type === 'output') xterm.write(evt.data);
        else if (evt.type === 'created') xterm.clear();
        else if (evt.type === 'error') xterm.write(`\r\n\x1b[31m[Error: ${evt.data}]\x1b[0m\r\n`);
        else if (evt.type === 'exit') xterm.write(`\r\n\x1b[90m[Process exited with code ${evt.data}]\x1b[0m\r\n`);
      }
    }
  }

  unregister(id: string) { this.map.delete(id); }
  destroy(id: string) { this.map.delete(id); this.buffers.delete(id); this.pendingScrollback.delete(id); }
  clearBuffer(id: string) { this.buffers.delete(id); }

  clear() {
    for (const xterm of this.map.values()) xterm.dispose();
    this.map.clear(); this.buffers.clear(); this.pendingScrollback.clear();
  }

  writeOutput(id: string, data: string) {
    const xterm = this.map.get(id);
    if (xterm) xterm.write(data);
    else this.buffer(id, { type: 'output', data });
  }

  markCreated(id: string) {
    const xterm = this.map.get(id);
    if (xterm) xterm.clear();
    else this.buffer(id, { type: 'created', data: null });
  }

  writeError(id: string, error: string) {
    const xterm = this.map.get(id);
    if (xterm) xterm.write(`\r\n\x1b[31m[Error: ${error}]\x1b[0m\r\n`);
    else this.buffer(id, { type: 'error', data: error });
  }

  writeExit(id: string, exitCode: number) {
    const xterm = this.map.get(id);
    if (xterm) xterm.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
    else this.buffer(id, { type: 'exit', data: exitCode });
  }

  broadcastError(error: string) {
    for (const xterm of this.map.values()) xterm.write(`\r\n\x1b[31m[Error: ${error}]\x1b[0m\r\n`);
  }

  private buffer(id: string, evt: { type: string; data: any }) {
    if (!this.buffers.has(id)) this.buffers.set(id, []);
    this.buffers.get(id)!.push(evt);
  }
}

export function useTerminalSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const registry = useRef(new XtermRegistry());
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setTerminals = useTerminalStore((s) => s.setTerminals);
  const bindProject = useTerminalStore((s) => s.bindProject);
  const reset = useTerminalStore((s) => s.reset);

  useEffect(() => {
    const ws = socketRef.current;
    if (!ws || !projectId) return;

    bindProject(projectId);
    registry.current.clear();
    const boundProjectId = projectId;
    const isStale = () => useTerminalStore.getState().projectId !== boundProjectId;
    const reg = registry.current;

    const onTerminalCreated = (data: any) => {
      if (isStale()) return;
      const d = data.payload;
      addTerminal({ id: d.terminalId, name: d.name, status: 'alive' });
      reg.markCreated(d.terminalId);
    };
    const onTerminalOutput = (data: any) => {
      if (isStale()) return;
      reg.writeOutput(data.payload.terminalId, data.payload.data);
    };
    const onTerminalExit = (data: any) => {
      if (isStale()) return;
      reg.writeExit(data.payload.terminalId, data.payload.exitCode);
      removeTerminal(data.payload.terminalId);
    };
    const onTerminalError = (data: any) => {
      if (isStale()) return;
      if (data.payload.terminalId) reg.writeError(data.payload.terminalId, data.payload.error);
      else reg.broadcastError(data.payload.error);
    };
    const onTerminalList = (data: any) => {
      if (isStale()) return;
      const terminals = data.payload.terminals || [];
      const newIds = new Set(terminals.map((t: any) => t.id));

      // Dispose xterm instances for terminals no longer in the bridge
      for (const [id] of reg.entries()) {
        if (!newIds.has(id)) reg.destroy(id);
      }

      const infos: TerminalInfo[] = terminals.map((t: any) => ({ id: t.id, name: t.name, status: 'alive' as const }));
      setTerminals(infos, true);
      for (const t of terminals) {
        reg.clearBuffer(t.id);
        if (t.scrollback) {
          const xterm = reg.get(t.id);
          if (xterm) {
            // xterm already mounted — write scrollback at original dimensions
            const fittedCols = xterm.cols;
            const fittedRows = xterm.rows;
            xterm.reset();
            xterm.resize(t.cols || 80, t.rows || 24);
            xterm.write(t.scrollback);
            if (fittedCols !== (t.cols || 80) || fittedRows !== (t.rows || 24)) {
              xterm.resize(fittedCols, fittedRows);
            }
          } else {
            // xterm not yet mounted — store for replay at correct dimensions
            reg.setScrollback(t.id, t.scrollback, t.cols || 80, t.rows || 24);
          }
        }
      }
    };

    ws.on('terminal_created', onTerminalCreated);
    ws.on('terminal_output', onTerminalOutput);
    ws.on('terminal_exit', onTerminalExit);
    ws.on('terminal_error', onTerminalError);
    ws.on('terminal_list', onTerminalList);

    const TERMINAL_LIST_TIMEOUT_MS = 8_000;
    let terminalListTimer: ReturnType<typeof setTimeout> | null = null;

    const ensureTerminalsLoaded = () => {
      if (terminalListTimer) clearTimeout(terminalListTimer);
      terminalListTimer = setTimeout(() => {
        if (isStale()) return;
        if (!useTerminalStore.getState().terminalsLoaded) setTerminals([]);
      }, TERMINAL_LIST_TIMEOUT_MS);
    };

    const requestTerminals = () => {
      if (isStale()) return;
      ws.send('terminal_list', { projectId: boundProjectId });
      ensureTerminalsLoaded();
    };

    const onConnect = () => requestTerminals();
    ws.onStatus(onConnect);
    if (ws.connected) requestTerminals();

    return () => {
      ws.off('terminal_created', onTerminalCreated);
      ws.off('terminal_output', onTerminalOutput);
      ws.off('terminal_exit', onTerminalExit);
      ws.off('terminal_error', onTerminalError);
      ws.off('terminal_list', onTerminalList);
      ws.offStatus(onConnect);
      if (terminalListTimer) clearTimeout(terminalListTimer);
    };
  }, [projectId, socketRef, addTerminal, removeTerminal, setTerminals, bindProject, reset]);

  const createTerminal = useCallback(
    (terminalId: string, cols: number, rows: number, name?: string) => {
      if (!projectId) return;
      socketRef.current?.send('terminal_create', { projectId, terminalId, cols, rows, name });
    }, [projectId, socketRef],
  );
  const sendInput = useCallback(
    (terminalId: string, data: string) => {
      if (!projectId) return;
      socketRef.current?.send('terminal_input', { projectId, terminalId, data });
    }, [projectId, socketRef],
  );
  const resize = useCallback(
    (terminalId: string, cols: number, rows: number) => {
      if (!projectId) return;
      socketRef.current?.send('terminal_resize', { projectId, terminalId, cols, rows });
    }, [projectId, socketRef],
  );
  const closeTerminal = useCallback(
    (terminalId: string) => {
      if (!projectId) return;
      socketRef.current?.send('terminal_close', { projectId, terminalId });
      const xterm = registry.current.get(terminalId);
      if (xterm) xterm.dispose();
      registry.current.destroy(terminalId);
      removeTerminal(terminalId);
    }, [projectId, socketRef, removeTerminal],
  );
  const requestTerminalList = useCallback(() => {
    if (!projectId) return;
    socketRef.current?.send('terminal_list', { projectId });
  }, [projectId, socketRef]);
  const registerXterm = useCallback((terminalId: string, xterm: Terminal) => { registry.current.register(terminalId, xterm); }, []);
  const unregisterXterm = useCallback((terminalId: string) => { registry.current.unregister(terminalId); }, []);

  return { createTerminal, sendInput, resize, closeTerminal, requestTerminalList, registerXterm, unregisterXterm };
}
