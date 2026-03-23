import { Elysia } from 'elysia';
import { secretsService } from './secrets.service';
import { usersService } from '../users/users.service';
import { projectsService } from '../projects/projects.service';

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

export const secretsRoutes = new Elysia({ prefix: '/api/secrets' })
  .get('/', async ({ query }) => {
    const userId = usersService.getDefaultUserId();
    const projectId = (query as Record<string, string>).projectId;
    const items = await secretsService.list(userId, projectId);
    return items;
  })
  .post('/', async ({ body }) => {
    const userId = usersService.getDefaultUserId();
    const input = body as {
      name: string;
      value: string;
      domain: string;
      authType?: string;
      description?: string;
      projectId?: string | null;
    };
    const record = await secretsService.create(userId, input);
    await projectsService.reinitSandboxManager();
    return { ...record, value: maskValue(record.value) };
  })
  .put('/:id', async ({ params, body }) => {
    const userId = usersService.getDefaultUserId();
    const updates = body as {
      name?: string;
      value?: string;
      domain?: string;
      authType?: string;
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
    await projectsService.reinitSandboxManager();
    return { ok: true };
  });
