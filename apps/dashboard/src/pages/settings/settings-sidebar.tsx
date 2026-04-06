import { Bot, Wrench, Link, Globe, ChevronLeft } from "lucide-react";
import { cn } from "../../lib/cn";

export type SettingsCategory = 
  | "agent-configuration"
  | "sandbox"
  | "integrations" 
  | "networking";

interface SettingsCategoryDefinition {
  id: SettingsCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const CATEGORIES: SettingsCategoryDefinition[] = [
  {
    id: "agent-configuration",
    label: "Agent Configuration",
    icon: Bot,
    description: "API keys, limits, and agent settings"
  },
  {
    id: "sandbox",
    label: "Sandbox",
    icon: Wrench,
    description: "Container and provider configuration"
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: Link,
    description: "GitHub and version control settings"
  },
  {
    id: "networking",
    label: "Networking",
    icon: Globe,
    description: "Port forwarding and proxy settings"
  }
];

interface SettingsSidebarProps {
  activeCategory: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  className?: string;
}

export function SettingsSidebar({
  activeCategory,
  onCategoryChange,
  collapsed,
  onToggleCollapsed,
  className
}: SettingsSidebarProps) {
  return (
    <div className={cn(
      "flex flex-col bg-surface-secondary border-r border-border transition-all duration-200",
      collapsed ? "w-16" : "w-64",
      "lg:flex", // Show on large screens
      "hidden sm:flex", // Hide on mobile, show on small+ screens unless collapsed
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        {!collapsed && (
          <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
        )}
        <button
          onClick={onToggleCollapsed}
          className="p-1 rounded-md hover:bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft className={cn(
            "w-4 h-4 transition-transform",
            collapsed && "rotate-180"
          )} />
        </button>
      </div>

      {/* Categories */}
      <nav className="flex-1 p-2">
        <div className="space-y-1">
          {CATEGORIES.map((category) => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;

            return (
              <button
                key={category.id}
                onClick={() => onCategoryChange(category.id)}
                className={cn(
                  "flex items-center w-full p-3 rounded-md text-left transition-all duration-150",
                  "hover:bg-surface-tertiary",
                  isActive && "bg-primary/10 text-primary border border-primary/20",
                  !isActive && "text-text-secondary hover:text-text-primary"
                )}
                title={collapsed ? category.label : undefined}
              >
                <Icon className={cn(
                  "w-5 h-5 flex-shrink-0",
                  collapsed ? "mx-auto" : "mr-3"
                )} />
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {category.label}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {category.description}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export { CATEGORIES };