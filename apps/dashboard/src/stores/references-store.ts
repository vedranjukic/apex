import { create } from 'zustand';

export interface ReferenceLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface ReferencesState {
  title: string | null;
  locations: ReferenceLocation[];
  loading: boolean;

  setResults: (title: string, locations: ReferenceLocation[]) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useReferencesStore = create<ReferencesState>((set) => ({
  title: null,
  locations: [],
  loading: false,

  setResults: (title, locations) => set({ title, locations, loading: false }),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ title: null, locations: [], loading: false }),
}));
