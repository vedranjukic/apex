import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  KeyRound,
  Shield,
  Variable,
  GitBranch,
  Globe,
} from 'lucide-react';
import { AppShell } from '../components/layout/app-shell';
import { secretsApi, type Secret, type CreateSecretInput } from '../api/client';
import { useProjectsStore } from '../stores/projects-store';

const AUTH_TYPES = [
  { value: 'bearer', label: 'Bearer Token', hint: 'Authorization: Bearer <value>' },
  { value: 'x-api-key', label: 'X-API-Key', hint: 'x-api-key: <value>' },
  { value: 'basic', label: 'Basic Auth', hint: 'Authorization: Basic base64(<value>)' },
  { value: 'header:X-Custom', label: 'Custom Header', hint: '<header>: <value>' },
];

function SecretForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<CreateSecretInput>;
  onSave: (data: CreateSecretInput) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { projects } = useProjectsStore();
  const [name, setName] = useState(initial?.name || '');
  const [value, setValue] = useState(initial?.value || '');
  const [domain, setDomain] = useState(initial?.domain || '');
  const [authType, setAuthType] = useState(initial?.authType || 'bearer');
  const [customHeader, setCustomHeader] = useState('');
  const [description, setDescription] = useState(initial?.description || '');
  const [isSecret, setIsSecret] = useState(initial?.isSecret ?? true);
  const [repositoryId, setRepositoryId] = useState(initial?.repositoryId || '');

  const isCustom = authType === 'header:X-Custom' || authType.startsWith('header:');
  
  // Get repositories from projects that have git repos
  const repositories = projects
    .filter(p => p.gitRepo)
    .map(p => {
      // Extract repository ID from git URL (e.g., "https://github.com/owner/repo" -> "owner/repo")
      const match = p.gitRepo?.match(/github\.com\/([^\/]+\/[^\/]+)/);
      return {
        id: match?.[1] || p.gitRepo || '',
        name: match?.[1] || p.name,
        projectName: p.name
      };
    })
    .filter(r => r.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAuthType = isCustom && customHeader ? `header:${customHeader}` : authType;
    onSave({
      name,
      value,
      domain: isSecret ? domain : '',
      authType: isSecret ? finalAuthType : 'bearer',
      isSecret,
      repositoryId: repositoryId || undefined,
      description: description || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-surface-secondary rounded-lg p-4 border border-border">
      {/* Is Secret checkbox */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface">
        <input
          type="checkbox"
          id="is-secret"
          checked={isSecret}
          onChange={(e) => setIsSecret(e.target.checked)}
          className="w-4 h-4 rounded border-border text-primary focus:ring-1 focus:ring-primary"
        />
        <label htmlFor="is-secret" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          {isSecret ? <Shield className="w-4 h-4 text-primary" /> : <Variable className="w-4 h-4 text-text-muted" />}
          {isSecret ? 'Secret (via MITM proxy)' : 'Environment Variable (direct injection)'}
        </label>
      </div>
      <p className="text-xs text-text-muted -mt-2 ml-7">
        {isSecret 
          ? 'Secrets are injected via MITM proxy and never enter containers. Requires domain and auth type.'
          : 'Environment variables are injected directly into containers. Domain and auth type not needed.'
        }
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="STRIPE_KEY"
            required
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
          <p className="mt-1 text-xs text-text-muted">Environment variable name</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Domain</label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="api.stripe.com"
            required={isSecret}
            disabled={!isSecret}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-text-muted">
            {isSecret ? 'Upstream API domain to intercept' : 'Not needed for environment variables'}
          </p>
        </div>
      </div>

      {/* Repository Selection */}
      {repositories.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Repository Scope (Optional)</label>
          <select
            value={repositoryId}
            onChange={(e) => setRepositoryId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          >
            <option value="">Global (all projects)</option>
            {repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name} ({repo.projectName})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            Limit this {isSecret ? 'secret' : 'environment variable'} to a specific repository
          </p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Secret Value</label>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={initial ? '(unchanged)' : 'sk_live_...'}
          required={!initial}
          autoComplete="off"
          className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Auth Type</label>
          <select
            value={isCustom ? 'header:X-Custom' : authType}
            onChange={(e) => setAuthType(e.target.value)}
            disabled={!isSecret}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {AUTH_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            {isSecret 
              ? AUTH_TYPES.find((t) => t.value === (isCustom ? 'header:X-Custom' : authType))?.hint
              : 'Not needed for environment variables'
            }
          </p>
        </div>
        {isCustom && isSecret && (
          <div>
            <label className="block text-sm font-medium mb-1">Header Name</label>
            <input
              type="text"
              value={customHeader}
              onChange={(e) => setCustomHeader(e.target.value)}
              placeholder="X-Custom-Key"
              required
              className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Production Stripe API key"
          className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {initial ? 'Update' : `Add ${isSecret ? 'Secret' : 'Environment Variable'}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SecretsPage() {
  const navigate = useNavigate();
  const { fetchProjects } = useProjectsStore();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSecrets = async () => {
    try {
      const list = await secretsApi.list();
      setSecrets(list);
    } catch {
      // API not available yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecrets();
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async (data: CreateSecretInput) => {
    setSaving(true);
    try {
      await secretsApi.create(data);
      setShowForm(false);
      await fetchSecrets();
    } catch (err) {
      console.error('Failed to create secret:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (data: CreateSecretInput) => {
    if (!editingId) return;
    setSaving(true);
    try {
      await secretsApi.update(editingId, data);
      setEditingId(null);
      await fetchSecrets();
    } catch (err) {
      console.error('Failed to update secret:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await secretsApi.delete(id);
      await fetchSecrets();
    } catch (err) {
      console.error('Failed to delete secret:', err);
    } finally {
      setDeletingId(null);
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
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </button>

          <div className="flex items-start justify-between mb-2">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Shield className="w-6 h-6" />
                Secrets & Environment Variables
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                Secrets are injected via MITM proxy, environment variables are injected directly.
                Secret values never enter sandbox containers.
              </p>
            </div>
            {!showForm && !editingId && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 px-3 py-2 bg-primary text-on-primary rounded-lg text-sm hover:bg-primary-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Secret/Env Var
              </button>
            )}
          </div>

          {showForm && (
            <div className="mt-6">
              <SecretForm
                onSave={handleCreate}
                onCancel={() => setShowForm(false)}
                saving={saving}
              />
            </div>
          )}

          <div className="mt-6 space-y-3">
            {secrets.length === 0 && !showForm && (
              <div className="text-center py-12 text-text-muted">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <Shield className="w-10 h-10 opacity-40" />
                  <Variable className="w-10 h-10 opacity-40" />
                </div>
                <p className="text-sm">No secrets or environment variables configured yet.</p>
                <p className="text-xs mt-1">
                  Add secrets (via MITM proxy) or environment variables (direct injection)
                  for your sandbox containers.
                </p>
              </div>
            )}

            {secrets.map((secret) =>
              editingId === secret.id ? (
                <div key={secret.id}>
                  <SecretForm
                    initial={{
                      name: secret.name,
                      domain: secret.domain,
                      authType: secret.authType,
                      isSecret: secret.isSecret,
                      repositoryId: secret.repositoryId || '',
                      description: secret.description || '',
                    }}
                    onSave={handleUpdate}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                </div>
              ) : (
                <div
                  key={secret.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-surface-secondary border border-border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {secret.isSecret ? (
                        <Shield className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <Variable className="w-3.5 h-3.5 text-text-muted" />
                      )}
                      <span className="font-mono text-sm font-medium text-text-primary">
                        {secret.name}
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                        secret.isSecret 
                          ? 'bg-primary/10 text-primary border-primary/20' 
                          : 'bg-surface text-text-muted border-border'
                      }`}>
                        {secret.isSecret ? 'secret' : 'env var'}
                      </span>
                      {secret.isSecret && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface text-text-muted border border-border">
                          {secret.authType}
                        </span>
                      )}
                      {secret.repositoryId && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 flex items-center gap-1">
                          <GitBranch className="w-2.5 h-2.5" />
                          {secret.repositoryId}
                        </span>
                      )}
                      {secret.projectId && !secret.repositoryId && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                          project
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-1 flex items-center gap-1">
                      {secret.isSecret && secret.domain && (
                        <>
                          <Globe className="w-3 h-3" />
                          {secret.domain}
                          {secret.description && ` — ${secret.description}`}
                        </>
                      )}
                      {!secret.isSecret && (
                        <>
                          <Variable className="w-3 h-3" />
                          Environment variable
                          {secret.description && ` — ${secret.description}`}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <button
                      onClick={() => setEditingId(secret.id)}
                      className="p-1.5 rounded hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(secret.id)}
                      disabled={deletingId === secret.id}
                      className="p-1.5 rounded hover:bg-surface text-text-muted hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      {deletingId === secret.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
