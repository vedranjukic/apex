import { Elysia } from 'elysia';
import { threadsService } from './tasks.service';

export const threadsRoutes = new Elysia({ prefix: '/api' })
  .get('/projects/:id/threads', async ({ params, query }) => {
    const threads = await threadsService.findByProject(params.id);
    const search = (query as Record<string, string>).search;
    if (search) {
      const q = search.toLowerCase();
      return threads.filter((c) => c.title.toLowerCase().includes(q));
    }
    return threads;
  })
  .post('/projects/:id/threads', async ({ params, body }) => {
    const { prompt, agentType } = body as { prompt: string; agentType?: string };
    return threadsService.create(params.id, { prompt, agentType });
  })
  .get('/threads/:id', ({ params }) => threadsService.findById(params.id))
  .get('/threads/:id/messages', ({ params }) => threadsService.getMessages(params.id))
  .patch('/threads/:id/status', async ({ params, body }) => {
    const { status } = body as { status: string };
    return threadsService.updateStatus(params.id, status);
  })
  .delete('/threads/:id', async ({ params }) => {
    await threadsService.remove(params.id);
    return { ok: true };
  });
