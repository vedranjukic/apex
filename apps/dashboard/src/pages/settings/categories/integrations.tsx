import { ExternalLink } from "lucide-react";
import { type SettingSource, type GitHubUser } from "../../../api/client";
import { SettingsSection } from "../components/settings-section";
import { SettingsCard } from "../components/settings-card";
import { SettingsField } from "../components/settings-field";

interface IntegrationsProps {
  values: Record<string, string>;
  sources: Record<string, SettingSource>;
  ghUser: GitHubUser | null;
  onChange: (key: string, value: string) => void;
}

const GITHUB_TOKEN_HELP = (
  <details className="mt-1.5 text-xs text-text-muted group">
    <summary className="cursor-pointer select-none hover:text-text-secondary transition-colors">
      How to create a token
    </summary>
    <div className="mt-2 ml-1 space-y-2 text-text-muted">
      <p className="font-medium text-text-secondary">
        Fine-grained token (recommended)
      </p>
      <ol className="list-decimal ml-4 space-y-0.5">
        <li>
          Go to{" "}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-text-primary inline-flex items-center gap-0.5"
          >
            GitHub Token Settings
            <ExternalLink className="w-3 h-3" />
          </a>
        </li>
        <li>Set a name and expiration</li>
        <li>
          Under <strong>Repository access</strong>, select specific repos or all
        </li>
        <li>
          Under <strong>Repository permissions</strong>, set{" "}
          <strong>Contents</strong> to <em>Read and write</em>
        </li>
        <li>Click Generate token and copy it</li>
      </ol>
      <p className="font-medium text-text-secondary pt-1">
        Classic token (simpler)
      </p>
      <ol className="list-decimal ml-4 space-y-0.5">
        <li>
          Go to{" "}
          <a
            href="https://github.com/settings/tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-text-primary inline-flex items-center gap-0.5"
          >
            Classic Token Settings
            <ExternalLink className="w-3 h-3" />
          </a>
        </li>
        <li>
          Select the <strong>repo</strong> scope
        </li>
        <li>Generate and copy the token</li>
      </ol>
    </div>
  </details>
);

export function Integrations({
  values,
  sources,
  ghUser,
  onChange
}: IntegrationsProps) {
  return (
    <SettingsSection title="Integrations">
      {/* GitHub */}
      <SettingsCard 
        title="GitHub"
        description="Token for repository access. Name and email are used for git commits inside sandboxes."
      >
        <div className="space-y-4">
          <SettingsField
            label="Personal Access Token"
            type="password"
            value={values["GITHUB_TOKEN"] ?? ""}
            placeholder="ghp_..."
            help="Enables cloning, pushing, and pulling private repositories."
            helpExtra={GITHUB_TOKEN_HELP}
            source={sources["GITHUB_TOKEN"]}
            onChange={(value) => onChange("GITHUB_TOKEN", value)}
          />
          
          <SettingsField
            label="Git User Name"
            type="text"
            value={values["GIT_USER_NAME"] ?? ""}
            placeholder={ghUser?.name ? `${ghUser.name} (from GitHub)` : ""}
            help="Override the name used for git commits. Leave empty to use your GitHub profile name."
            source={sources["GIT_USER_NAME"]}
            onChange={(value) => onChange("GIT_USER_NAME", value)}
          />
          
          <SettingsField
            label="Git User Email"
            type="text"
            value={values["GIT_USER_EMAIL"] ?? ""}
            placeholder={ghUser?.email ? `${ghUser.email} (from GitHub)` : ""}
            help="Override the email used for git commits. Leave empty to use your GitHub profile email."
            source={sources["GIT_USER_EMAIL"]}
            onChange={(value) => onChange("GIT_USER_EMAIL", value)}
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}