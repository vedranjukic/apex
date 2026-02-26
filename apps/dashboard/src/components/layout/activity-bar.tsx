import { useNavigate } from 'react-router-dom';
import { FolderOpen, GitBranch, GitFork, Search, Settings, LayoutGrid, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ActivityCategory = 'explorer' | 'git' | 'search' | 'forks' | 'settings';

interface ActivityBarProps {
  active: ActivityCategory | null;
  onChange: (category: ActivityCategory) => void;
}

const isElectron = !!(window as any).apex?.isElectron;

interface ActivityItem {
  id: ActivityCategory;
  icon: LucideIcon;
  label: string;
}

const topItems: ActivityItem[] = [
  { id: 'explorer', icon: FolderOpen, label: 'Explorer' },
  { id: 'git', icon: GitBranch, label: 'Source Control' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'forks', icon: GitFork, label: 'Forks' },
];

const bottomItems: ActivityItem[] = [
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function ActivityBar({ active, onChange }: ActivityBarProps) {
  return (
    <div className="w-12 bg-activity-bar flex flex-col items-center py-2 shrink-0 h-full">
      <div className="flex flex-col items-center gap-1">
        {topItems.map((item) => (
          <ActivityButton
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={() => onChange(item.id)}
          />
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1">
        {isElectron && <ProjectsButton />}
        {bottomItems.map((item) => (
          <ActivityButton
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={() => onChange(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityButton({
  item,
  isActive,
  onClick,
}: {
  item: ActivityItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={item.label}
      className={cn(
        'relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors',
        isActive
          ? 'text-white bg-activity-bar-hover'
          : 'text-gray-400 hover:text-gray-200 hover:bg-activity-bar-hover',
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary" />
      )}
      <Icon className="w-5 h-5" strokeWidth={1.5} />
    </button>
  );
}

function ProjectsButton() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/')}
      title="Projects"
      className="relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors text-gray-500 hover:text-gray-300 hover:bg-activity-bar-hover"
    >
      <LayoutGrid className="w-5 h-5" strokeWidth={1.5} />
    </button>
  );
}
