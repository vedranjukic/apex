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
  /** Whether the terminal panel is visible */
  panelOpen: boolean;
  /** Height of the terminal panel in pixels */
  panelHeight: number;
  /** True after the first terminal_list response has been processed */
  terminalsLoaded: boolean;
  /** Layout preference saved before terminals load — applied by setTerminals */
  _pendingLayout: { panelOpen: boolean; activeTerminalId: string | null } | null;

  // Actions
  /** Bind the store to a project. Resets all state if the projectId changed. */
  bindProject: (projectId: string) => void;
  addTerminal: (info: TerminalInfo, options?: { silent?: boolean }) => void;
  removeTerminal: (id: string) => void;
  setActive: (id: string | null) => void;
  setActiveBottomTab: (tab: BottomTab) => void;
  /** Replace all terminals (used on reconnect / terminal_list) */
  setTerminals: (list: TerminalInfo[]) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setPanelHeight: (height: number) => void;
  /** Apply saved layout from the sandbox */
  applyLayout: (layout: { terminalPanelOpen: boolean; terminalPanelHeight: number; activeTerminalId: string | null }) => void;
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
  panelOpen: false,
  panelHeight: DEFAULT_PANEL_HEIGHT,
  terminalsLoaded: false,
  _pendingLayout: null,
  nextTerminalNumber: 0,

  bindProject: (projectId) => {
    if (get().projectId === projectId) return;
    set({
      projectId,
      terminals: [],
      activeTerminalId: null,
      activeBottomTab: 'terminals',
      panelOpen: false,
      panelHeight: DEFAULT_PANEL_HEIGHT,
      terminalsLoaded: false,
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

  setTerminals: (list) => {
    const current = get();
    const pending = current._pendingLayout;

    // If layout was saved before terminals loaded, apply it now
    const desiredActiveId = pending?.activeTerminalId ?? current.activeTerminalId;
    const desiredPanelOpen = pending?.panelOpen ?? current.panelOpen;

    set({
      terminals: list,
      terminalsLoaded: true,
      _pendingLayout: null,
      activeTerminalId:
        list.find((t) => t.id === desiredActiveId)
          ? desiredActiveId
          : list[0]?.id ?? null,
      panelOpen: list.length > 0 ? (desiredPanelOpen || true) : desiredPanelOpen,
    });
  },

  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  setPanelHeight: (height) => set({ panelHeight: height }),

  applyLayout: (layout) => {
    const { terminalsLoaded } = get();
    if (terminalsLoaded) {
      // Terminals already loaded — apply everything directly
      set({
        panelOpen: layout.terminalPanelOpen,
        panelHeight: layout.terminalPanelHeight,
        activeTerminalId: layout.activeTerminalId,
      });
    } else {
      // Terminals haven't loaded yet — apply height now, defer open/active
      // until setTerminals fires so the panel doesn't appear empty
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
      panelOpen: false,
      panelHeight: DEFAULT_PANEL_HEIGHT,
      terminalsLoaded: false,
      _pendingLayout: null,
      nextTerminalNumber: 0,
    }),
}));
