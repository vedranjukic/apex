import { useEffect, useCallback, useRef, useState } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useTerminalStore } from '../stores/terminal-store';
import { useThreadsStore } from '../stores/tasks-store';
import { usePanelsStore } from '../stores/panels-store';
import { useEditorStore, type OpenFile } from '../stores/editor-store';
import { useFileTreeStore } from '../stores/file-tree-store';

const SAVE_DEBOUNCE_MS = 500;
const LOAD_TIMEOUT_MS = 3000;
const LOCAL_STORAGE_PREFIX = 'apex-layout:';

interface LayoutData {
  terminalPanelOpen: boolean;
  terminalPanelHeight: number;
  activeTerminalId: string | null;
  portsTabVisible?: boolean;
  activeThreadId: string | null;
  leftSidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  threadScrollOffset?: number;
  threadScrollOffsets?: Record<string, number>;
  openFiles?: OpenFile[];
  activeFilePath?: string | null;
  activeView?: 'thread' | 'editor';
  fileScrollOffsets?: Record<string, number>;
  expandedFolders?: string[];
}

function saveLocalLayout(projectId: string, data: LayoutData): void {
  try { localStorage.setItem(LOCAL_STORAGE_PREFIX + projectId, JSON.stringify(data)); } catch { /* ignore */ }
}

function loadLocalLayout(projectId: string): LayoutData | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function useLayoutSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const applyTerminalLayout = useTerminalStore((s) => s.applyLayout);
  const setActiveThread = useThreadsStore((s) => s.setActiveThread);
  const setThreadScrollOffset = useThreadsStore((s) => s.setThreadScrollOffset);
  const setLeftSidebar = usePanelsStore((s) => s.setLeftSidebar);
  const setRightSidebar = usePanelsStore((s) => s.setRightSidebar);
  const applyEditorLayout = useEditorStore((s) => s.applyLayout);
  const setExpandedFolders = useFileTreeStore((s) => s.setExpandedFolders);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutLoaded = useRef(false);
  const [layoutReady, setLayoutReady] = useState(false);

  const applyLayout = useCallback(
    (layout: LayoutData) => {
      applyTerminalLayout(layout);
      if (layout.activeThreadId) setActiveThread(layout.activeThreadId);
      if (layout.leftSidebarOpen !== undefined) setLeftSidebar(layout.leftSidebarOpen);
      if (layout.rightSidebarOpen !== undefined) setRightSidebar(layout.rightSidebarOpen);
      if (layout.threadScrollOffsets) {
        for (const [threadId, offset] of Object.entries(layout.threadScrollOffsets)) setThreadScrollOffset(threadId, offset);
      } else if (layout.threadScrollOffset !== undefined && layout.activeThreadId) {
        setThreadScrollOffset(layout.activeThreadId, layout.threadScrollOffset);
      }
      applyEditorLayout({ openFiles: layout.openFiles, activeFilePath: layout.activeFilePath, activeView: layout.activeView, fileScrollOffsets: layout.fileScrollOffsets });
      if (layout.expandedFolders) setExpandedFolders(layout.expandedFolders);
    },
    [applyTerminalLayout, setActiveThread, setThreadScrollOffset, setLeftSidebar, setRightSidebar, applyEditorLayout, setExpandedFolders],
  );

  useEffect(() => {
    const ws = socketRef.current;
    if (!projectId) return;
    layoutLoaded.current = false;
    setLayoutReady(false);

    const local = loadLocalLayout(projectId);
    if (local) applyLayout(local);

    if (!ws) { layoutLoaded.current = true; setLayoutReady(true); return; }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const markReady = () => { layoutLoaded.current = true; setLayoutReady(true); if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; } };

    const onLayoutData = (data: any) => {
      if (data.payload?.data) applyLayout(data.payload.data);
      markReady();
    };

    ws.on('layout_data', onLayoutData);
    const absoluteTimeout = setTimeout(markReady, LOAD_TIMEOUT_MS + 1000);

    const requestLayout = () => { ws.send('layout_load', { projectId }); timeoutId = setTimeout(markReady, LOAD_TIMEOUT_MS); };
    const onConnect = (status: string) => { if (status === 'connected') requestLayout(); };
    if (ws.connected) requestLayout();
    ws.onStatus(onConnect as any);

    return () => {
      ws.off('layout_data', onLayoutData);
      ws.offStatus(onConnect as any);
      if (timeoutId) clearTimeout(timeoutId);
      clearTimeout(absoluteTimeout);
      layoutLoaded.current = false;
    };
  }, [projectId, socketRef, applyLayout]);

  const saveLayout = useCallback(
    (layout: LayoutData) => {
      if (!projectId || !layoutLoaded.current) return;
      saveLocalLayout(projectId, layout);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => { socketRef.current?.send('layout_save', { projectId, layout }); }, SAVE_DEBOUNCE_MS);
    },
    [projectId, socketRef],
  );

  const getLayoutSnapshot = useCallback((): LayoutData => {
    const term = useTerminalStore.getState();
    const threads = useThreadsStore.getState();
    const panels = usePanelsStore.getState();
    const editor = useEditorStore.getState();
    const fileTree = useFileTreeStore.getState();
    return {
      terminalPanelOpen: term.panelOpen, terminalPanelHeight: term.panelHeight,
      activeTerminalId: term.activeTerminalId, portsTabVisible: term.portsTabVisible,
      activeThreadId: threads.activeThreadId, threadScrollOffsets: threads.threadScrollOffsets,
      leftSidebarOpen: panels.leftSidebarOpen, rightSidebarOpen: panels.rightSidebarOpen,
      openFiles: editor.openFiles, activeFilePath: editor.activeFilePath,
      activeView: editor.activeView === 'diff' ? 'thread' : editor.activeView, fileScrollOffsets: editor.fileScrollOffsets,
      expandedFolders: fileTree.expandedFolders,
    };
  }, []);

  useEffect(() => {
    const unsubTerminal = useTerminalStore.subscribe((state, prevState) => {
      if (state.panelOpen !== prevState.panelOpen || state.panelHeight !== prevState.panelHeight ||
          state.activeTerminalId !== prevState.activeTerminalId || state.portsTabVisible !== prevState.portsTabVisible) {
        saveLayout(getLayoutSnapshot());
      }
    });
    const unsubThreads = useThreadsStore.subscribe((state, prevState) => {
      if (state.activeThreadId !== prevState.activeThreadId || state.threadScrollOffsets !== prevState.threadScrollOffsets) saveLayout(getLayoutSnapshot());
    });
    const unsubPanels = usePanelsStore.subscribe((state, prevState) => {
      if (state.leftSidebarOpen !== prevState.leftSidebarOpen || state.rightSidebarOpen !== prevState.rightSidebarOpen) saveLayout(getLayoutSnapshot());
    });
    const unsubEditor = useEditorStore.subscribe((state, prevState) => {
      if (state.openFiles !== prevState.openFiles || state.activeFilePath !== prevState.activeFilePath ||
          state.activeView !== prevState.activeView || state.fileScrollOffsets !== prevState.fileScrollOffsets) saveLayout(getLayoutSnapshot());
    });
    const unsubFileTree = useFileTreeStore.subscribe((state, prevState) => {
      if (state.expandedFolders !== prevState.expandedFolders) saveLayout(getLayoutSnapshot());
    });
    return () => { unsubTerminal(); unsubThreads(); unsubPanels(); unsubEditor(); unsubFileTree(); if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [saveLayout, getLayoutSnapshot]);

  return { layoutReady };
}
