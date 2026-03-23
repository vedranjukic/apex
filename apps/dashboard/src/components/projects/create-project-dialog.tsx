import { useState, useEffect, FormEvent } from 'react';
import { X, Cloud, Container, Laptop, FolderOpen, FolderSearch } from 'lucide-react';
import { useProjectsStore } from '../../stores/projects-store';
import { configApi, type ProviderStatus } from '../../api/client';
import { cn } from '../../lib/cn';
import { FolderBrowser } from './folder-browser';

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

  useEffect(() => {
    if (!open) return;
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

  const orderedStatuses = PROVIDER_ORDER
    .map((type) => providerStatuses.find((s) => s.type === type))
    .filter((s): s is ProviderStatus => !!s);

  if (!open) return null;

  const isLocal = provider === 'local';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (isLocal && !localDir.trim()) return;
    setSubmitting(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        provider,
        gitRepo: gitRepo.trim() || undefined,
        localDir: isLocal ? localDir.trim() : undefined,
      });
      onCreated(project.id);
      setName('');
      setDescription('');
      setProvider(providerStatuses.find((p) => p.available)?.type ?? '');
      setGitRepo('');
      setLocalDir('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New Project</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
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
              onChange={(e) => setGitRepo(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-text-muted mt-1">Optional. The repo will be cloned into the project folder. For private repos, add a GitHub token in <a href="/settings" className="underline hover:text-text-primary">Settings</a>.</p>
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
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
