import { create } from 'zustand';
import type { ActivityCategory } from '../components/layout/activity-bar';

interface PanelsState {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  activeCategory: ActivityCategory;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebar: (open: boolean) => void;
  setRightSidebar: (open: boolean) => void;
  setActiveCategory: (category: ActivityCategory) => void;
  openPanel: (category: ActivityCategory) => void;
  reset: () => void;
}

export const usePanelsStore = create<PanelsState>((set) => ({
  leftSidebarOpen: false,
  rightSidebarOpen: false,
  activeCategory: 'explorer' as ActivityCategory,

  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setLeftSidebar: (open) => set({ leftSidebarOpen: open }),
  setRightSidebar: (open) => set({ rightSidebarOpen: open }),
  setActiveCategory: (category) => set({ activeCategory: category }),
  openPanel: (category) => set({ leftSidebarOpen: true, activeCategory: category }),

  reset: () => set({
    leftSidebarOpen: false,
    rightSidebarOpen: false,
    activeCategory: 'explorer' as ActivityCategory,
  }),
}));
