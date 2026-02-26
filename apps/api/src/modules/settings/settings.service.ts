import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingEntity } from './setting.entity';

const ALLOWED_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'DAYTONA_API_KEY',
  'DAYTONA_API_URL',
  'DAYTONA_SNAPSHOT',
]);

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(SettingEntity)
    private readonly repo: Repository<SettingEntity>,
  ) {}

  async onModuleInit() {
    await this.applyToEnv();
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.repo.find();
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (ALLOWED_KEYS.has(row.key)) {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    if (!ALLOWED_KEYS.has(key)) return null;
    const row = await this.repo.findOneBy({ key });
    return row?.value ?? null;
  }

  async setAll(settings: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      await this.repo.upsert({ key, value }, ['key']);
    }
    await this.applyToEnv();
  }

  async applyToEnv(): Promise<void> {
    const rows = await this.repo.find();
    let applied = 0;
    for (const row of rows) {
      if (ALLOWED_KEYS.has(row.key) && row.value) {
        process.env[row.key] = row.value;
        applied++;
      }
    }
    if (applied > 0) {
      this.logger.log(`Applied ${applied} setting(s) to process.env`);
    }
  }
}
