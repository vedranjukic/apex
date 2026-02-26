import { create } from 'zustand';
import { themes, themeIds, type ThemeId } from '../lib/themes';

const STORAGE_KEY = 'apex-theme';

function loadSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && themeIds.includes(saved as ThemeId)) return saved as ThemeId;
  } catch { /* ignore */ }
  return 'midnight-blue';
}

function applyThemeToDOM(id: ThemeId) {
  document.documentElement.setAttribute('data-theme', id);
}

interface ThemeState {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  cycleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = loadSavedTheme();
  applyThemeToDOM(initial);

  return {
    themeId: initial,

    setTheme: (id) => {
      if (!themes[id]) return;
      localStorage.setItem(STORAGE_KEY, id);
      applyThemeToDOM(id);
      set({ themeId: id });
    },

    cycleTheme: () => {
      const current = get().themeId;
      const idx = themeIds.indexOf(current);
      const next = themeIds[(idx + 1) % themeIds.length];
      get().setTheme(next);
    },
  };
});
