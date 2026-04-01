import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';

import { usersRoutes } from './modules/users/users.routes';
import { projectsRoutes } from './modules/projects/projects.routes';
import { threadsRoutes } from './modules/tasks/tasks.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { configRoutes } from './modules/config/config.routes';
import { agentWs, autoExecuteThread } from './modules/agent/agent.ws';
import { projectsWs } from './modules/projects/projects.ws';
import { previewRoutes } from './modules/preview/preview.routes';
import { llmProxyRoutes } from './modules/llm-proxy/llm-proxy.routes';
import { secretsRoutes } from './modules/secrets/secrets.routes';
import { fsRoutes } from './modules/fs/fs.routes';
import { githubRoutes } from './modules/github/github.routes';

import { usersService } from './modules/users/users.service';
import { settingsService } from './modules/settings/settings.service';
import { threadsService } from './modules/tasks/tasks.service';
import { projectsService } from './modules/projects/projects.service';
import { initCA } from './modules/secrets-proxy/ca-manager';
import { startSecretsProxy, stopSecretsProxy } from './modules/secrets-proxy/secrets-proxy';

function setupGracefulShutdown() {
  const shutdown = () => {
    stopSecretsProxy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Exit when parent dies — the desktop app spawns us with stdin: 'pipe',
  // so EOF on stdin means the parent process is gone.
  process.stdin.resume();
  process.stdin.on('end', shutdown);
  process.stdin.on('error', shutdown);
}

async function bootstrap() {
  await settingsService.init();
  await usersService.init();
  await threadsService.init();
  await initCA();
  try {
    await startSecretsProxy();
  } catch (err) {
    console.warn(`[secrets-proxy] Could not start proxy: ${(err as Error).message}. API will continue without secrets proxy.`);
  }
  await projectsService.init();
  projectsService.registerAutoStartHandler(autoExecuteThread);

  const dashboardDir = process.env.DASHBOARD_DIR || join(__dirname, '../../dashboard/dist');

  const app = new Elysia()
    .use(cors({ origin: true, credentials: true }))
    .use(usersRoutes)
    .use(projectsRoutes)
    .use(threadsRoutes)
    .use(settingsRoutes)
    .use(configRoutes)
    .use(previewRoutes)
    .use(llmProxyRoutes)
    .use(secretsRoutes)
    .use(fsRoutes)
    .use(githubRoutes)
    .use(agentWs)
    .use(projectsWs);

  if (existsSync(dashboardDir)) {
    const indexHtml = readFileSync(join(dashboardDir, 'index.html'), 'utf-8');

    app.get('/assets/*', ({ params }) => {
      const filePath = join(dashboardDir, 'assets', (params as any)['*']);
      if (existsSync(filePath)) return Bun.file(filePath);
      return new Response('Not found', { status: 404 });
    });

    app.get('/favicon.ico', () => {
      const p = join(dashboardDir, 'favicon.ico');
      if (existsSync(p)) return Bun.file(p);
      return new Response('', { status: 404 });
    });

    // SPA fallback — serve index.html as raw text to avoid Bun's HTML bundler
    app.get('/*', () => {
      return new Response(indexHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });
  }

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';

  app.listen({ port: Number(port), hostname: host });

  console.log(`🚀 API running on http://${host}:${port}/api`);

  setupGracefulShutdown();
}

bootstrap();
 
