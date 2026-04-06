import { cn } from "../../../lib/cn";

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({ title, children, className }: SettingsSectionProps) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="border-b border-border pb-3">
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
      </div>
      <div className="space-y-6">
        {children}
      </div>
    </div>
  );
}