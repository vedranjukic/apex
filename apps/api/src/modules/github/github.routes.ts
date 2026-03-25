import { Elysia } from 'elysia';
import { githubService } from './github.service';

export const githubRoutes = new Elysia({ prefix: '/api/github' })
  .get('/resolve', async ({ query, set }) => {
    const url = query['url'];
    if (!url || typeof url !== 'string') {
      set.status = 400;
      return { error: 'Missing url query parameter' };
    }
    try {
      return await githubService.resolve(url);
    } catch (err) {
      set.status = 422;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
