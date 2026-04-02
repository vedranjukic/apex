import { Elysia } from 'elysia';
import { githubService } from './github.service';
import { gitHubMergePollerService } from './github-merge-poller.service';
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
  })
  .get('/pull-request/:owner/:repo/:number/merge-status', async ({ params, set }) => {
    const { owner, repo, number } = params;
    const prNumber = parseInt(number, 10);
    
    if (isNaN(prNumber)) {
      set.status = 400;
      return { error: 'Invalid pull request number' };
    }

    try {
      return await githubService.fetchPullRequestMergeStatus(owner, repo, prNumber);
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  .get('/commit/:owner/:repo/:sha/checks', async ({ params, set }) => {
    const { owner, repo, sha } = params;

    if (!sha || sha.length < 7) {
      set.status = 400;
      return { error: 'Invalid commit SHA' };
    }

    try {
      return await githubService.fetchCommitChecksStatus(owner, repo, sha);
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  .post('/project/merge-status', async ({ body, set }) => {
    try {
      const { repoUrl, issueUrl } = body as { repoUrl?: string; issueUrl?: string };
      const mergeStatus = await githubService.getProjectMergeStatus({ repoUrl, issueUrl });
      return { mergeStatus };
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  .post('/projects/merge-status/batch', async ({ body, set }) => {
    try {
      const { projects } = body as { projects: Array<{ id: string; repoUrl?: string; issueUrl?: string }> };
      
      if (!Array.isArray(projects) || projects.length === 0) {
        set.status = 400;
        return { error: 'Projects array is required and cannot be empty' };
      }

      if (projects.length > 50) {
        set.status = 400;
        return { error: 'Maximum 50 projects allowed per batch request' };
      }

      const results = await githubService.batchCheckMergeStatus(projects);
      return { results };
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  .get('/polling/status', async () => {
    return gitHubMergePollerService.getStatus();
  })
  .post('/polling/trigger', async ({ set }) => {
    try {
      await gitHubMergePollerService.triggerPoll();
      return { message: 'Polling triggered successfully' };
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  .put('/polling/config', async ({ body, set }) => {
    try {
      const config = body as Partial<{
        intervalMinutes: number;
        enabled: boolean;
        maxRetries: number;
        retryDelayMs: number;
      }>;
      
      gitHubMergePollerService.updateConfig(config);
      return { 
        message: 'Configuration updated successfully',
        status: gitHubMergePollerService.getStatus()
      };
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
