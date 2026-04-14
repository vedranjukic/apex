import { Elysia } from 'elysia';
import { projectsService } from './projects.service';
import { usersService } from '../users/users.service';
import { proxyProjectsService } from '../llm-proxy/proxy-projects.service';

export const projectsRoutes = new Elysia({ prefix: '/api/projects' })
  .get('/providers', () => {
    return projectsService.getProviderStatuses();
  })
  .post('/reinit-providers', async ({ set }) => {
    try {
      await projectsService.reinitSandboxManager();
      return { ok: true };
    } catch (err) {
      set.status = 500;
      return { error: `Failed to reinit providers: ${err}` };
    }
  })
  .get('/remote', async ({ set }) => {
    try {
      return await proxyProjectsService.listProjects();
    } catch (err) {
      set.status = 502;
      return { error: `Failed to fetch remote projects: ${err}` };
    }
  })
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
  .patch('/:id/merge-status', async ({ params, body }) => {
    const { mergeStatus } = body as { mergeStatus: any };
    return projectsService.updateMergeStatus(params.id, mergeStatus);
  })
  .post('/:id/merge-status/refresh', async ({ params, set }) => {
    try {
      return await projectsService.refreshMergeStatusFromGitHub(params.id);
    } catch (err) {
      set.status = 500;
      return { error: `Failed to refresh merge status: ${err}` };
    }
  })
  .post('/merge-status/batch-refresh', async ({ body, set }) => {
    try {
      const { projectIds } = body as { projectIds?: string[] };
      return await projectsService.batchRefreshMergeStatus(projectIds);
    } catch (err) {
      set.status = 500;
      return { error: `Failed to batch refresh merge status: ${err}` };
    }
  })
  .delete('/:id', async ({ params }) => {
    await projectsService.remove(params.id);
    return { ok: true };
  })
  .post('/:id/stop', async ({ params, set }) => {
    try {
      return await projectsService.stopProject(params.id);
    } catch (err) {
      set.status = 500;
      return { error: `Failed to stop sandbox: ${err}` };
    }
  })
  .post('/:id/start', async ({ params, set }) => {
    try {
      const project = await projectsService.findById(params.id);
      projectsService.startOrProvisionSandbox(params.id).catch((err) => {
        console.error(`[projects] Background start failed for ${params.id}:`, err);
      });
      return project;
    } catch (err) {
      set.status = 500;
      return { error: `Failed to start sandbox: ${err}` };
    }
  })
  .post('/:id/restart', async ({ params, set }) => {
    try {
      return await projectsService.restartProject(params.id);
    } catch (err) {
      set.status = 500;
      return { error: `Failed to restart sandbox: ${err}` };
    }
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
    const sm = projectsService.getSandboxManager(project.provider);
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
    const sm = projectsService.getSandboxManager(project.provider);
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
