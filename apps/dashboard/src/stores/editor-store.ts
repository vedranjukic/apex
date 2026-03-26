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

export interface DiffData {
  filePath: string;
  original: string;
  modified: string;
  staged: boolean;
  loading: boolean;
}

interface EditorState {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  fileContents: Record<string, string>;
  fileScrollOffsets: Record<string, number>;
  activeView: 'thread' | 'editor' | 'diff';
  codeSelection: CodeSelection | null;
  /** Plain text that was on the clipboard when codeSelection was set */
  codeSelectionText: string | null;
  dirtyFiles: Set<string>;
  /** When set, CodeViewer will reveal this line after mount */
  revealLineAt: { filePath: string; line: number } | null;
  activeDiff: DiffData | null;

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
  openDiff: (filePath: string, staged: boolean) => void;
  setDiffContent: (filePath: string, original: string, modified: string) => void;
  closeDiff: () => void;
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
  activeDiff: null,

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

  openDiff: (filePath, staged) =>
    set({
      activeView: 'diff',
      activeDiff: { filePath, original: '', modified: '', staged, loading: true },
    }),

  setDiffContent: (filePath, original, modified) =>
    set((state) => {
      if (state.activeDiff?.filePath !== filePath) return state;
      return {
        activeDiff: { ...state.activeDiff, original, modified, loading: false },
      };
    }),

  closeDiff: () => set({ activeView: 'thread', activeDiff: null }),

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
      activeDiff: null,
    }),

  applyLayout: (data) =>
    set({
      openFiles: data.openFiles ?? [],
      activeFilePath: data.activeFilePath ?? null,
      activeView: data.activeView ?? 'thread',
      fileScrollOffsets: data.fileScrollOffsets ?? {},
    }),
}));
