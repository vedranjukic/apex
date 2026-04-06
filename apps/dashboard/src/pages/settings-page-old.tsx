import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { AppShell } from "../components/layout/app-shell";
import { PortForwardingSettings } from "../components/settings/port-forwarding-settings";
import {
  settingsApi,
  githubApi,
  type SettingSource,
  type GitHubUser,
} from "../api/client";

interface FieldDef {
  key: string;
  label: string;
  type: "password" | "text";
  placeholder: string;
  help: string;
  helpExtra?: React.ReactNode;
  dynamicPlaceholder?: (ghUser: GitHubUser | null) => string;
}

interface FieldGroup {
  title: string;
  description?: string;
  fields: FieldDef[];
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

const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Agent API Keys",
    description: "Keys for AI coding agent providers.",
    fields: [
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API Key (Claude Code)",
        type: "password",
        placeholder: "sk-ant-...",
        help: "Required for Claude Code projects. Get your key from console.anthropic.com",
      },
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API Key (Codex)",
        type: "password",
        placeholder: "sk-proj-...",
        help: "Required for Codex projects. Get your key from platform.openai.com",
      },
    ],
  },
  {
    title: "GitHub",
    description:
      "Token for repository access. Name and email are used for git commits inside sandboxes.",
    fields: [
      {
        key: "GITHUB_TOKEN",
        label: "Personal Access Token",
        type: "password",
        placeholder: "ghp_...",
        help: "Enables cloning, pushing, and pulling private repositories.",
        helpExtra: GITHUB_TOKEN_HELP,
      },
      {
        key: "GIT_USER_NAME",
        label: "Git User Name",
        type: "text",
        placeholder: "",
        help: "Override the name used for git commits. Leave empty to use your GitHub profile name.",
        dynamicPlaceholder: (gh) =>
          gh?.name ? `${gh.name} (from GitHub)` : "",
      },
      {
        key: "GIT_USER_EMAIL",
        label: "Git User Email",
        type: "text",
        placeholder: "",
        help: "Override the email used for git commits. Leave empty to use your GitHub profile email.",
        dynamicPlaceholder: (gh) =>
          gh?.email ? `${gh.email} (from GitHub)` : "",
      },
    ],
  },
  {
    title: "Sandbox",
    description: "Configuration for sandbox providers.",
    fields: [
      {
        key: "DAYTONA_API_KEY",
        label: "Daytona API Key",
        type: "password",
        placeholder: "",
        help: "Get your key from app.daytona.io → Settings → API Keys",
      },
      {
        key: "DAYTONA_API_URL",
        label: "Daytona API URL",
        type: "text",
        placeholder: "https://app.daytona.io/api",
        help: "Leave empty to use the default Daytona endpoint",
      },
      {
        key: "DAYTONA_SNAPSHOT",
        label: "Daytona Snapshot",
        type: "text",
        placeholder: "apex-default-0.2.3",
        help: "Daytona provider snapshot name. Leave empty to use the default.",
      },
      {
        key: "SANDBOX_IMAGE",
        label: "Container Image",
        type: "text",
        placeholder: "docker.io/daytonaio/apex-default:0.2.3",
        help: "Container image for Docker and Apple Container providers. Leave empty to use the default.",
      },
    ],
  },
  {
    title: "Agent Limits",
    description:
      "Tune per-agent output and reasoning limits. Changes apply to newly created sandboxes (or after sandbox restart).",
    fields: [
      {
        key: "AGENT_MAX_TOKENS",
        label: "Global Max Output Tokens",
        type: "text",
        placeholder: "Auto (provider default)",
        help: "Default max output tokens for all agents. Lower this if you hit context-length errors (e.g. 16000). Per-agent values below override this.",
      },
      {
        key: "AGENT_BUILD_MAX_TOKENS",
        label: "Build — Max Output Tokens",
        type: "text",
        placeholder: "Inherit global",
        help: "Max output tokens for the Build agent. Typical: 8000–32000.",
      },
      {
        key: "AGENT_BUILD_REASONING_EFFORT",
        label: "Build — Reasoning Effort",
        type: "text",
        placeholder: "Auto",
        help: "Extended thinking effort for Build (low / medium / high). Applies to Opus, o-series, and other reasoning models.",
      },
      {
        key: "AGENT_PLAN_MAX_TOKENS",
        label: "Plan — Max Output Tokens",
        type: "text",
        placeholder: "Inherit global",
        help: "Max output tokens for the Plan agent. Typical: 8000–32000.",
      },
      {
        key: "AGENT_PLAN_REASONING_EFFORT",
        label: "Plan — Reasoning Effort",
        type: "text",
        placeholder: "Auto",
        help: "Extended thinking effort for Plan (low / medium / high).",
      },
      {
        key: "AGENT_SISYPHUS_MAX_STEPS",
        label: "Sisyphus — Max Steps",
        type: "text",
        placeholder: "50",
        help: "Maximum tool-use steps the Sisyphus orchestration agent can take per prompt. Default: 50.",
      },
      {
        key: "AGENT_SISYPHUS_MAX_TOKENS",
        label: "Sisyphus — Max Output Tokens",
        type: "text",
        placeholder: "Inherit global",
        help: "Max output tokens for the Sisyphus agent. Typical: 8000–32000.",
      },
      {
        key: "AGENT_SISYPHUS_REASONING_EFFORT",
        label: "Sisyphus — Reasoning Effort",
        type: "text",
        placeholder: "Auto",
        help: "Extended thinking effort for Sisyphus (low / medium / high).",
      },
    ],
  },
];

type Status = "idle" | "saving" | "saved" | "error";

export function SettingsPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, SettingSource>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [vis, settings] = await Promise.all([
          settingsApi.visible(),
          settingsApi.get(),
        ]);
        if (cancelled) return;
        if (!vis.visible) {
          navigate("/", { replace: true });
          return;
        }
        const vals: Record<string, string> = {};
        const srcs: Record<string, SettingSource> = {};
        for (const [key, entry] of Object.entries(settings)) {
          vals[key] = entry.value;
          srcs[key] = entry.source;
        }
        setValues(vals);
        setSources(srcs);

        try {
          const user = await githubApi.user();
          if (!cancelled && user) setGhUser(user);
        } catch { /* token may not be configured */ }
      } catch {
        // settings not available yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSave = async () => {
    setStatus("saving");
    setErrorMsg("");
    try {
      await settingsApi.update(values);
      const settings = await settingsApi.get();
      const vals: Record<string, string> = {};
      const srcs: Record<string, SettingSource> = {};
      for (const [key, entry] of Object.entries(settings)) {
        vals[key] = entry.value;
        srcs[key] = entry.source;
      }
      setValues(vals);
      setSources(srcs);

      try {
        const user = await githubApi.user();
        setGhUser(user);
      } catch { /* ignore */ }

      setStatus("saved");
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to save settings",
      );
    }
  };

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (status === "saved" || status === "error") setStatus("idle");
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-xl mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </button>

          <h1 className="text-2xl font-bold mb-1">Settings</h1>
          <p className="text-sm text-text-secondary mb-8">
            Configure API keys for sandbox provisioning and agent execution.
            Values set here override environment variables.
          </p>

          <div className="space-y-10">
            {FIELD_GROUPS.map((group) => (
              <section key={group.title}>
                <h2 className="text-base font-semibold mb-0.5">
                  {group.title}
                </h2>
                {group.description && (
                  <p className="text-xs text-text-muted mb-4">
                    {group.description}
                  </p>
                )}
                <div className="space-y-5">
                  {group.fields.map((field) => {
                    const placeholder =
                      field.dynamicPlaceholder?.(ghUser) || field.placeholder;
                    return (
                      <div key={field.key}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <label
                            htmlFor={field.key}
                            className="block text-sm font-medium"
                          >
                            {field.label}
                          </label>
                          {sources[field.key] === "env" && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-secondary text-text-muted border border-border">
                              ENV
                            </span>
                          )}
                        </div>
                        <input
                          id={field.key}
                          type={field.type}
                          value={values[field.key] ?? ""}
                          onChange={(e) =>
                            handleChange(field.key, e.target.value)
                          }
                          placeholder={placeholder}
                          autoComplete="off"
                          className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                        />
                        <p className="mt-1 text-xs text-text-muted">
                          {field.help}
                        </p>
                        {field.helpExtra}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            <section>
              <PortForwardingSettings />
            </section>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {status === "saving" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save
            </button>

            {status === "saved" && (
              <span className="flex items-center gap-1.5 text-sm text-green-400">
                <CheckCircle2 className="w-4 h-4" />
                Saved
              </span>
            )}
            {status === "error" && (
              <span className="flex items-center gap-1.5 text-sm text-red-400">
                <AlertCircle className="w-4 h-4" />
                {errorMsg}
              </span>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
