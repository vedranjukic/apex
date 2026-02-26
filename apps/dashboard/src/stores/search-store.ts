import { create } from 'zustand';

export interface SearchMatch {
  line: number;
  content: string;
}

export interface SearchResult {
  filePath: string;
  matches: SearchMatch[];
}

interface SearchState {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  includePattern: string;
  excludePattern: string;
  results: SearchResult[];
  isSearching: boolean;
  expandedFiles: Set<string>;

  setQuery: (query: string) => void;
  toggleMatchCase: () => void;
  toggleWholeWord: () => void;
  toggleUseRegex: () => void;
  setIncludePattern: (pattern: string) => void;
  setExcludePattern: (pattern: string) => void;
  setResults: (results: SearchResult[]) => void;
  setIsSearching: (searching: boolean) => void;
  toggleFileExpanded: (filePath: string) => void;
  clearResults: () => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  matchCase: false,
  wholeWord: false,
  useRegex: false,
  includePattern: '',
  excludePattern: '',
  results: [],
  isSearching: false,
  expandedFiles: new Set<string>(),

  setQuery: (query) => set({ query }),

  toggleMatchCase: () => set({ matchCase: !get().matchCase }),
  toggleWholeWord: () => set({ wholeWord: !get().wholeWord }),
  toggleUseRegex: () => set({ useRegex: !get().useRegex }),

  setIncludePattern: (pattern) => set({ includePattern: pattern }),
  setExcludePattern: (pattern) => set({ excludePattern: pattern }),

  setResults: (results) => {
    const expanded = new Set<string>();
    for (const r of results) {
      expanded.add(r.filePath);
    }
    set({ results, isSearching: false, expandedFiles: expanded });
  },

  setIsSearching: (searching) => set({ isSearching: searching }),

  toggleFileExpanded: (filePath) => {
    const next = new Set(get().expandedFiles);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    set({ expandedFiles: next });
  },

  clearResults: () => set({ results: [], expandedFiles: new Set() }),

  reset: () =>
    set({
      query: '',
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      includePattern: '',
      excludePattern: '',
      results: [],
      isSearching: false,
      expandedFiles: new Set(),
    }),
}));
