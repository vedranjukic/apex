import { cn } from "../../../lib/cn";
import { type SettingSource } from "../../../api/client";

interface SettingsFieldProps {
  label: string;
  type: "text" | "password";
  value: string;
  placeholder?: string;
  help?: string;
  helpExtra?: React.ReactNode;
  source?: SettingSource;
  onChange: (value: string) => void;
  className?: string;
}

export function SettingsField({
  label,
  type,
  value,
  placeholder,
  help,
  helpExtra,
  source,
  onChange,
  className
}: SettingsFieldProps) {
  const fieldId = label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={fieldId} className="block text-sm font-medium text-text-primary">
          {label}
        </label>
        {source === "env" && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-secondary text-text-muted border border-border">
            ENV
          </span>
        )}
      </div>
      <input
        id={fieldId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-3 py-2 rounded-lg bg-surface-primary border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
      />
      {help && (
        <p className="text-xs text-text-muted">{help}</p>
      )}
      {helpExtra}
    </div>
  );
}