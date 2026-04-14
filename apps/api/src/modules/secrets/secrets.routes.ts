import { Elysia } from 'elysia';
import { secretsService } from './secrets.service';
import { usersService } from '../users/users.service';
import { projectsService } from '../projects/projects.service';
import { restartSecretsProxy } from '../secrets-proxy/secrets-proxy';

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

export const secretsRoutes = new Elysia({ prefix: '/api/secrets' })
  .get('/', async ({ query }) => {
    const userId = usersService.getDefaultUserId();
    const projectId = (query as Record<string, string>).projectId;
    const repositoryId = (query as Record<string, string>).repositoryId;
    const scope = (query as Record<string, string>).scope;
    const items = await secretsService.list(userId, projectId, repositoryId, scope);
    return items;
  })
  // Repository-scoped secrets endpoints
  .get('/repositories', async () => {
    const userId = usersService.getDefaultUserId();
    const repositories = await secretsService.listRepositories(userId);
    return repositories;
  })
  .post('/repositories', async ({ body }) => {
    console.log('=== Repository creation route called ===');
    const userId = usersService.getDefaultUserId();
    const input = body as { repositoryUrl: string };
    console.log('About to call secretsService.createRepository');
    const result = await secretsService.createRepository(userId, input.repositoryUrl);
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return result;
  })
  .delete('/repositories/:repositoryId', async ({ params }) => {
    const userId = usersService.getDefaultUserId();
    const repositoryId = decodeURIComponent(params.repositoryId);
    const ok = await secretsService.removeRepository(userId, repositoryId);
    projectsService.reinitSandboxManager().catch(() => {});
    projectsService.updateSecretDomainsOnManagers().catch(() => {});
    projectsService.updateContextSecretsOnManagers(undefined, repositoryId).catch(() => {});
    restartSecretsProxy().catch(() => {});
    return { ok };
  })
  .get('/repositories/:repositoryId', async ({ params }) => {
    const userId = usersService.getDefaultUserId();
    const repositoryId = decodeURIComponent(params.repositoryId);
    const items = await secretsService.listRepositorySecrets(userId, repositoryId);
    return items;
  })
  .post('/repositories/:repositoryId', async ({ params, body }) => {
    const userId = usersService.getDefaultUserId();
    const repositoryId = decodeURIComponent(params.repositoryId);
    const input = body as {
      name: string;
      value: string;
      domain: string;
      authType?: string;
      isSecret?: boolean;
      description?: string;
    };
    
    const record = await secretsService.createRepositorySecret(userId, repositoryId, input);
    projectsService.reinitSandboxManager().catch(() => {});
    projectsService.updateSecretDomainsOnManagers().catch(() => {});
    projectsService.updateContextSecretsOnManagers(undefined, repositoryId).catch(() => {});
    restartSecretsProxy().catch(() => {});
    return { ...record, value: maskValue(record.value) };
  })
  .put('/repositories/:repositoryId/:id', async ({ params, body }) => {
    const userId = usersService.getDefaultUserId();
    const repositoryId = decodeURIComponent(params.repositoryId);
    const updates = body as {
      name?: string;
      value?: string;
      domain?: string;
      authType?: string;
      isSecret?: boolean;
      description?: string;
    };
    
    if (updates.value?.includes('••••')) {
      delete updates.value;
    }
    
    const record = await secretsService.updateRepositorySecret(params.id, userId, repositoryId, updates);
    if (!record) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (updates.domain !== undefined) {
      projectsService.updateSecretDomainsOnManagers().catch(() => {});
    }
    projectsService.updateContextSecretsOnManagers(undefined, repositoryId).catch(() => {});
    restartSecretsProxy().catch(() => {});
    return { ...record, value: maskValue(record.value) };
  })
  .delete('/repositories/:repositoryId/:id', async ({ params }) => {
    const userId = usersService.getDefaultUserId();
    const repositoryId = decodeURIComponent(params.repositoryId);
    const ok = await secretsService.removeRepositorySecret(params.id, userId, repositoryId);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    projectsService.reinitSandboxManager().catch(() => {});
    projectsService.updateSecretDomainsOnManagers().catch(() => {});
    projectsService.updateContextSecretsOnManagers(undefined, repositoryId).catch(() => {});
    restartSecretsProxy().catch(() => {});
    return { ok: true };
  })
  .post('/', async ({ body }) => {
    const userId = usersService.getDefaultUserId();
    const input = body as {
      name: string;
      value: string;
      domain: string;
      authType?: string;
      isSecret?: boolean;
      description?: string;
      projectId?: string | null;
    };
    const record = await secretsService.create(userId, input);
    projectsService.reinitSandboxManager().catch(() => {});
    projectsService.updateSecretDomainsOnManagers().catch(() => {});
    projectsService.updateContextSecretsOnManagers(input.projectId || undefined, undefined).catch(() => {});
    restartSecretsProxy().catch(() => {});
    return { ...record, value: maskValue(record.value) };
  })
  .put('/:id', async ({ params, body }) => {
    const userId = usersService.getDefaultUserId();
    const updates = body as {
      name?: string;
      value?: string;
      domain?: string;
      authType?: string;
      isSecret?: boolean;
      description?: string;
      projectId?: string | null;
    };
    if (updates.value?.includes('••••')) {
      delete updates.value;
    }
    const record = await secretsService.update(params.id, userId, updates);
    if (!record) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (updates.domain !== undefined) {
      projectsService.updateSecretDomainsOnManagers().catch(() => {});
    }
    projectsService.updateContextSecretsOnManagers(updates.projectId || undefined, undefined).catch(() => {});
    restartSecretsProxy().catch(() => {});
    return { ...record, value: maskValue(record.value) };
  })
  .delete('/:id', async ({ params }) => {
    const userId = usersService.getDefaultUserId();
    const ok = await secretsService.remove(params.id, userId);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    projectsService.reinitSandboxManager().catch(() => {});
    projectsService.updateSecretDomainsOnManagers().catch(() => {});
    projectsService.updateContextSecretsOnManagers(undefined, undefined).catch(() => {}); // Global cache clear for delete
    restartSecretsProxy().catch(() => {});
    return { ok: true };
  });
