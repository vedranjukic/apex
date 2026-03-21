import { useState, FormEvent } from 'react';
import { X, Cloud, Container } from 'lucide-react';
import { useProjectsStore } from '../../stores/projects-store';
import { cn } from '../../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const PROVIDERS = [
  { value: 'daytona', label: 'Daytona', sublabel: 'Cloud sandbox', icon: Cloud },
  { value: 'docker', label: 'Docker', sublabel: 'Local container', icon: Container },
] as const;

export function CreateProjectDialog({ open, onClose, onCreated }: Props) {
  const createProject = useProjectsStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('daytona');
  const [gitRepo, setGitRepo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        provider,
        gitRepo: gitRepo.trim() || undefined,
      });
      onCreated(project.id);
      setName('');
      setDescription('');
      setProvider('daytona');
      setGitRepo('');
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
              {PROVIDERS.map((p) => {
                const Icon = p.icon;
                const selected = provider === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setProvider(p.value)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors text-left',
                      selected
                        ? 'border-primary bg-primary/10 text-text-primary'
                        : 'border-border hover:border-text-muted text-text-muted',
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs opacity-70">{p.sublabel}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

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
              disabled={submitting || !name.trim()}
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
