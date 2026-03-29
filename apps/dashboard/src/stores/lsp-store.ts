import { create } from 'zustand';

export type LspServerStatus = 'starting' | 'ready' | 'error' | 'stopped';

interface LspLanguageState {
  status: LspServerStatus;
  error?: string;
}

interface LspState {
  languages: Record<string, LspLanguageState>;
  setStatus: (language: string, status: LspServerStatus, error?: string) => void;
  getStatus: (language: string) => LspLanguageState | null;
  reset: () => void;
}

export const useLspStore = create<LspState>((set, get) => ({
  languages: {},

  setStatus: (language, status, error) =>
    set((state) => ({
      languages: {
        ...state.languages,
        [language]: { status, error },
      },
    })),

  getStatus: (language) => get().languages[language] ?? null,

  reset: () => set({ languages: {} }),
}));
