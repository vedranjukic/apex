import { create } from 'zustand';

export type TourStepId = 'settings' | 'create-thread' | 'open-project' | 'thread-click';

const STORAGE_KEY = 'apex-tour-dismissed';

function loadDismissed(): Set<TourStepId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as TourStepId[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveDismissed(dismissed: Set<TourStepId>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
}

interface TourState {
  dismissed: Set<TourStepId>;
  settingsConfigured: boolean;
  setSettingsConfigured: (v: boolean) => void;
  isDismissed: (id: TourStepId) => boolean;
  dismissStep: (id: TourStepId) => void;
  dismissAll: () => void;
  resetTour: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  dismissed: loadDismissed(),
  settingsConfigured: false,

  setSettingsConfigured: (v) => set({ settingsConfigured: v }),

  isDismissed: (id) => get().dismissed.has(id),

  dismissStep: (id) => {
    const next = new Set(get().dismissed);
    next.add(id);
    saveDismissed(next);
    set({ dismissed: next });
  },

  dismissAll: () => {
    const all = new Set<TourStepId>(['settings', 'create-thread', 'open-project', 'thread-click']);
    saveDismissed(all);
    set({ dismissed: all });
  },

  resetTour: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ dismissed: new Set() });
  },
}));

// Expose on window for easy debugging: window.__resetTour()
(window as any).__resetTour = () => useTourStore.getState().resetTour();
