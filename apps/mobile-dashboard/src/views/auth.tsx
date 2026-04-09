import { useState } from 'react';
import { setToken, api } from '../api';

export function AuthScreen() {
  const [token, setTokenValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    setToken(token.trim());
    try {
      await api.health();
      window.location.hash = '#/';
    } catch {
      setError('Invalid token or unreachable API');
      setToken('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text">Apex Mobile</h1>
          <p className="mt-2 text-sm text-text-secondary">Enter your proxy auth token to continue</p>
        </div>

        <input
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="sk-proxy-..."
          autoFocus
          className="w-full rounded-lg border border-border bg-surface-card px-4 py-3 text-text placeholder-text-muted outline-none focus:border-primary"
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={loading || !token.trim()}
          className="w-full rounded-lg bg-primary py-3 font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
