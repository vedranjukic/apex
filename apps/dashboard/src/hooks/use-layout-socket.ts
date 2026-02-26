import { useEffect, useCallback, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useTerminalStore } from '../stores/terminal-store';
import { useChatsStore } from '../stores/tasks-store';
import { usePanelsStore } from '../stores/panels-store';
import { useEditorStore, type OpenFile } from '../stores/editor-store';

/** Debounce delay for layout saves (ms) */
const SAVE_DEBOUNCE_MS = 500;
/** Max time to wait for layout data before giving up (ms) */
const LOAD_TIMEOUT_MS = 3000;
const LOCAL_STORAGE_PREFIX = 'apex-layout:';

interface LayoutData {
  terminalPanelOpen: boolean;
  terminalPanelHeight: number;
  activeTerminalId: string | null;
  activeChatId: string | null;
  leftSidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  chatScrollOffset?: number;
  chatScrollOffsets?: Record<string, number>;
  openFiles?: OpenFile[];
  activeFilePath?: string | null;
  activeView?: 'chat' | 'editor';
  fileScrollOffsets?: Record<string, number>;
}

function saveLocalLayout(projectId: string, data: LayoutData): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + projectId, JSON.stringify(data));
  } catch { /* quota exceeded or unavailable — ignore */ }
}

function loadLocalLayout(projectId: string): LayoutData | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Hook that persists and restores layout state to/from the sandbox.
 * Shares the Socket.io connection from useAgentSocket.
 *
 * Returns `layoutReady` — false while the saved layout is being fetched,
 * true once layout has been applied (or timed out / no data).
 */
export function useLayoutSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
) {
  const applyTerminalLayout = useTerminalStore((s) => s.applyLayout);
  const setActiveChat = useChatsStore((s) => s.setActiveChat);
  const setChatScrollOffset = useChatsStore((s) => s.setChatScrollOffset);
  const setLeftSidebar = usePanelsStore((s) => s.setLeftSidebar);
  const setRightSidebar = usePanelsStore((s) => s.setRightSidebar);
  const applyEditorLayout = useEditorStore((s) => s.applyLayout);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutLoaded = useRef(false);
  const [layoutReady, setLayoutReady] = useState(false);

  const applyLayout = useCallback(
    (layout: LayoutData) => {
      applyTerminalLayout(layout);
      if (layout.activeChatId) {
        setActiveChat(layout.activeChatId);
      }
      if (layout.leftSidebarOpen !== undefined) {
        setLeftSidebar(layout.leftSidebarOpen);
      }
      if (layout.rightSidebarOpen !== undefined) {
        setRightSidebar(layout.rightSidebarOpen);
      }
      if (layout.chatScrollOffsets) {
        for (const [chatId, offset] of Object.entries(layout.chatScrollOffsets)) {
          setChatScrollOffset(chatId, offset);
        }
      } else if (layout.chatScrollOffset !== undefined && layout.activeChatId) {
        setChatScrollOffset(layout.activeChatId, layout.chatScrollOffset);
      }
      applyEditorLayout({
        openFiles: layout.openFiles,
        activeFilePath: layout.activeFilePath,
        activeView: layout.activeView,
        fileScrollOffsets: layout.fileScrollOffsets,
      });
    },
    [applyTerminalLayout, setActiveChat, setChatScrollOffset, setLeftSidebar, setRightSidebar, applyEditorLayout],
  );

  // ── Listen for layout_data from server, with localStorage fallback ──
  useEffect(() => {
    const socket = socketRef.current;
    if (!projectId) return;

    layoutLoaded.current = false;
    setLayoutReady(false);

    // Apply localStorage backup immediately so the UI is never blank
    const local = loadLocalLayout(projectId);
    if (local) {
      applyLayout(local);
    }

    if (!socket) {
      layoutLoaded.current = true;
      setLayoutReady(true);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const markReady = () => {
      layoutLoaded.current = true;
      setLayoutReady(true);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const onLayoutData = (data: { data: LayoutData | null }) => {
      console.log('[ws] layout_data:', data);
      if (data.data) {
        applyLayout(data.data);
      }
      markReady();
    };

    socket.on('layout_data', onLayoutData);

    const absoluteTimeout = setTimeout(markReady, LOAD_TIMEOUT_MS + 1000);

    const requestLayout = () => {
      socket.emit('layout_load', { projectId });
      timeoutId = setTimeout(markReady, LOAD_TIMEOUT_MS);
    };

    const onConnect = () => requestLayout();

    if (socket.connected) {
      requestLayout();
    }
    socket.on('connect', onConnect);

    return () => {
      socket.off('layout_data', onLayoutData);
      socket.off('connect', onConnect);
      if (timeoutId) clearTimeout(timeoutId);
      clearTimeout(absoluteTimeout);
      layoutLoaded.current = false;
    };
  }, [projectId, socketRef, applyLayout]);

  // ── Save layout (debounced to server, immediate to localStorage) ──
  const saveLayout = useCallback(
    (layout: LayoutData) => {
      if (!projectId || !layoutLoaded.current) return;

      saveLocalLayout(projectId, layout);

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        socketRef.current?.emit('layout_save', {
          projectId,
          layout,
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [projectId, socketRef],
  );

  const getLayoutSnapshot = useCallback((): LayoutData => {
    const term = useTerminalStore.getState();
    const chats = useChatsStore.getState();
    const panels = usePanelsStore.getState();
    const editor = useEditorStore.getState();
    return {
      terminalPanelOpen: term.panelOpen,
      terminalPanelHeight: term.panelHeight,
      activeTerminalId: term.activeTerminalId,
      activeChatId: chats.activeChatId,
      chatScrollOffsets: chats.chatScrollOffsets,
      leftSidebarOpen: panels.leftSidebarOpen,
      rightSidebarOpen: panels.rightSidebarOpen,
      openFiles: editor.openFiles,
      activeFilePath: editor.activeFilePath,
      activeView: editor.activeView,
      fileScrollOffsets: editor.fileScrollOffsets,
    };
  }, []);

  // ── Auto-save whenever relevant store state changes ──
  useEffect(() => {
    const unsubTerminal = useTerminalStore.subscribe((state, prevState) => {
      if (
        state.panelOpen !== prevState.panelOpen ||
        state.panelHeight !== prevState.panelHeight ||
        state.activeTerminalId !== prevState.activeTerminalId
      ) {
        saveLayout(getLayoutSnapshot());
      }
    });

    const unsubChats = useChatsStore.subscribe((state, prevState) => {
      if (
        state.activeChatId !== prevState.activeChatId ||
        state.chatScrollOffsets !== prevState.chatScrollOffsets
      ) {
        saveLayout(getLayoutSnapshot());
      }
    });

    const unsubPanels = usePanelsStore.subscribe((state, prevState) => {
      if (
        state.leftSidebarOpen !== prevState.leftSidebarOpen ||
        state.rightSidebarOpen !== prevState.rightSidebarOpen
      ) {
        saveLayout(getLayoutSnapshot());
      }
    });

    const unsubEditor = useEditorStore.subscribe((state, prevState) => {
      if (
        state.openFiles !== prevState.openFiles ||
        state.activeFilePath !== prevState.activeFilePath ||
        state.activeView !== prevState.activeView ||
        state.fileScrollOffsets !== prevState.fileScrollOffsets
      ) {
        saveLayout(getLayoutSnapshot());
      }
    });

    return () => {
      unsubTerminal();
      unsubChats();
      unsubPanels();
      unsubEditor();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [saveLayout, getLayoutSnapshot]);

  return { layoutReady };
}
