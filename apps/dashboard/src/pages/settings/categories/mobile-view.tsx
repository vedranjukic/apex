import { useState } from "react";
import { Copy, Check, ExternalLink, QrCode } from "lucide-react";
import { SettingsSection } from "../components/settings-section";
import { SettingsCard } from "../components/settings-card";

interface MobileViewProps {
  values: Record<string, string>;
  sources: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

export function MobileView({ values }: MobileViewProps) {
  const projectsUrl = values["LLM_PROXY_PROJECTS_URL"] || "";
  const authToken = values["LLM_PROXY_AUTH_TOKEN"] || "";
  const dashboardUrl = projectsUrl ? `${projectsUrl}/app` : "";

  return (
    <SettingsSection title="Mobile View">
      <SettingsCard
        title="Mobile Dashboard"
        description="Access your Daytona projects and threads from any device via a mobile-optimized web dashboard hosted on the proxy sandbox."
      >
        <div className="space-y-5">
          {dashboardUrl ? (
            <>
              <CopyField label="Dashboard URL" value={dashboardUrl} isLink />
              <CopyField label="Auth Token" value={authToken} masked />
              <p className="text-xs text-text-muted">
                Open the dashboard URL on your phone and paste the auth token to connect.
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-border bg-surface-secondary p-4 text-sm text-text-secondary">
              <p>
                Mobile dashboard is not available. It requires the Daytona provider
                to be configured with at least one LLM API key (Anthropic or OpenAI)
                so the proxy sandbox is created.
              </p>
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function CopyField({
  label,
  value,
  masked,
  isLink,
}: {
  label: string;
  value: string;
  masked?: boolean;
  isLink?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayValue =
    masked && !revealed
      ? value.slice(0, 12) + "••••••••" + value.slice(-4)
      : value;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-primary">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-sm text-text-secondary">
          {displayValue}
        </code>

        {masked && (
          <button
            onClick={() => setRevealed(!revealed)}
            className="shrink-0 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}

        <button
          onClick={handleCopy}
          className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>

        {isLink && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}
