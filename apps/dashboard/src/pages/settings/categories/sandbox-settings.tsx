import { type SettingSource, type GitHubUser } from "../../../api/client";
import { SettingsSection } from "../components/settings-section";
import { SettingsCard } from "../components/settings-card";
import { SettingsField } from "../components/settings-field";

interface SandboxSettingsProps {
  values: Record<string, string>;
  sources: Record<string, SettingSource>;
  ghUser: GitHubUser | null;
  onChange: (key: string, value: string) => void;
}

export function SandboxSettings({
  values,
  sources,
  ghUser,
  onChange
}: SandboxSettingsProps) {
  return (
    <SettingsSection title="Sandbox">
      {/* Daytona Configuration */}
      <SettingsCard 
        title="Daytona Configuration"
        description="Configuration for the Daytona cloud sandbox provider."
      >
        <div className="space-y-4">
          <SettingsField
            label="Daytona API Key"
            type="password"
            value={values["DAYTONA_API_KEY"] ?? ""}
            placeholder=""
            help="Get your key from app.daytona.io → Settings → API Keys"
            source={sources["DAYTONA_API_KEY"]}
            onChange={(value) => onChange("DAYTONA_API_KEY", value)}
          />
          
          <SettingsField
            label="Daytona API URL"
            type="text"
            value={values["DAYTONA_API_URL"] ?? ""}
            placeholder="https://app.daytona.io/api"
            help="Leave empty to use the default Daytona endpoint"
            source={sources["DAYTONA_API_URL"]}
            onChange={(value) => onChange("DAYTONA_API_URL", value)}
          />
          
          <SettingsField
            label="Daytona Snapshot"
            type="text"
            value={values["DAYTONA_SNAPSHOT"] ?? ""}
            placeholder="apex-default-0.2.3"
            help="Daytona provider snapshot name. Leave empty to use the default."
            source={sources["DAYTONA_SNAPSHOT"]}
            onChange={(value) => onChange("DAYTONA_SNAPSHOT", value)}
          />
        </div>
      </SettingsCard>

      {/* Container Settings */}
      <SettingsCard 
        title="Container Settings"
        description="Configuration for local container-based sandbox providers."
      >
        <SettingsField
          label="Container Image"
          type="text"
          value={values["SANDBOX_IMAGE"] ?? ""}
          placeholder="docker.io/daytonaio/apex-default:0.2.3"
          help="Container image for Docker and Apple Container providers. Leave empty to use the default."
          source={sources["SANDBOX_IMAGE"]}
          onChange={(value) => onChange("SANDBOX_IMAGE", value)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}