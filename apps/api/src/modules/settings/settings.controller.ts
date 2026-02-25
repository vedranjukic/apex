import { Controller, Get, Put, Body, Inject, forwardRef } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { ProjectsService } from '../projects/projects.service';

function maskValue(key: string, value: string): string {
  if (!value) return '';
  const isSecret = key.includes('API_KEY');
  if (!isSecret) return value;
  if (value.length <= 8) return '••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
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
  async getAll(): Promise<Record<string, string>> {
    const settings = await this.settingsService.getAll();
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      const isSecret = key.includes('API_KEY');
      result[key] = isSecret ? maskValue(key, value) : value;
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
