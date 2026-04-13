import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { X, Cloud, Container, Laptop, FolderOpen, FolderSearch, GitBranch, CircleDot, GitPullRequest, Loader2, Settings } from 'lucide-react';
import { useProjectsStore } from '../../stores/projects-store';
import { configApi, githubApi, type ProviderStatus, type GitHubResolveResult, type GitHubContextData } from '../../api/client';
import { parseGitHubUrl } from '@apex/shared';
import { cn } from '../../lib/cn';
import { FolderBrowser } from './folder-browser';
import { AdvancedSettingsPanel, type AdvancedSettings, DEFAULT_SETTINGS } from './advanced-settings-panel';
import { RepositorySettingsPreview } from './repository-settings-preview';
import { useRepositorySecrets } from '../../hooks/use-repository-secrets';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const PROVIDER_META: Record<string, { label: string; sublabel: string; icon: typeof Cloud }> = {
  daytona: { label: 'Daytona', sublabel: 'Cloud sandbox', icon: Cloud },
  docker: { label: 'Docker', sublabel: 'Local container', icon: Container },
  'apple-container': { label: 'Apple Container', sublabel: 'macOS VM', icon: Laptop },
  local: { label: 'Local', sublabel: 'Host folder', icon: FolderOpen },
};

const PROVIDER_ORDER = ['daytona', 'docker', 'apple-container', 'local'];

const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/;

function generateProjectName(result: GitHubResolveResult, existingNames: string[]): string {
  const { parsed, content } = result;

  let base = '';

  if (content && (parsed.type === 'issue' || parsed.type === 'pull')) {
    base = slugifyTitle(content.title);
  }

  if (!base) {
    base = parsed.repo;
  }

  if (base.length > 40) {
    base = base.slice(0, 40).replace(/-+$/, '');
  }

  const nameSet = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!nameSet.has(base.toLowerCase())) return base;

  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!nameSet.has(candidate.toLowerCase())) return candidate;
  }
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'project';
}

function parseEnvironmentVariables(envVarText: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!envVarText.trim()) return result;

  const lines = envVarText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    
    const key = trimmed.substring(0, equalIndex).trim();
    const value = trimmed.substring(equalIndex + 1);
    
    if (key) {
      result[key] = value;
    }
  }
  
  return result;
}

export function CreateProjectDialog({ open, onClose, onCreated }: Props) {
  const createProject = useProjectsStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [gitRepo, setGitRepo] = useState('');
  const [localDir, setLocalDir] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const nameManuallyEdited = useRef(false);

  const [autoStart, setAutoStart] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<GitHubResolveResult | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastResolvedUrl = useRef('');

  // Advanced settings state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);

  // Repository secrets state
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const repositorySecrets = useRepositorySecrets(repositoryId);

  useEffect(() => {
    if (!open) return;
    nameManuallyEdited.current = false;
    configApi.providers().then(({ providers }) => {
      setProviderStatuses(providers);
      const firstAvailable = providers.find((p) => p.available)?.type;
      if (!provider || !providers.find((p) => p.type === provider && p.available)) {
        setProvider(firstAvailable ?? '');
      }
    }).catch(() => {
      const fallback: ProviderStatus[] = PROVIDER_ORDER.map((type) => ({ type, available: true }));
      setProviderStatuses(fallback);
      if (!provider) setProvider(PROVIDER_ORDER[0]);
    });
  }, [open]);

  const resolveGitHubUrl = useCallback((url: string) => {
    if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current);

    const trimmed = url.trim();
    if (!GITHUB_URL_RE.test(trimmed)) {
      setResolved(null);
      setResolveError(null);
      setResolving(false);
      setRepositoryId(null);
      lastResolvedUrl.current = '';
      return;
    }

    if (trimmed === lastResolvedUrl.current) return;

    // Parse the GitHub URL to extract repository ID for secrets lookup
    const parsed = parseGitHubUrl(trimmed);
    if (parsed) {
      const repoId = `${parsed.owner}/${parsed.repo}`;
      setRepositoryId(repoId);
    } else {
      setRepositoryId(null);
    }

    setResolving(true);
    setResolveError(null);

    resolveTimerRef.current = setTimeout(async () => {
      try {
        const result = await githubApi.resolve(trimmed);
        lastResolvedUrl.current = trimmed;
        setResolved(result);
        setResolveError(null);

        if (!nameManuallyEdited.current) {
          const existingNames = useProjectsStore.getState().projects.map((p) => p.name);
          setName(generateProjectName(result, existingNames));
        }
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : String(err));
        setResolved(null);
      } finally {
        setResolving(false);
      }
    }, 400);
  }, []);

  const handleGitRepoChange = useCallback((value: string) => {
    setGitRepo(value);
    resolveGitHubUrl(value);
  }, [resolveGitHubUrl]);

  useEffect(() => {
    return () => {
      if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current);
    };
  }, []);

  const orderedStatuses = PROVIDER_ORDER
    .map((type) => providerStatuses.find((s) => s.type === type))
    .filter((s): s is ProviderStatus => !!s);

  if (!open) return null;

  const isLocal = provider === 'local';

  const gitBranch = resolved?.parsed.ref ?? (resolved?.content?.type === 'pull' ? resolved.content.branch : undefined);
  const cloneUrl = resolved?.parsed.cloneUrl;
  const githubContext: GitHubContextData | undefined = resolved?.content ?? undefined;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (isLocal && !localDir.trim()) return;
    setSubmitting(true);
    try {
      let autoStartPrompt: string | undefined;
      if (autoStart && githubContext) {
        const ctxType = githubContext.type === 'issue' ? 'Issue' : 'Pull Request';
        const header = `GitHub ${ctxType} #${githubContext.number}: ${githubContext.title}\n${githubContext.url}\n\n${githubContext.body}`;
        const instruction = githubContext.type === 'issue'
          ? 'ulw Solve this GitHub issue. Analyze the codebase, understand the problem, and implement a solution.'
          : 'ulw Review this pull request. Analyze the code changes, identify potential issues, and provide a comprehensive review.';
        autoStartPrompt = `${header}\n\n---\n\n${instruction}\n\nIMPORTANT: Work fully autonomously. Do NOT use the ask_user tool or ask for user confirmation or clarification. Make your best judgment and proceed.`;
      }

      // Build sandboxConfig from advanced settings
      let sandboxConfig: { customImage?: string; environmentVariables?: Record<string, string>; memoryMB?: number; cpus?: number } | undefined;
      const hasAdvancedSettings = advancedSettings.customImage.trim() || 
        advancedSettings.environmentVariables.trim() || 
        advancedSettings.memoryMB.trim() || 
        advancedSettings.cpus.trim();

      if (hasAdvancedSettings) {
        sandboxConfig = {};
        
        if (advancedSettings.customImage.trim()) {
          sandboxConfig.customImage = advancedSettings.customImage.trim();
        }
        
        if (advancedSettings.environmentVariables.trim()) {
          sandboxConfig.environmentVariables = parseEnvironmentVariables(advancedSettings.environmentVariables);
        }
        
        if (advancedSettings.memoryMB.trim()) {
          const memory = parseInt(advancedSettings.memoryMB, 10);
          if (!isNaN(memory) && memory > 0) {
            sandboxConfig.memoryMB = memory;
          }
        }
        
        if (advancedSettings.cpus.trim()) {
          const cpus = parseInt(advancedSettings.cpus, 10);
          if (!isNaN(cpus) && cpus > 0) {
            sandboxConfig.cpus = cpus;
          }
        }
      }

      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        provider,
        gitRepo: cloneUrl || gitRepo.trim() || undefined,
        gitBranch: gitBranch || undefined,
        localDir: isLocal ? localDir.trim() : undefined,
        githubContext,
        autoStartPrompt,
        sandboxConfig,
      });
      onCreated(project.id);
      setName('');
      setDescription('');
      setProvider(providerStatuses.find((p) => p.available)?.type ?? '');
      setGitRepo('');
      setLocalDir('');
      setAutoStart(true);
      setResolved(null);
      setResolveError(null);
      setRepositoryId(null);
      lastResolvedUrl.current = '';
      nameManuallyEdited.current = false;
      setShowAdvanced(false);
      setAdvancedSettings(DEFAULT_SETTINGS);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div className={cn(
        "bg-surface rounded-xl shadow-xl w-full p-6 transition-all duration-300",
        showAdvanced ? "max-w-4xl" : "max-w-md"
      )}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New Project</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={cn(
          "transition-all duration-300",
          showAdvanced ? "flex gap-6" : "space-y-4"
        )}>
          <div className={cn(
            "space-y-4",
            showAdvanced ? "flex-1" : ""
          )}>
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); nameManuallyEdited.current = true; }}
              placeholder="Auto-generated from URL or type a name"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Sandbox Provider</label>
            <div className="grid grid-cols-2 gap-2">
              {orderedStatuses.map((status) => {
                const meta = PROVIDER_META[status.type];
                if (!meta) return null;
                const Icon = meta.icon;
                const selected = provider === status.type;
                const disabled = !status.available;
                return (
                  <button
                    key={status.type}
                    type="button"
                    disabled={disabled}
                    title={disabled ? status.reason : undefined}
                    onClick={() => setProvider(status.type)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors text-left',
                      disabled
                        ? 'border-border/50 text-text-muted/40 cursor-not-allowed'
                        : selected
                          ? 'border-primary bg-primary/10 text-text-primary'
                          : 'border-border hover:border-text-muted text-text-muted',
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="font-medium">{meta.label}</div>
                      <div className="text-xs opacity-70">{meta.sublabel}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {isLocal && (
            <div>
              <label className="block text-sm font-medium mb-1">Project Folder</label>
              <div className="flex gap-2">
                <input
                  value={localDir}
                  onChange={(e) => setLocalDir(e.target.value)}
                  placeholder="/Users/you/Projects/my-app"
                  className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                />
                <button
                  type="button"
                  onClick={() => setBrowsing(true)}
                  className="px-3 py-2 border border-border rounded-lg hover:bg-surface-secondary transition-colors text-text-muted hover:text-text-primary"
                  title="Browse folders"
                >
                  <FolderSearch className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-text-muted mt-1">Absolute path to the local folder. It will be created if it doesn't exist.</p>
              <FolderBrowser
                open={browsing}
                initialPath={localDir || undefined}
                onSelect={(path) => setLocalDir(path)}
                onClose={() => setBrowsing(false)}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this project is about…"
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Git Repository</label>
            <input
              value={gitRepo}
              onChange={(e) => handleGitRepoChange(e.target.value)}
              placeholder="https://github.com/user/repo or issue/PR/branch URL"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {resolving && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-text-muted">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Resolving GitHub URL…</span>
              </div>
            )}

            {resolveError && (
              <p className="text-xs text-red-400 mt-1.5">{resolveError}</p>
            )}

            {resolved && !resolving && (
              <GitHubResolvePreview result={resolved} />
            )}

            {/* Repository Settings Preview */}
            {repositoryId && (
              <RepositorySettingsPreview
                repositoryId={repositoryId}
                secrets={repositorySecrets.secrets}
                environmentVariables={repositorySecrets.environmentVariables}
                isLoading={repositorySecrets.isLoading}
                error={repositorySecrets.error}
                className="mt-2"
              />
            )}

            {!resolved && !resolving && !resolveError && (
              <p className="text-xs text-text-muted mt-1">Optional. Paste a repo, issue, PR, or branch URL. For private repos, add a GitHub token in <a href="/settings" className="underline hover:text-text-primary">Settings</a>.</p>
            )}
          </div>

          {resolved && !resolving && githubContext && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => setAutoStart(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary"
              />
              <span className="text-sm text-text-secondary">
                {githubContext.type === 'issue'
                  ? 'Start solving issue when ready'
                  : 'Start reviewing PR when ready'}
              </span>
            </label>
           )}

          {/* Advanced Settings Toggle */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-surface-secondary transition-colors text-text-secondary hover:text-text-primary"
            >
              <Settings className="w-4 h-4" />
              {showAdvanced ? 'Hide Advanced' : 'Advanced'}
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || (isLocal && !localDir.trim())}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-on-primary hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Project'}
             </button>
           </div>
          </div>

          {/* Advanced Settings Panel */}
          <AdvancedSettingsPanel
            open={showAdvanced}
            provider={provider}
            settings={advancedSettings}
            onChange={setAdvancedSettings}
          />
        </form>
      </div>
    </div>
  );
}

function GitHubResolvePreview({ result }: { result: GitHubResolveResult }) {
  const { parsed, content } = result;
  const repo = `${parsed.owner}/${parsed.repo}`;

  let Icon = GitBranch;
  let label = '';

  switch (parsed.type) {
    case 'issue':
      Icon = CircleDot;
      label = content
        ? `Issue #${parsed.number}: ${content.title}`
        : `Issue #${parsed.number}`;
      break;
    case 'pull':
      Icon = GitPullRequest;
      label = content
        ? `PR #${parsed.number}: ${content.title}`
        : `PR #${parsed.number}`;
      break;
    case 'branch':
      Icon = GitBranch;
      label = `Branch: ${parsed.ref}`;
      break;
    case 'commit':
      Icon = GitBranch;
      label = `Commit: ${parsed.ref?.slice(0, 8)}`;
      break;
    default:
      label = 'Default branch';
  }

  const branchInfo = parsed.type === 'pull' && content?.type === 'pull'
    ? content.branch
    : parsed.type === 'branch'
      ? parsed.ref
      : parsed.type === 'commit'
        ? parsed.ref?.slice(0, 8)
        : null;

  return (
    <div className="mt-1.5 p-2 rounded-lg bg-surface-secondary border border-border text-xs space-y-1">
      <div className="flex items-center gap-1.5 text-text-primary font-medium">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="text-text-muted">
        Clone <span className="font-mono">{repo}</span>
        {branchInfo && (
          <span> &rarr; checkout <span className="font-mono">{branchInfo}</span></span>
        )}
        {parsed.type === 'issue' && <span> (default branch)</span>}
      </div>
      {content?.type === 'issue' && (content.labels?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {content.labels?.map((l) => (
            <span key={l} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}
