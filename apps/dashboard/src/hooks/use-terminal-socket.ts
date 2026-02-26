import { useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { useTerminalStore, type TerminalInfo } from '../stores/terminal-store';

/**
 * Buffered xterm map — stores xterm instances and buffers events
 * that arrive before the xterm is registered.
 */
class XtermRegistry {
  private map = new Map<string, Terminal>();
  private buffers = new Map<string, Array<{ type: string; data: any }>>();

  get(id: string): Terminal | undefined {
    return this.map.get(id);
  }

  values(): IterableIterator<Terminal> {
    return this.map.values();
  }

  entries(): IterableIterator<[string, Terminal]> {
    return this.map.entries();
  }

  register(id: string, xterm: Terminal) {
    this.map.set(id, xterm);
    const buf = this.buffers.get(id);
    if (buf) {
      for (const evt of buf) {
        if (evt.type === 'output') {
          xterm.write(evt.data);
        } else if (evt.type === 'created') {
          xterm.clear();
        } else if (evt.type === 'error') {
          xterm.write(`\r\n\x1b[31m[Error: ${evt.data}]\x1b[0m\r\n`);
        } else if (evt.type === 'exit') {
          xterm.write(
            `\r\n\x1b[90m[Process exited with code ${evt.data}]\x1b[0m\r\n`,
          );
        }
      }
    }
  }

  unregister(id: string) {
    this.map.delete(id);
  }

  destroy(id: string) {
    this.map.delete(id);
    this.buffers.delete(id);
  }

  clearBuffer(id: string) {
    this.buffers.delete(id);
  }

  /** Dispose all xterm instances and clear everything */
  clear() {
    for (const xterm of this.map.values()) {
      xterm.dispose();
    }
    this.map.clear();
    this.buffers.clear();
  }

  writeOutput(id: string, data: string) {
    const xterm = this.map.get(id);
    if (xterm) {
      xterm.write(data);
    } else {
      this.buffer(id, { type: 'output', data });
    }
  }

  markCreated(id: string) {
    const xterm = this.map.get(id);
    if (xterm) {
      xterm.clear();
    } else {
      this.buffer(id, { type: 'created', data: null });
    }
  }

  writeError(id: string, error: string) {
    const xterm = this.map.get(id);
    if (xterm) {
      xterm.write(`\r\n\x1b[31m[Error: ${error}]\x1b[0m\r\n`);
    } else {
      this.buffer(id, { type: 'error', data: error });
    }
  }

  writeExit(id: string, exitCode: number) {
    const xterm = this.map.get(id);
    if (xterm) {
      xterm.write(
        `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
      );
    } else {
      this.buffer(id, { type: 'exit', data: exitCode });
    }
  }

  broadcastError(error: string) {
    for (const xterm of this.map.values()) {
      xterm.write(`\r\n\x1b[31m[Error: ${error}]\x1b[0m\r\n`);
    }
  }

  private buffer(id: string, evt: { type: string; data: any }) {
    if (!this.buffers.has(id)) {
      this.buffers.set(id, []);
    }
    this.buffers.get(id)!.push(evt);
  }
}

/**
 * Hook that wires up terminal Socket.io events to xterm.js instances.
 * Shares the Socket.io connection from useAgentSocket.
 *
 * All terminal state is scoped to the current projectId — switching
 * projects clears the store and xterm registry immediately.
 */
export function useTerminalSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
) {
  const registry = useRef(new XtermRegistry());
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const setTerminals = useTerminalStore((s) => s.setTerminals);
  const bindProject = useTerminalStore((s) => s.bindProject);
  const reset = useTerminalStore((s) => s.reset);

  // ── Listen for terminal events from the server ──
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId) return;

    // Scope the store + registry to this project.
    // If projectId changed, this wipes stale terminals from the previous project.
    bindProject(projectId);
    registry.current.clear();

    // Capture the projectId this effect was created for.
    // All event handlers check this to ignore stale events.
    const boundProjectId = projectId;

    const isStale = () =>
      useTerminalStore.getState().projectId !== boundProjectId;

    const reg = registry.current;

    const onTerminalCreated = (data: { terminalId: string; name: string }) => {
      if (isStale()) return;
      console.log('[ws] terminal_created:', data);
      addTerminal({ id: data.terminalId, name: data.name, status: 'alive' });
      reg.markCreated(data.terminalId);
    };

    const onTerminalOutput = (data: { terminalId: string; data: string }) => {
      if (isStale()) return;
      reg.writeOutput(data.terminalId, data.data);
    };

    const onTerminalExit = (data: { terminalId: string; exitCode: number }) => {
      if (isStale()) return;
      console.log('[ws] terminal_exit:', data);
      reg.writeExit(data.terminalId, data.exitCode);
      removeTerminal(data.terminalId);
    };

    const onTerminalError = (data: { terminalId?: string; error: string }) => {
      if (isStale()) return;
      console.error('[ws] terminal_error:', data);
      if (data.terminalId) {
        reg.writeError(data.terminalId, data.error);
      } else {
        reg.broadcastError(data.error);
      }
    };

    const onTerminalList = (data: {
      terminals: Array<{
        id: string;
        name: string;
        cols: number;
        rows: number;
        scrollback: string;
      }>;
    }) => {
      if (isStale()) return;
      console.log('[ws] terminal_list:', data.terminals.length, 'terminals');

      const infos: TerminalInfo[] = data.terminals.map((t) => ({
        id: t.id,
        name: t.name,
        status: 'alive' as const,
      }));
      setTerminals(infos);

      for (const t of data.terminals) {
        reg.clearBuffer(t.id);
        if (t.scrollback) {
          reg.writeOutput(t.id, t.scrollback);
        }
      }
    };

    socket.on('terminal_created', onTerminalCreated);
    socket.on('terminal_output', onTerminalOutput);
    socket.on('terminal_exit', onTerminalExit);
    socket.on('terminal_error', onTerminalError);
    socket.on('terminal_list', onTerminalList);

    const TERMINAL_LIST_TIMEOUT_MS = 8_000;
    let terminalListTimer: ReturnType<typeof setTimeout> | null = null;

    const ensureTerminalsLoaded = () => {
      if (terminalListTimer) clearTimeout(terminalListTimer);
      terminalListTimer = setTimeout(() => {
        if (isStale()) return;
        if (!useTerminalStore.getState().terminalsLoaded) {
          console.warn('[ws] terminal_list timed out — unblocking UI with empty list');
          setTerminals([]);
        }
      }, TERMINAL_LIST_TIMEOUT_MS);
    };

    const requestTerminals = () => {
      if (isStale()) return;
      socket.emit('terminal_list', { projectId: boundProjectId });
      ensureTerminalsLoaded();
    };

    const onConnect = () => requestTerminals();

    if (socket.connected) {
      requestTerminals();
    }
    socket.on('connect', onConnect);

    return () => {
      socket.off('terminal_created', onTerminalCreated);
      socket.off('terminal_output', onTerminalOutput);
      socket.off('terminal_exit', onTerminalExit);
      socket.off('terminal_error', onTerminalError);
      socket.off('terminal_list', onTerminalList);
      socket.off('connect', onConnect);
      if (terminalListTimer) clearTimeout(terminalListTimer);
      // Don't reset here — bindProject handles it on next mount
    };
  }, [projectId, socketRef, addTerminal, removeTerminal, setTerminals, bindProject, reset]);

  // ── Actions ──

  const createTerminal = useCallback(
    (terminalId: string, cols: number, rows: number, name?: string) => {
      if (!projectId) return;
      socketRef.current?.emit('terminal_create', {
        projectId,
        terminalId,
        cols,
        rows,
        name,
      });
    },
    [projectId, socketRef],
  );

  const sendInput = useCallback(
    (terminalId: string, data: string) => {
      if (!projectId) return;
      socketRef.current?.emit('terminal_input', {
        projectId,
        terminalId,
        data,
      });
    },
    [projectId, socketRef],
  );

  const resize = useCallback(
    (terminalId: string, cols: number, rows: number) => {
      if (!projectId) return;
      socketRef.current?.emit('terminal_resize', {
        projectId,
        terminalId,
        cols,
        rows,
      });
    },
    [projectId, socketRef],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      if (!projectId) return;
      socketRef.current?.emit('terminal_close', {
        projectId,
        terminalId,
      });
      const xterm = registry.current.get(terminalId);
      if (xterm) {
        xterm.dispose();
      }
      registry.current.destroy(terminalId);
      removeTerminal(terminalId);
    },
    [projectId, socketRef, removeTerminal],
  );

  const requestTerminalList = useCallback(() => {
    if (!projectId) return;
    socketRef.current?.emit('terminal_list', { projectId });
  }, [projectId, socketRef]);

  const registerXterm = useCallback(
    (terminalId: string, xterm: Terminal) => {
      registry.current.register(terminalId, xterm);
    },
    [],
  );

  const unregisterXterm = useCallback(
    (terminalId: string) => {
      registry.current.unregister(terminalId);
    },
    [],
  );

  return {
    createTerminal,
    sendInput,
    resize,
    closeTerminal,
    requestTerminalList,
    registerXterm,
    unregisterXterm,
  };
}
