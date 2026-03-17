import { create } from 'zustand';

export interface OpenFile {
  path: string;
  name: string;
}

export interface CodeSelection {
  filePath: string;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
}

interface EditorState {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  fileContents: Record<string, string>;
  fileScrollOffsets: Record<string, number>;
  activeView: 'thread' | 'editor';
  codeSelection: CodeSelection | null;
  /** Plain text that was on the clipboard when codeSelection was set */
  codeSelectionText: string | null;
  dirtyFiles: Set<string>;
  /** When set, CodeViewer will reveal this line after mount */
  revealLineAt: { filePath: string; line: number } | null;

  openFile: (path: string, name: string) => void;
  openFileAtLine: (path: string, name: string, line: number) => void;
  clearRevealLineAt: () => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  setFileContent: (path: string, content: string) => void;
  setFileScrollOffset: (path: string, offset: number) => void;
  setCodeSelection: (sel: CodeSelection | null, text?: string | null) => void;
  markDirty: (path: string) => void;
  markClean: (path: string) => void;
  showThread: () => void;
  reset: () => void;
  applyLayout: (data: {
    openFiles?: OpenFile[];
    activeFilePath?: string | null;
    activeView?: 'thread' | 'editor';
    fileScrollOffsets?: Record<string, number>;
  }) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,
  fileContents: {},
  fileScrollOffsets: {},
  activeView: 'thread',
  codeSelection: null,
  codeSelectionText: null,
  dirtyFiles: new Set<string>(),
  revealLineAt: null,

  openFile: (path, name) => {
    const { openFiles } = get();
    const alreadyOpen = openFiles.some((f) => f.path === path);
    set({
      openFiles: alreadyOpen ? openFiles : [...openFiles, { path, name }],
      activeFilePath: path,
      activeView: 'editor',
    });
  },

  openFileAtLine: (path, name, line) => {
    const { openFiles } = get();
    const alreadyOpen = openFiles.some((f) => f.path === path);
    set({
      openFiles: alreadyOpen ? openFiles : [...openFiles, { path, name }],
      activeFilePath: path,
      activeView: 'editor',
      revealLineAt: { filePath: path, line },
    });
  },

  clearRevealLineAt: () => set({ revealLineAt: null }),

  closeFile: (path) => {
    const { openFiles, activeFilePath } = get();
    const remaining = openFiles.filter((f) => f.path !== path);
    const needSwitch = activeFilePath === path;
    set({
      openFiles: remaining,
      activeFilePath: needSwitch
        ? remaining.length > 0 ? remaining[remaining.length - 1].path : null
        : activeFilePath,
      activeView: needSwitch && remaining.length === 0 ? 'thread' : get().activeView,
    });
  },

  setActiveFile: (path) => set({ activeFilePath: path, activeView: 'editor' }),

  setFileContent: (path, content) =>
    set((state) => ({
      fileContents: { ...state.fileContents, [path]: content },
    })),

  setFileScrollOffset: (path, offset) =>
    set((state) => ({
      fileScrollOffsets: { ...state.fileScrollOffsets, [path]: offset },
    })),

  setCodeSelection: (sel, text) => set({ codeSelection: sel, codeSelectionText: text ?? null }),

  markDirty: (path) =>
    set((state) => {
      if (state.dirtyFiles.has(path)) return state;
      const next = new Set(state.dirtyFiles);
      next.add(path);
      return { dirtyFiles: next };
    }),

  markClean: (path) =>
    set((state) => {
      if (!state.dirtyFiles.has(path)) return state;
      const next = new Set(state.dirtyFiles);
      next.delete(path);
      return { dirtyFiles: next };
    }),

  showThread: () => set({ activeView: 'thread' }),

  reset: () =>
    set({
      openFiles: [],
      activeFilePath: null,
      fileContents: {},
      fileScrollOffsets: {},
      activeView: 'thread',
      codeSelection: null,
      codeSelectionText: null,
      dirtyFiles: new Set<string>(),
      revealLineAt: null,
    }),

  applyLayout: (data) =>
    set({
      openFiles: data.openFiles ?? [],
      activeFilePath: data.activeFilePath ?? null,
      activeView: data.activeView ?? 'thread',
      fileScrollOffsets: data.fileScrollOffsets ?? {},
    }),
}));
