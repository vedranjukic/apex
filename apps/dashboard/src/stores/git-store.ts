import { create } from 'zustand';

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface GitFileEntry {
  path: string;
  status: GitFileStatus;
  oldPath?: string;
}

export interface GitStatusData {
  branch: string | null;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  conflicted: GitFileEntry[];
  ahead: number;
  behind: number;
}

export interface GitBranchEntry {
  name: string;
  lastUsed: number;
  isCurrent: boolean;
  isRemote: boolean;
}

interface GitState {
  branch: string | null;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  conflicted: GitFileEntry[];
  ahead: number;
  behind: number;
  loading: boolean;
  commitMessage: string;
  /** Timestamp until which server status updates are suppressed (optimistic guard) */
  optimisticUntil: number;
  branches: GitBranchEntry[];

  setStatus: (data: GitStatusData) => void;
  setBranches: (branches: GitBranchEntry[]) => void;
  setCommitMessage: (msg: string) => void;
  setLoading: (v: boolean) => void;
  reset: () => void;

  optimisticStage: (paths: string[]) => void;
  optimisticUnstage: (paths: string[]) => void;
  optimisticDiscard: (paths: string[]) => void;
}

const OPTIMISTIC_GRACE_MS = 3_000;

const initialState = {
  branch: null as string | null,
  staged: [] as GitFileEntry[],
  unstaged: [] as GitFileEntry[],
  untracked: [] as GitFileEntry[],
  conflicted: [] as GitFileEntry[],
  ahead: 0,
  behind: 0,
  loading: false,
  commitMessage: '',
  optimisticUntil: 0,
  branches: [] as GitBranchEntry[],
};

/**
 * Merge incoming server files with the current list, preserving the existing
 * order for files that are still present and appending new ones at the end.
 */
function stablemerge(current: GitFileEntry[], incoming: GitFileEntry[]): GitFileEntry[] {
  const incomingMap = new Map(incoming.map((f) => [f.path, f]));
  const result: GitFileEntry[] = [];
  const seen = new Set<string>();

  // Keep existing order for files still present in incoming
  for (const f of current) {
    const updated = incomingMap.get(f.path);
    if (updated) {
      result.push(updated);
      seen.add(f.path);
    }
  }

  // Append any new files from incoming that weren't in current
  for (const f of incoming) {
    if (!seen.has(f.path)) {
      result.push(f);
    }
  }

  return result;
}

export const useGitStore = create<GitState>((set, get) => ({
  ...initialState,

  setStatus: (data) => {
    if (Date.now() < get().optimisticUntil) return;
    const state = get();
    set({
      branch: data.branch,
      staged: stablemerge(state.staged, data.staged),
      unstaged: stablemerge(state.unstaged, data.unstaged),
      untracked: stablemerge(state.untracked, data.untracked),
      conflicted: stablemerge(state.conflicted, data.conflicted),
      ahead: data.ahead,
      behind: data.behind,
      loading: false,
    });
  },

  setBranches: (branches) => set({ branches }),

  setCommitMessage: (msg) => set({ commitMessage: msg }),

  setLoading: (v) => set({ loading: v }),

  reset: () => set({ ...initialState }),

  optimisticStage: (paths) =>
    set((state) => {
      const pathSet = new Set(paths);
      const movingFromUnstaged = state.unstaged.filter((f) => pathSet.has(f.path));
      const movingFromUntracked = state.untracked.filter((f) => pathSet.has(f.path));
      const movingFromConflicted = state.conflicted.filter((f) => pathSet.has(f.path));

      const toStaged = [
        ...movingFromUnstaged.map((f) => ({ ...f, status: f.status === 'untracked' ? 'added' as const : f.status })),
        ...movingFromUntracked.map((f) => ({ ...f, status: 'added' as const })),
        ...movingFromConflicted.map((f) => ({ ...f, status: 'modified' as const })),
      ];

      return {
        optimisticUntil: Date.now() + OPTIMISTIC_GRACE_MS,
        staged: [...state.staged, ...toStaged],
        unstaged: state.unstaged.filter((f) => !pathSet.has(f.path)),
        untracked: state.untracked.filter((f) => !pathSet.has(f.path)),
        conflicted: state.conflicted.filter((f) => !pathSet.has(f.path)),
      };
    }),

  optimisticUnstage: (paths) =>
    set((state) => {
      const pathSet = new Set(paths);
      const moving = state.staged.filter((f) => pathSet.has(f.path));

      const toUnstaged = moving
        .filter((f) => f.status !== 'added')
        .map((f) => ({ ...f }));
      const toUntracked = moving
        .filter((f) => f.status === 'added')
        .map((f) => ({ ...f, status: 'untracked' as const }));

      return {
        optimisticUntil: Date.now() + OPTIMISTIC_GRACE_MS,
        staged: state.staged.filter((f) => !pathSet.has(f.path)),
        unstaged: [...state.unstaged, ...toUnstaged],
        untracked: [...state.untracked, ...toUntracked],
      };
    }),

  optimisticDiscard: (paths) =>
    set((state) => {
      const pathSet = new Set(paths);
      return {
        optimisticUntil: Date.now() + OPTIMISTIC_GRACE_MS,
        unstaged: state.unstaged.filter((f) => !pathSet.has(f.path)),
        untracked: state.untracked.filter((f) => !pathSet.has(f.path)),
      };
    }),
}));
