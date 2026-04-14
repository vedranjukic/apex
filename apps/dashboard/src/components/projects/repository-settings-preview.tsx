import { Key, Variable, Loader2, AlertCircle, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { Secret } from '../../api/client';
import { cn } from '../../lib/cn';

interface RepositorySettingsPreviewProps {
  repositoryId: string;
  secrets: Secret[];
  environmentVariables: Secret[];
  isLoading: boolean;
  error: string | null;
  className?: string;
}

export function RepositorySettingsModal({
  repositoryId,
  secrets,
  environmentVariables,
  isOpen,
  onClose,
}: {
  repositoryId: string;
  secrets: Secret[];
  environmentVariables: Secret[];
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Repository Settings</h2>
            <p className="text-sm text-text-secondary mt-1">
              Settings from <span className="font-mono">{repositoryId}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <p className="text-sm text-text-muted">
            These settings will be automatically applied to your new project. They are inherited from the repository configuration.
          </p>

          {secrets.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-primary" />
                <span className="font-medium">Secrets ({secrets.length})</span>
              </div>
              <div className="space-y-2">
                {secrets.map((secret) => (
                  <div key={secret.id} className="p-3 rounded-lg bg-surface-secondary border border-border">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{secret.name}</span>
                      <span className="text-text-muted">→</span>
                      <span className="text-sm text-text-secondary">{secret.domain}</span>
                    </div>
                    {secret.description && (
                      <p className="text-xs text-text-muted mt-1">{secret.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {environmentVariables.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Variable className="w-4 h-4 text-primary" />
                <span className="font-medium">Environment Variables ({environmentVariables.length})</span>
              </div>
              <div className="space-y-2">
                {environmentVariables.map((envVar) => (
                  <div key={envVar.id} className="p-3 rounded-lg bg-surface-secondary border border-border">
                    <span className="font-mono text-sm font-medium">{envVar.name}</span>
                    {envVar.description && (
                      <p className="text-xs text-text-muted mt-1">{envVar.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RepositorySettingsPreview({
  repositoryId,
  secrets,
  environmentVariables,
  isLoading,
  error,
  className,
}: RepositorySettingsPreviewProps) {
  const [showModal, setShowModal] = useState(false);

  const totalCount = secrets.length + environmentVariables.length;

  if (isLoading) {
    return (
      <div className={cn('p-3 rounded-lg border border-border bg-surface-secondary', className)}>
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading repository settings...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('p-3 rounded-lg border border-red-300 bg-red-50', className)}>
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="w-4 h-4" />
          <span>Failed to load repository settings: {error}</span>
        </div>
      </div>
    );
  }

  if (totalCount === 0) {
    return null; // Don't show anything if no repository settings
  }

  return (
    <>
      <div className={cn('p-3 rounded-lg border border-blue-300 bg-blue-50/50', className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm font-medium text-blue-900">
              Repository Settings
            </span>
            <span className="text-xs text-blue-700 bg-blue-200 px-2 py-0.5 rounded-full">
              {totalCount} setting{totalCount !== 1 ? 's' : ''} will be applied
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-xs text-blue-700 hover:text-blue-900 transition-colors"
          >
            <span>View details</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>

      <RepositorySettingsModal
        repositoryId={repositoryId}
        secrets={secrets}
        environmentVariables={environmentVariables}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}