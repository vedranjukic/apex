import { cn } from "../../../lib/cn";

interface SettingsCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingsCard({ title, description, children, className }: SettingsCardProps) {
  return (
    <div className={cn("space-y-4 p-6 rounded-lg border border-border bg-surface-secondary", className)}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {description && (
          <p className="text-sm text-text-muted">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}