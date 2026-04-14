import { useState, FormEvent } from 'react';
import { X, GitBranch, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { repositoriesApi } from '../../api/client';
import { parseGitHubUrl } from '@apex/shared';
import { cn } from '../../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  onRepositoryAdded: () => void;
}

export function AddRepositoryDialog({ open, onClose, onRepositoryAdded }: Props) {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!open) return null;

  const parsed = repositoryUrl ? parseGitHubUrl(repositoryUrl) : null;
  const isValidUrl = parsed !== null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!repositoryUrl.trim() || !isValidUrl || submitting) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await repositoriesApi.create(repositoryUrl.trim());
      if (result.success) {
        setSuccess(`Repository ${result.repositoryId} added successfully! You can now configure secrets for it.`);
        setRepositoryUrl('');
        // Refresh the repositories list to show the newly added repository
        onRepositoryAdded();
        // Don't close immediately - show success message first
        setTimeout(() => {
          setSuccess(null);
          onClose();
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add repository');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setRepositoryUrl('');
    setError(null);
    setSuccess(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Add
          </h2>
          <button onClick={handleClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">GitHub Repository URL</label>
            <input
              autoFocus
              type="url"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={submitting}
            />
            <p className="text-xs text-text-muted mt-1">
              Enter a GitHub repository URL to add it to your repositories list
            </p>
          </div>

          {repositoryUrl && (
            <div className={cn(
              "mt-1.5 p-2 rounded-lg border text-xs",
              isValidUrl 
                ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400"
                : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400"
            )}>
              <div className="flex items-center gap-1.5">
                {isValidUrl ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Valid GitHub repository: {parsed?.owner}/{parsed?.repo}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Invalid GitHub URL format</span>
                  </>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400 text-xs">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {success && (
            <div className="p-2 rounded-lg bg-green-50 border border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400 text-xs">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{success}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-surface-secondary transition-colors"
              disabled={submitting}
            >
              {success ? 'Close' : 'Cancel'}
            </button>
            {!success && (
              <button
                type="submit"
                disabled={!isValidUrl || submitting}
                className="flex-1 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add'
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}