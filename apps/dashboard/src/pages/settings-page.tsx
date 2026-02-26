import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { AppShell } from "../components/layout/app-shell";
import { settingsApi } from "../api/client";

const FIELDS = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    type: "password" as const,
    placeholder: "sk-ant-...",
    help: "Get your key from console.anthropic.com",
  },
  {
    key: "DAYTONA_API_KEY",
    label: "Daytona API Key",
    type: "password" as const,
    placeholder: "",
    help: "Get your key from app.daytona.io → Settings → API Keys",
  },
  {
    key: "DAYTONA_API_URL",
    label: "Daytona API URL",
    type: "text" as const,
    placeholder: "https://app.daytona.io/api",
    help: "Leave empty to use the default Daytona endpoint",
  },
  {
    key: "DAYTONA_SNAPSHOT",
    label: "Daytona Snapshot",
    type: "text" as const,
    placeholder: "daytona-apex-2",
    help: "Sandbox snapshot image name. Leave empty to use the default.",
  },
];

type Status = "idle" | "saving" | "saved" | "error";

export function SettingsPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
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
        setValues(settings);
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
          </p>

          <div className="space-y-6">
            {FIELDS.map((field) => (
              <div key={field.key}>
                <label
                  htmlFor={field.key}
                  className="block text-sm font-medium mb-1.5"
                >
                  {field.label}
                </label>
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
