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
import { settingsApi, type SettingSource } from "../api/client";

interface FieldDef {
  key: string;
  label: string;
  type: "password" | "text";
  placeholder: string;
  help: string;
  helpExtra?: React.ReactNode;
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

const FIELDS: FieldDef[] = [
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
    placeholder: "daytona-apex-3",
    help: "Sandbox snapshot image name. Leave empty to use the default.",
  },
  {
    key: "GITHUB_TOKEN",
    label: "GitHub Personal Access Token",
    type: "password",
    placeholder: "ghp_...",
    help: "Enables cloning, pushing, and pulling private repositories.",
    helpExtra: GITHUB_TOKEN_HELP,
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
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
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

          <div className="space-y-6">
            {FIELDS.map((field) => (
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
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                />
                <p className="mt-1 text-xs text-text-muted">{field.help}</p>
                {field.helpExtra}
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
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
