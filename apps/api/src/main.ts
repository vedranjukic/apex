import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import { join } from 'path';
import { existsSync } from 'fs';

import { usersRoutes } from './modules/users/users.routes';
import { projectsRoutes } from './modules/projects/projects.routes';
import { threadsRoutes } from './modules/tasks/tasks.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { configRoutes } from './modules/config/config.routes';
import { agentWs } from './modules/agent/agent.ws';
import { projectsWs } from './modules/projects/projects.ws';
import { previewRoutes } from './modules/preview/preview.routes';

import { usersService } from './modules/users/users.service';
import { settingsService } from './modules/settings/settings.service';
import { threadsService } from './modules/tasks/tasks.service';
import { projectsService } from './modules/projects/projects.service';

async function bootstrap() {
  await settingsService.init();
  await usersService.init();
  await threadsService.init();
  await projectsService.init();

  const dashboardDir = process.env.DASHBOARD_DIR || join(__dirname, '../../dashboard/dist');

  const app = new Elysia()
    .use(cors({ origin: true, credentials: true }))
    .use(usersRoutes)
    .use(projectsRoutes)
    .use(threadsRoutes)
    .use(settingsRoutes)
    .use(configRoutes)
    .use(previewRoutes)
    .use(agentWs)
    .use(projectsWs);

  if (existsSync(dashboardDir)) {
    app.use(staticPlugin({
      assets: dashboardDir,
      prefix: '/',
      noCache: true,
      alwaysStatic: false,
    }));
  }

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';

  app.listen({ port: Number(port), hostname: host });

  console.log(`🚀 API running on http://${host}:${port}/api`);
}

bootstrap();
