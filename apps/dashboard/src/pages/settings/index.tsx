import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { AppShell } from "../../components/layout/app-shell";
import { SettingsSidebar, type SettingsCategory, CATEGORIES } from "./settings-sidebar";
import { AgentConfiguration } from "./categories/agent-configuration";
import { SandboxSettings } from "./categories/sandbox-settings";
import { Integrations } from "./categories/integrations";
import { Networking } from "./categories/networking";
import { MobileView } from "./categories/mobile-view";
import {
  settingsApi,
  githubApi,
  type SettingSource,
  type GitHubUser,
} from "../../api/client";

type Status = "idle" | "saving" | "saved" | "error";

export function SettingsPage() {
  const navigate = useNavigate();
  const { category } = useParams<{ category: string }>();
  
  // Parse category from URL or default to agent-configuration
  const activeCategory: SettingsCategory = 
    (category as SettingsCategory) || "agent-configuration";
  
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, SettingSource>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

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

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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
      setTimeout(() => setStatus("idle"), 3000);
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

  const handleCategoryChange = (newCategory: SettingsCategory) => {
    navigate(`/settings/${newCategory}`, { replace: true });
    setMobileMenuOpen(false); // Close mobile menu when category changes
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

  const renderCategoryContent = () => {
    const commonProps = {
      values,
      sources,
      ghUser,
      onChange: handleChange
    };

    switch (activeCategory) {
      case "agent-configuration":
        return <AgentConfiguration {...commonProps} />;
      case "sandbox":
        return <SandboxSettings {...commonProps} />;
      case "integrations":
        return <Integrations {...commonProps} />;
      case "networking":
        return <Networking {...commonProps} />;
      case "mobile":
        return <MobileView {...commonProps} />;
      default:
        return <AgentConfiguration {...commonProps} />;
    }
  };

  return (
    <AppShell>
      <div className="flex h-full">
        {/* Sidebar */}
        <SettingsSidebar
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border bg-surface-primary">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to projects
              </button>
              
              {/* Mobile Category Selector */}
              <div className="sm:hidden relative" ref={mobileMenuRef}>
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-surface-secondary text-text-primary hover:bg-surface-tertiary transition-colors"
                >
                  <span className="text-sm font-medium">
                    {CATEGORIES.find(cat => cat.id === activeCategory)?.label}
                  </span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                
                {mobileMenuOpen && (
                  <div className="absolute top-full left-0 mt-2 w-64 bg-surface-secondary border border-border rounded-lg shadow-lg z-50">
                    {CATEGORIES.map((category) => {
                      const Icon = category.icon;
                      const isActive = activeCategory === category.id;
                      
                      return (
                        <button
                          key={category.id}
                          onClick={() => handleCategoryChange(category.id)}
                          className={`flex items-center w-full p-3 text-left hover:bg-surface-tertiary transition-colors ${
                            isActive ? 'bg-primary/10 text-primary' : 'text-text-secondary'
                          }`}
                        >
                          <Icon className="w-5 h-5 mr-3 flex-shrink-0" />
                          <div>
                            <div className="font-medium">{category.label}</div>
                            <div className="text-xs text-text-muted">{category.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
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

          {/* Settings Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto p-6">
              <p className="text-sm text-text-secondary mb-6">
                Configure API keys for sandbox provisioning and agent execution.
                Values set here override environment variables.
              </p>
              {renderCategoryContent()}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}