import { Key, Variable, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
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

export function RepositorySettingsPreview({
  repositoryId,
  secrets,
  environmentVariables,
  isLoading,
  error,
  className,
}: RepositorySettingsPreviewProps) {
  const [collapsed, setCollapsed] = useState(false);

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
    <div className={cn('p-3 rounded-lg border border-blue-300 bg-blue-50/50', className)}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm font-medium text-blue-900">
              Repository Settings ({repositoryId})
            </span>
            <span className="text-xs text-blue-700 bg-blue-200 px-2 py-0.5 rounded-full">
              {totalCount} setting{totalCount !== 1 ? 's' : ''}
            </span>
          </div>
          {totalCount > 0 && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="text-blue-700 hover:text-blue-900 transition-colors"
              title={collapsed ? 'Show details' : 'Hide details'}
            >
              {collapsed ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-blue-800">
          These settings will be automatically applied to your new project. They are inherited from the repository configuration.
        </p>

        {/* Settings list */}
        {!collapsed && (
          <div className="space-y-2">
            {secrets.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Key className="w-3.5 h-3.5 text-blue-700" />
                  <span className="text-xs font-medium text-blue-900">
                    Secrets ({secrets.length})
                  </span>
                </div>
                <div className="pl-5 space-y-1">
                  {secrets.map((secret) => (
                    <div key={secret.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-blue-800">{secret.name}</span>
                      <span className="text-blue-600">→</span>
                      <span className="text-blue-700">{secret.domain}</span>
                      {secret.description && (
                        <span className="text-blue-600 italic">({secret.description})</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {environmentVariables.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Variable className="w-3.5 h-3.5 text-blue-700" />
                  <span className="text-xs font-medium text-blue-900">
                    Environment Variables ({environmentVariables.length})
                  </span>
                </div>
                <div className="pl-5 space-y-1">
                  {environmentVariables.map((envVar) => (
                    <div key={envVar.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-blue-800">{envVar.name}</span>
                      {envVar.description && (
                        <span className="text-blue-600 italic">({envVar.description})</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}