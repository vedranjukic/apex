import { ReactNode } from 'react';
import { TopBar } from './top-bar';
import { CommandPalette } from '../command-palette/command-palette';
import { usePanelsStore } from '../../stores/panels-store';

interface AppShellProps {
  /** Left sidebar (activity bar + side panel), rendered on the far left */
  leftSidebar?: ReactNode;
  /** Right sidebar (chat list), rendered on the far right */
  sidebar?: ReactNode;
  /** Terminal panel rendered below the main content area */
  terminalPanel?: ReactNode;
  /** Bottom status bar (one-line project info) */
  statusBar?: ReactNode;
  /** Project name shown centered in the top bar */
  projectName?: string;
  /** Static title shown centered in the top bar (projectName takes precedence) */
  topBarTitle?: string;
  /** Whether to show layout toggle buttons in the top bar (default true) */
  showLayoutToggles?: boolean;
  children: ReactNode;
}

export function AppShell({ leftSidebar, sidebar, terminalPanel, statusBar, projectName, topBarTitle, showLayoutToggles, children }: AppShellProps) {
  const rightOpen = usePanelsStore((s) => s.rightSidebarOpen);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <CommandPalette />
      <TopBar title={topBarTitle} projectName={projectName} showLayoutToggles={showLayoutToggles} />
      <div className="flex flex-1 overflow-hidden">
        {leftSidebar}
        <div className="flex-1 overflow-hidden flex flex-col">
          <main className="flex-1 overflow-hidden flex flex-col">
            {children}
          </main>
          {terminalPanel}
        </div>
        {rightOpen && sidebar}
      </div>
      {statusBar}
    </div>
  );
}
