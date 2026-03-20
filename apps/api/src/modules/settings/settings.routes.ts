import { Elysia } from 'elysia';
import { settingsService, type SettingSource } from './settings.service';
import { projectsService } from '../projects/projects.service';

const SECRET_KEYS = new Set(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DAYTONA_API_KEY', 'GITHUB_TOKEN']);

function maskValue(key: string, value: string): string {
  if (!value) return '';
  if (!SECRET_KEYS.has(key)) return value;
  if (value.length <= 8) return '••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

interface SettingResponse {
  value: string;
  source: SettingSource;
}

export const settingsRoutes = new Elysia({ prefix: '/api/settings' })
  .get('/visible', () => {
    const env = process.env['SETTINGS_VISIBLE'];
    const visible = env === undefined || env === '' || env === 'true' || env === '1';
    return { visible };
  })
  .get('/', async () => {
    const entries = await settingsService.getAllWithMeta();
    const result: Record<string, SettingResponse> = {};
    for (const [key, entry] of Object.entries(entries)) {
      result[key] = {
        value: maskValue(key, entry.value),
        source: entry.source,
      };
    }
    return result;
  })
  .put('/', async ({ body }) => {
    const raw = body as Record<string, string>;
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value.includes('••••')) continue;
      filtered[key] = value;
    }
    if (Object.keys(filtered).length > 0) {
      await settingsService.setAll(filtered);
      await projectsService.reinitSandboxManager();
    }
    return { ok: true };
  });
