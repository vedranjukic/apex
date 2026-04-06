import { type SettingSource, type GitHubUser } from "../../../api/client";
import { SettingsSection } from "../components/settings-section";
import { SettingsCard } from "../components/settings-card";
import { SettingsField } from "../components/settings-field";

interface AgentConfigurationProps {
  values: Record<string, string>;
  sources: Record<string, SettingSource>;
  ghUser: GitHubUser | null;
  onChange: (key: string, value: string) => void;
}

export function AgentConfiguration({
  values,
  sources,
  ghUser,
  onChange
}: AgentConfigurationProps) {
  return (
    <SettingsSection title="Agent Configuration">
      {/* API Keys */}
      <SettingsCard 
        title="API Keys"
        description="Keys for AI coding agent providers."
      >
        <div className="space-y-4">
          <SettingsField
            label="Anthropic API Key (Claude Code)"
            type="password"
            value={values["ANTHROPIC_API_KEY"] ?? ""}
            placeholder="sk-ant-..."
            help="Required for Claude Code projects. Get your key from console.anthropic.com"
            source={sources["ANTHROPIC_API_KEY"]}
            onChange={(value) => onChange("ANTHROPIC_API_KEY", value)}
          />
          
          <SettingsField
            label="OpenAI API Key (Codex)"
            type="password"
            value={values["OPENAI_API_KEY"] ?? ""}
            placeholder="sk-proj-..."
            help="Required for Codex projects. Get your key from platform.openai.com"
            source={sources["OPENAI_API_KEY"]}
            onChange={(value) => onChange("OPENAI_API_KEY", value)}
          />
        </div>
      </SettingsCard>

      {/* Global Limits */}
      <SettingsCard 
        title="Global Limits"
        description="Default output and reasoning limits applied to all agents."
      >
        <SettingsField
          label="Global Max Output Tokens"
          type="text"
          value={values["AGENT_MAX_TOKENS"] ?? ""}
          placeholder="Auto (provider default)"
          help="Default max output tokens for all agents. Lower this if you hit context-length errors (e.g. 16000). Per-agent values below override this."
          source={sources["AGENT_MAX_TOKENS"]}
          onChange={(value) => onChange("AGENT_MAX_TOKENS", value)}
        />
      </SettingsCard>

      {/* Build Agent */}
      <SettingsCard 
        title="Build Agent"
        description="Configuration for the Build agent used for code implementation."
      >
        <div className="space-y-4">
          <SettingsField
            label="Max Output Tokens"
            type="text"
            value={values["AGENT_BUILD_MAX_TOKENS"] ?? ""}
            placeholder="Inherit global"
            help="Max output tokens for the Build agent. Typical: 8000–32000."
            source={sources["AGENT_BUILD_MAX_TOKENS"]}
            onChange={(value) => onChange("AGENT_BUILD_MAX_TOKENS", value)}
          />
          
          <SettingsField
            label="Reasoning Effort"
            type="text"
            value={values["AGENT_BUILD_REASONING_EFFORT"] ?? ""}
            placeholder="Auto"
            help="Extended thinking effort for Build (low / medium / high). Applies to Opus, o-series, and other reasoning models."
            source={sources["AGENT_BUILD_REASONING_EFFORT"]}
            onChange={(value) => onChange("AGENT_BUILD_REASONING_EFFORT", value)}
          />
        </div>
      </SettingsCard>

      {/* Plan Agent */}
      <SettingsCard 
        title="Plan Agent"
        description="Configuration for the Plan agent used for project planning and architecture."
      >
        <div className="space-y-4">
          <SettingsField
            label="Max Output Tokens"
            type="text"
            value={values["AGENT_PLAN_MAX_TOKENS"] ?? ""}
            placeholder="Inherit global"
            help="Max output tokens for the Plan agent. Typical: 8000–32000."
            source={sources["AGENT_PLAN_MAX_TOKENS"]}
            onChange={(value) => onChange("AGENT_PLAN_MAX_TOKENS", value)}
          />
          
          <SettingsField
            label="Reasoning Effort"
            type="text"
            value={values["AGENT_PLAN_REASONING_EFFORT"] ?? ""}
            placeholder="Auto"
            help="Extended thinking effort for Plan (low / medium / high)."
            source={sources["AGENT_PLAN_REASONING_EFFORT"]}
            onChange={(value) => onChange("AGENT_PLAN_REASONING_EFFORT", value)}
          />
        </div>
      </SettingsCard>

      {/* Sisyphus Agent */}
      <SettingsCard 
        title="Sisyphus Agent"
        description="Configuration for the Sisyphus orchestration agent."
      >
        <div className="space-y-4">
          <SettingsField
            label="Max Steps"
            type="text"
            value={values["AGENT_SISYPHUS_MAX_STEPS"] ?? ""}
            placeholder="50"
            help="Maximum tool-use steps the Sisyphus orchestration agent can take per prompt. Default: 50."
            source={sources["AGENT_SISYPHUS_MAX_STEPS"]}
            onChange={(value) => onChange("AGENT_SISYPHUS_MAX_STEPS", value)}
          />
          
          <SettingsField
            label="Max Output Tokens"
            type="text"
            value={values["AGENT_SISYPHUS_MAX_TOKENS"] ?? ""}
            placeholder="Inherit global"
            help="Max output tokens for the Sisyphus agent. Typical: 8000–32000."
            source={sources["AGENT_SISYPHUS_MAX_TOKENS"]}
            onChange={(value) => onChange("AGENT_SISYPHUS_MAX_TOKENS", value)}
          />
          
          <SettingsField
            label="Reasoning Effort"
            type="text"
            value={values["AGENT_SISYPHUS_REASONING_EFFORT"] ?? ""}
            placeholder="Auto"
            help="Extended thinking effort for Sisyphus (low / medium / high)."
            source={sources["AGENT_SISYPHUS_REASONING_EFFORT"]}
            onChange={(value) => onChange("AGENT_SISYPHUS_REASONING_EFFORT", value)}
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}