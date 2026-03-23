import { Elysia } from 'elysia';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { projectsService } from '../projects/projects.service';

export const configRoutes = new Elysia({ prefix: '/api/config' })
  .get('/keybindings', async () => {
    try {
      const filePath = join(process.cwd(), 'keybindings.json');
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  })
  .get('/providers', () => {
    return { providers: projectsService.getProviderStatuses() };
  });
