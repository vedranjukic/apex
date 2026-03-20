import { Elysia } from 'elysia';
import { projectsService } from './projects.service';
import { usersService } from '../users/users.service';

export const projectsRoutes = new Elysia({ prefix: '/api/projects' })
  .get('/', () => {
    const userId = usersService.getDefaultUserId();
    return projectsService.findAllByUser(userId);
  })
  .post('/', async ({ body }) => {
    const userId = usersService.getDefaultUserId();
    return projectsService.create(userId, body as any);
  })
  .get('/:id', ({ params }) => projectsService.findById(params.id))
  .patch('/:id', async ({ params, body }) => projectsService.update(params.id, body as any))
  .delete('/:id', async ({ params }) => {
    await projectsService.remove(params.id);
    return { ok: true };
  })
  .post('/:id/fork', async ({ params, body }) => {
    const { branchName } = body as { branchName: string };
    return projectsService.forkProject(params.id, branchName);
  })
  .get('/:id/forks', ({ params }) => projectsService.findForkFamily(params.id))
  .post('/:id/ssh-access', async ({ params, set }) => {
    const project = await projectsService.findById(params.id);
    if (!project.sandboxId) {
      set.status = 503;
      return { error: 'Sandbox not ready' };
    }
    const sm = projectsService.getSandboxManager();
    if (!sm) {
      set.status = 503;
      return { error: 'Sandbox manager not available' };
    }
    try {
      return await sm.createSshAccess(project.sandboxId);
    } catch (err) {
      set.status = 500;
      return { error: `Failed to create SSH access: ${err}` };
    }
  })
  .get('/:id/vscode-url', async ({ params, set }) => {
    const project = await projectsService.findById(params.id);
    if (!project.sandboxId) {
      set.status = 503;
      return { error: 'Sandbox not ready' };
    }
    const sm = projectsService.getSandboxManager();
    if (!sm) {
      set.status = 503;
      return { error: 'Sandbox manager not available' };
    }
    try {
      const { url, token } = await sm.getVscodeUrl(project.sandboxId);
      return { url, token };
    } catch (err) {
      set.status = 500;
      return { error: `Failed to get VS Code URL: ${err}` };
    }
  });
