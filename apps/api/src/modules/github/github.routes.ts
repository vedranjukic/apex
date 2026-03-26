import { Elysia } from 'elysia';
import { githubService } from './github.service';
import { settingsService } from '../settings/settings.service';

export const githubRoutes = new Elysia({ prefix: '/api/github' })
  .get('/user', async ({ set }) => {
    try {
      const ghUser = await githubService.fetchUser();
      const nameOverride = await settingsService.get('GIT_USER_NAME');
      const emailOverride = await settingsService.get('GIT_USER_EMAIL');

      if (!ghUser && !nameOverride && !emailOverride) {
        set.status = 204;
        return;
      }

      return {
        name: nameOverride || ghUser?.name || '',
        email: emailOverride || ghUser?.email || '',
        login: ghUser?.login || '',
        avatarUrl: ghUser?.avatarUrl || '',
      };
    } catch (err) {
      set.status = 204;
      return;
    }
  })
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
