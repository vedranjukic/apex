import { useState, FormEvent } from 'react';
import { X } from 'lucide-react';
import { useProjectsStore } from '../../stores/projects-store';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function CreateProjectDialog({ open, onClose, onCreated }: Props) {
  const createProject = useProjectsStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gitRepo, setGitRepo] = useState('');
  const [agentType, setAgentType] = useState('claude_code');
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
        agentType,
        gitRepo: gitRepo.trim() || undefined,
      });
      onCreated(project.id);
      setName('');
      setDescription('');
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
            <p className="text-xs text-text-muted mt-1">Optional. The repo will be cloned into the project folder.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Agent</label>
            <select
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-surface"
            >
              <option value="claude_code">Claude Code</option>
              <option value="open_code">OpenCode</option>
            </select>
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
