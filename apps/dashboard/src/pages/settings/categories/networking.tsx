import { type SettingSource, type GitHubUser } from "../../../api/client";
import { SettingsSection } from "../components/settings-section";
import { PortForwardingSettings } from "../../../components/settings/port-forwarding-settings";

interface NetworkingProps {
  values: Record<string, string>;
  sources: Record<string, SettingSource>;
  ghUser: GitHubUser | null;
  onChange: (key: string, value: string) => void;
}

export function Networking({
  values,
  sources,
  ghUser,
  onChange
}: NetworkingProps) {
  return (
    <SettingsSection title="Networking">
      <div className="p-6 rounded-lg border border-border bg-surface-secondary">
        <PortForwardingSettings />
      </div>
    </SettingsSection>
  );
}