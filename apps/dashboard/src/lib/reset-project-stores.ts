import { useTerminalStore } from '../stores/terminal-store';
import { useChatsStore } from '../stores/tasks-store';
import { useEditorStore } from '../stores/editor-store';
import { useFileTreeStore } from '../stores/file-tree-store';
import { usePortsStore } from '../stores/ports-store';
import { usePanelsStore } from '../stores/panels-store';

/**
 * Reset all project-specific Zustand stores to their default state.
 * Called when navigating away from a project or before opening a new one
 * so that stale layout / content from the previous project is never visible.
 */
export function resetProjectStores(): void {
  useTerminalStore.getState().reset();
  useChatsStore.getState().reset();
  useEditorStore.getState().reset();
  useFileTreeStore.getState().reset();
  usePortsStore.getState().reset();
  usePanelsStore.getState().reset();
}
