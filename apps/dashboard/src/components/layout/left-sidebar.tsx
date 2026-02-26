import { useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { ActivityBar, type ActivityCategory } from './activity-bar';
import { SidePanel } from './side-panel';
import { usePanelsStore } from '../../stores/panels-store';
import type { FileTreeActions } from '../explorer/file-tree';
import type { GitActions } from '../../hooks/use-git-socket';

interface LeftSidebarProps {
  projectId: string;
  fileActions: FileTreeActions;
  gitActions: GitActions;
  searchFiles: (query: string, options: {
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    includePattern?: string;
    excludePattern?: string;
  }) => void;
  readFile: (path: string) => void;
  socket: { current: Socket | null };
  sendPrompt: (chatId: string, prompt: string, mode?: string, model?: string) => void;
}

export function LeftSidebar({ projectId, fileActions, gitActions, searchFiles, readFile, socket, sendPrompt }: LeftSidebarProps) {
  const active = usePanelsStore((s) => s.activeCategory);
  const panelOpen = usePanelsStore((s) => s.leftSidebarOpen);
  const setPanelOpen = usePanelsStore((s) => s.setLeftSidebar);
  const setActiveCategory = usePanelsStore((s) => s.setActiveCategory);

  const handleSelect = useCallback(
    (category: ActivityCategory) => {
      if (category === active && panelOpen) {
        setPanelOpen(false);
      } else {
        setActiveCategory(category);
        setPanelOpen(true);
      }
    },
    [active, panelOpen, setPanelOpen, setActiveCategory],
  );

  return (
    <div className="flex h-full shrink-0">
      <ActivityBar active={panelOpen ? active : null} onChange={handleSelect} />
      {panelOpen && (
        <SidePanel category={active} projectId={projectId} fileActions={fileActions} gitActions={gitActions} searchFiles={searchFiles} readFile={readFile} socket={socket} sendPrompt={sendPrompt} />
      )}
    </div>
  );
}
