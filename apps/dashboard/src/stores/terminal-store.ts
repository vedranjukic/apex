import { create } from 'zustand';

export interface TerminalInfo {
  id: string;
  name: string;
  status: 'alive' | 'exited';
}

export type BottomTab = 'terminals' | 'ports';

interface TerminalState {
  /** The project these terminals belong to */
  projectId: string | null;
  /** All known terminals for the current project */
  terminals: TerminalInfo[];
  /** Currently focused terminal tab */
  activeTerminalId: string | null;
  /** Which bottom panel section is active */
  activeBottomTab: BottomTab;
  /** Whether the Ports tab is shown in the tab bar */
  portsTabVisible: boolean;
  /** Whether the terminal panel is visible */
  panelOpen: boolean;
  /** Height of the terminal panel in pixels */
  panelHeight: number;
  /** True after the first terminal_list response has been processed */
  terminalsLoaded: boolean;
  /** True only if terminal_list came from the bridge (not a timeout fallback) */
  bridgeResponded: boolean;
  /** Layout preference saved before terminals load — applied by setTerminals */
  _pendingLayout: { panelOpen: boolean; activeTerminalId: string | null } | null;

  // Actions
  /** Bind the store to a project. Resets all state if the projectId changed. */
  bindProject: (projectId: string) => void;
  addTerminal: (info: TerminalInfo, options?: { silent?: boolean }) => void;
  removeTerminal: (id: string) => void;
  setActive: (id: string | null) => void;
  setActiveBottomTab: (tab: BottomTab) => void;
  showPortsTab: () => void;
  hidePortsTab: () => void;
  /** Replace all terminals (used on reconnect / terminal_list) */
  setTerminals: (list: TerminalInfo[], fromBridge?: boolean) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setPanelHeight: (height: number) => void;
  /** Apply saved layout from the sandbox */
  applyLayout: (layout: { terminalPanelOpen: boolean; terminalPanelHeight: number; activeTerminalId: string | null; portsTabVisible?: boolean }) => void;
  /** Counter for naming new terminals sequentially */
  nextTerminalNumber: number;
  /** Increment counter and return the new value */
  getNextTerminalNumber: () => number;
  /** Reset state (e.g. when navigating away from a project) */
  reset: () => void;
}

const DEFAULT_PANEL_HEIGHT = 300;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  projectId: null,
  terminals: [],
  activeTerminalId: null,
  activeBottomTab: 'terminals',
  portsTabVisible: false,
  panelOpen: false,
  panelHeight: DEFAULT_PANEL_HEIGHT,
  terminalsLoaded: false,
  bridgeResponded: false,
  _pendingLayout: null,
  nextTerminalNumber: 0,

  bindProject: (projectId) => {
    if (get().projectId === projectId) return;
    set({
      projectId,
      terminals: [],
      activeTerminalId: null,
      activeBottomTab: 'terminals',
      portsTabVisible: false,
      panelOpen: false,
      panelHeight: DEFAULT_PANEL_HEIGHT,
      terminalsLoaded: false,
      bridgeResponded: false,
      _pendingLayout: null,
      nextTerminalNumber: 0,
    });
  },

  addTerminal: (info, options) => {
    const existing = get().terminals.find((t) => t.id === info.id);
    if (existing) return;
    const silent = options?.silent ?? false;
    set({
      terminals: [...get().terminals, info],
      activeTerminalId: info.id,
      ...(silent ? {} : { panelOpen: true }),
    });
  },

  removeTerminal: (id) => {
    const terminals = get().terminals.filter((t) => t.id !== id);
    const activeTerminalId =
      get().activeTerminalId === id
        ? terminals[terminals.length - 1]?.id ?? null
        : get().activeTerminalId;
    set({ terminals, activeTerminalId });
    if (terminals.length === 0) {
      set({ panelOpen: false });
    }
  },

  setActive: (id) => set({ activeTerminalId: id, activeBottomTab: 'terminals' }),
  setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),
  showPortsTab: () => set({ portsTabVisible: true }),
  hidePortsTab: () => set({ portsTabVisible: false, activeBottomTab: 'terminals' }),

  setTerminals: (list, fromBridge) => {
    const current = get();
    const pending = current._pendingLayout;

    const desiredActiveId = pending?.activeTerminalId ?? current.activeTerminalId;
    const desiredPanelOpen = pending?.panelOpen ?? current.panelOpen;

    // When the bridge sends an authoritative list, drop stale terminals.
    // Only keep optimistic (locally-created, not-yet-confirmed) terminals
    // when the list is NOT from the bridge (e.g. timeout fallback).
    let merged: TerminalInfo[];
    if (fromBridge) {
      merged = list;
    } else {
      const bridgeIds = new Set(list.map((t) => t.id));
      const optimistic = current.terminals.filter(
        (t) => !bridgeIds.has(t.id),
      );
      merged = [...list, ...optimistic];
    }

    let maxNum = current.nextTerminalNumber;
    for (const t of merged) {
      const m = t.name.match(/^Terminal\s+(\d+)$/);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }

    set({
      terminals: merged,
      terminalsLoaded: true,
      bridgeResponded: fromBridge ? true : current.bridgeResponded,
      _pendingLayout: null,
      nextTerminalNumber: maxNum,
      activeTerminalId:
        merged.find((t) => t.id === desiredActiveId)
          ? desiredActiveId
          : merged[0]?.id ?? null,
      panelOpen: merged.length > 0 ? (desiredPanelOpen || true) : desiredPanelOpen,
    });
  },

  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  setPanelHeight: (height) => set({ panelHeight: height }),

  applyLayout: (layout) => {
    const { terminalsLoaded } = get();
    if (layout.portsTabVisible !== undefined) {
      set({ portsTabVisible: layout.portsTabVisible });
    }
    if (terminalsLoaded) {
      set({
        panelOpen: layout.terminalPanelOpen,
        panelHeight: layout.terminalPanelHeight,
        activeTerminalId: layout.activeTerminalId,
      });
    } else {
      set({
        panelHeight: layout.terminalPanelHeight,
        _pendingLayout: {
          panelOpen: layout.terminalPanelOpen,
          activeTerminalId: layout.activeTerminalId,
        },
      });
    }
  },

  getNextTerminalNumber: () => {
    const next = get().nextTerminalNumber + 1;
    set({ nextTerminalNumber: next });
    return next;
  },

  reset: () =>
    set({
      projectId: null,
      terminals: [],
      activeTerminalId: null,
      activeBottomTab: 'terminals',
      portsTabVisible: false,
      panelOpen: false,
      panelHeight: DEFAULT_PANEL_HEIGHT,
      terminalsLoaded: false,
      bridgeResponded: false,
      _pendingLayout: null,
      nextTerminalNumber: 0,
    }),
}));
