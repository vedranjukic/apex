import { Controller, Get, Put, Body, Inject, forwardRef } from '@nestjs/common';
import { SettingsService, type SettingSource } from './settings.service';
import { ProjectsService } from '../projects/projects.service';

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

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
  ) {}

  @Get('visible')
  getVisible(): { visible: boolean } {
    const env = process.env['SETTINGS_VISIBLE'];
    const visible = env === undefined || env === '' || env === 'true' || env === '1';
    return { visible };
  }

  @Get()
  async getAll(): Promise<Record<string, SettingResponse>> {
    const entries = await this.settingsService.getAllWithMeta();
    const result: Record<string, SettingResponse> = {};
    for (const [key, entry] of Object.entries(entries)) {
      result[key] = {
        value: maskValue(key, entry.value),
        source: entry.source,
      };
    }
    return result;
  }

  @Put()
  async update(@Body() body: Record<string, string>): Promise<{ ok: boolean }> {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value.includes('••••')) continue;
      filtered[key] = value;
    }
    if (Object.keys(filtered).length > 0) {
      await this.settingsService.setAll(filtered);
      await this.projectsService.reinitSandboxManager();
    }
    return { ok: true };
  }
}
