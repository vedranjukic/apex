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
} from 'lucide-react';
import { AppShell } from '../components/layout/app-shell';
import { secretsApi, type Secret, type CreateSecretInput } from '../api/client';

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
  const [name, setName] = useState(initial?.name || '');
  const [value, setValue] = useState(initial?.value || '');
  const [domain, setDomain] = useState(initial?.domain || '');
  const [authType, setAuthType] = useState(initial?.authType || 'bearer');
  const [customHeader, setCustomHeader] = useState('');
  const [description, setDescription] = useState(initial?.description || '');

  const isCustom = authType === 'header:X-Custom' || authType.startsWith('header:');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAuthType = isCustom && customHeader ? `header:${customHeader}` : authType;
    onSave({
      name,
      value,
      domain,
      authType: finalAuthType,
      description: description || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-surface-secondary rounded-lg p-4 border border-border">
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
            required
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
          <p className="mt-1 text-xs text-text-muted">Upstream API domain to intercept</p>
        </div>
      </div>

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
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          >
            {AUTH_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            {AUTH_TYPES.find((t) => t.value === (isCustom ? 'header:X-Custom' : authType))?.hint}
          </p>
        </div>
        {isCustom && (
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
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {initial ? 'Update' : 'Add Secret'}
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
  }, []);

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
                Secrets
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                API keys injected transparently into outbound HTTPS requests.
                Values never enter sandbox containers.
              </p>
            </div>
            {!showForm && !editingId && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Secret
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
                <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No secrets configured yet.</p>
                <p className="text-xs mt-1">
                  Add API keys that will be transparently injected into HTTPS requests
                  from your sandbox containers.
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
                      <span className="font-mono text-sm font-medium text-text-primary">
                        {secret.name}
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface text-text-muted border border-border">
                        {secret.authType}
                      </span>
                      {secret.projectId && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                          project
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      {secret.domain}
                      {secret.description && ` — ${secret.description}`}
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
