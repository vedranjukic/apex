import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  GitBranch,
  Settings,
  Trash2,
  Package,
  KeyRound,
  Shield,
  Database,
  Plus,
} from 'lucide-react';
import { AppShell } from '../components/layout/app-shell';
import { repositoriesApi, type RepositoryInfo } from '../api/client';
import { AddRepositoryDialog } from '../components/repositories/add-repository-dialog';

export function RepositoriesPage() {
  const navigate = useNavigate();
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const fetchRepositories = async () => {
    try {
      const list = await repositoriesApi.list();
      setRepositories(list);
    } catch {
      // API not available yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepositories();
  }, []);

  const handleManageSecrets = (repositoryId: string) => {
    navigate(`/repositories/${encodeURIComponent(repositoryId)}/secrets`);
  };

  const handleDeleteRepository = async (repositoryId: string) => {
    if (!confirm(`Are you sure you want to delete all secrets for ${repositoryId}? This cannot be undone.`)) {
      return;
    }

    setDeleting(repositoryId);
    try {
      await repositoriesApi.delete(repositoryId);
      await fetchRepositories();
    } catch (err) {
      console.error('Failed to delete repository:', err);
      alert('Failed to delete repository. Please try again.');
    } finally {
      setDeleting(null);
    }
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
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </button>

          <div className="mb-6">
            <div className="flex items-center justify-between gap-4 mb-1">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <GitBranch className="w-6 h-6" />
                Repositories
              </h1>
              <button
                onClick={() => setShowAddDialog(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm hover:bg-primary-hover transition-colors shrink-0"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
            <p className="text-sm text-text-secondary mt-3">
              Manage repository-scoped secrets and environment variables.
              These are available to all projects that use the same GitHub repository.
            </p>
            <p className="text-xs text-text-muted mt-2">
              Repositories are automatically discovered from your projects' Git URLs, or you can add them manually. 
              Added repositories appear immediately and can be configured with secrets and environment variables.
            </p>
          </div>

          <div className="space-y-3">
            {repositories.length === 0 ? (
              <div className="text-center py-12 text-text-muted">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No repositories found.</p>
              <p className="text-xs mt-1">
                Create projects from GitHub repositories or manually add repositories above,
                then add secrets to see them here.
              </p>
              </div>
            ) : (
              repositories.map((repository) => (
                <div
                  key={repository.repositoryId}
                  className="flex items-center justify-between p-6 rounded-lg bg-surface-secondary border border-border hover:bg-surface transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-base font-semibold text-text-primary">
                        {repository.repositoryId}
                      </h3>
                      <div className="flex items-center gap-2">
                        {repository.secretCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                            <Shield className="w-3 h-3" />
                            {repository.secretCount} secret{repository.secretCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {repository.envVarCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface text-text-muted text-xs font-medium border border-border">
                            <Database className="w-3 h-3" />
                            {repository.envVarCount} env var{repository.envVarCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-text-muted">
                      <span className="flex items-center gap-1">
                        <KeyRound className="w-4 h-4" />
                        Total: {repository.totalCount} item{repository.totalCount !== 1 ? 's' : ''}
                      </span>
                      {repository.projectCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Package className="w-4 h-4" />
                          {repository.projectCount} project{repository.projectCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {repository.lastModified && (
                        <span>
                          Updated {new Date(repository.lastModified).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleManageSecrets(repository.repositoryId)}
                      className="p-2 rounded-lg text-primary hover:text-primary-hover hover:bg-surface-secondary transition-colors"
                      title="Manage secrets and environment variables"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteRepository(repository.repositoryId)}
                      disabled={deleting === repository.repositoryId || repository.projectCount > 0}
                      className="p-2 rounded-lg hover:bg-surface text-text-muted hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={repository.projectCount > 0 ? 'Cannot delete - repository has associated projects' : 'Delete all secrets for this repository'}
                    >
                      {deleting === repository.repositoryId ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <AddRepositoryDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onRepositoryAdded={() => {
          fetchRepositories();
        }}
      />
    </AppShell>
  );
}