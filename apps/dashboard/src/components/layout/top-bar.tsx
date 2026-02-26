import { PanelLeft, PanelRight, PanelBottom } from 'lucide-react';
import { cn } from '../../lib/cn';
import { usePanelsStore } from '../../stores/panels-store';
import { useTerminalStore } from '../../stores/terminal-store';

interface TopBarProps {
  title?: string;
  projectName?: string;
  showLayoutToggles?: boolean;
}

export function TopBar({ title, projectName, showLayoutToggles = true }: TopBarProps) {
  const leftOpen = usePanelsStore((s) => s.leftSidebarOpen);
  const rightOpen = usePanelsStore((s) => s.rightSidebarOpen);
  const toggleLeft = usePanelsStore((s) => s.toggleLeftSidebar);
  const toggleRight = usePanelsStore((s) => s.toggleRightSidebar);

  const bottomOpen = useTerminalStore((s) => s.panelOpen);
  const toggleBottom = useTerminalStore((s) => s.togglePanel);

  const isElectron = !!(window as any).apex?.isElectron;

  const centerText = projectName || title;

  return (
    <header
      className="h-[38px] bg-sidebar border-b border-panel-border flex items-center px-2 shrink-0 select-none relative"
      style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : undefined}
    >
      <div className="flex-1" />

      {centerText && (
        <span className="absolute left-1/2 -translate-x-1/2 text-xs text-panel-text-muted truncate max-w-[300px] pointer-events-none">
          {centerText}
        </span>
      )}

      {showLayoutToggles && (
        <div className="flex items-center gap-1" style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}>
          <ToggleButton
            icon={PanelLeft}
            active={leftOpen}
            onClick={toggleLeft}
            title="Toggle left sidebar"
          />
          <ToggleButton
            icon={PanelBottom}
            active={bottomOpen}
            onClick={toggleBottom}
            title="Toggle terminal panel"
          />
          <ToggleButton
            icon={PanelRight}
            active={rightOpen}
            onClick={toggleRight}
            title="Toggle right sidebar"
          />
        </div>
      )}
    </header>
  );
}

function ToggleButton({
  icon: Icon,
  active,
  onClick,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'w-6 h-6 flex items-center justify-center rounded transition-colors',
        active
          ? 'text-panel-icon-active hover:bg-sidebar-hover'
          : 'text-panel-icon hover:text-panel-icon-active hover:bg-sidebar-hover',
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
