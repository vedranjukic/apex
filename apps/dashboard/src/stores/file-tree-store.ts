import { create } from 'zustand';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FileTreeState {
  cache: Record<string, FileEntry[]>;
  pendingPaths: string[];
  rootPath: string | null;
  changedDirs: string[];

  setRootPath: (path: string) => void;
  setEntries: (dirPath: string, entries: FileEntry[]) => void;
  getEntries: (dirPath: string) => FileEntry[] | undefined;
  getAllCachedFiles: () => FileEntry[];
  markPending: (dirPath: string) => void;
  isPending: (dirPath: string) => boolean;
  invalidate: (dirPath: string) => void;
  clearChangedDirs: () => void;
  reset: () => void;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  cache: {},
  pendingPaths: [],
  rootPath: null,
  changedDirs: [],

  setRootPath: (path: string) => set({ rootPath: path }),

  setEntries: (dirPath: string, entries: FileEntry[]) =>
    set((state) => {
      const prev = state.cache[dirPath];
      const changed = !prev || prev.length !== entries.length ||
        prev.some((e, i) => e.path !== entries[i]?.path);
      return {
        cache: { ...state.cache, [dirPath]: entries },
        pendingPaths: state.pendingPaths.filter((p) => p !== dirPath),
        changedDirs: changed ? [...state.changedDirs, dirPath] : state.changedDirs,
      };
    }),

  getEntries: (dirPath: string) => get().cache[dirPath],

  getAllCachedFiles: () => {
    const seen = new Set<string>();
    const files: FileEntry[] = [];
    for (const entries of Object.values(get().cache)) {
      for (const e of entries) {
        if (!e.isDirectory && !seen.has(e.path)) {
          seen.add(e.path);
          files.push(e);
        }
      }
    }
    return files;
  },

  markPending: (dirPath: string) =>
    set((state) => {
      if (state.pendingPaths.includes(dirPath)) return state;
      return { pendingPaths: [...state.pendingPaths, dirPath] };
    }),

  isPending: (dirPath: string) => get().pendingPaths.includes(dirPath),

  invalidate: (dirPath: string) =>
    set((state) => {
      const rest = { ...state.cache };
      delete rest[dirPath];
      return { cache: rest };
    }),

  clearChangedDirs: () => set({ changedDirs: [] }),

  reset: () => set({ cache: {}, pendingPaths: [], rootPath: null, changedDirs: [] }),
}));
