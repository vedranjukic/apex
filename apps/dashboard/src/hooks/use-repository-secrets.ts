import { useState, useEffect } from 'react';
import { secretsApi, type Secret } from '../api/client';

interface RepositorySecrets {
  secrets: Secret[];
  environmentVariables: Secret[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to fetch repository-scoped secrets and environment variables
 * for a given GitHub repository identifier (owner/repo format)
 */
export function useRepositorySecrets(repositoryId: string | null): RepositorySecrets {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [environmentVariables, setEnvironmentVariables] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repositoryId) {
      setSecrets([]);
      setEnvironmentVariables([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    secretsApi.list(undefined, repositoryId)
      .then((allSecrets) => {
        const repoSecrets = allSecrets.filter(s => s.isSecret);
        const repoEnvVars = allSecrets.filter(s => !s.isSecret);
        setSecrets(repoSecrets);
        setEnvironmentVariables(repoEnvVars);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSecrets([]);
        setEnvironmentVariables([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [repositoryId]);

  return {
    secrets,
    environmentVariables,
    isLoading,
    error,
  };
}