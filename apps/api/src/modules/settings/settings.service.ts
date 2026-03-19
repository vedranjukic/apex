import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingEntity } from './setting.entity';

export const ALLOWED_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DAYTONA_API_KEY',
  'DAYTONA_API_URL',
  'DAYTONA_SNAPSHOT',
  'GITHUB_TOKEN',
]);

export type SettingSource = 'settings' | 'env' | 'none';

export interface SettingEntry {
  value: string;
  source: SettingSource;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly envSnapshot: Record<string, string> = {};

  constructor(
    @InjectRepository(SettingEntity)
    private readonly repo: Repository<SettingEntity>,
  ) {
    for (const key of ALLOWED_KEYS) {
      const v = process.env[key];
      if (v) this.envSnapshot[key] = v;
    }
  }

  async onModuleInit() {
    await this.applyToEnv();
  }

  /** Return effective value + source for every allowed key. */
  async getAllWithMeta(): Promise<Record<string, SettingEntry>> {
    const dbValues = await this.getDbValues();
    const result: Record<string, SettingEntry> = {};
    for (const key of ALLOWED_KEYS) {
      const dbVal = dbValues[key];
      if (dbVal) {
        result[key] = { value: dbVal, source: 'settings' };
      } else if (this.envSnapshot[key]) {
        result[key] = { value: this.envSnapshot[key], source: 'env' };
      } else {
        result[key] = { value: '', source: 'none' };
      }
    }
    return result;
  }

  /** Return only DB-stored values. */
  async getDbValues(): Promise<Record<string, string>> {
    const rows = await this.repo.find();
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (ALLOWED_KEYS.has(row.key) && row.value) {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    if (!ALLOWED_KEYS.has(key)) return null;
    const row = await this.repo.findOneBy({ key });
    if (row?.value) return row.value;
    return this.envSnapshot[key] ?? null;
  }

  /** Save settings. Empty values delete the DB row so the env var fallback is restored. */
  async setAll(settings: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      if (value) {
        await this.repo.upsert({ key, value }, ['key']);
      } else {
        await this.repo.delete({ key });
      }
    }
    await this.applyToEnv();
  }

  /** Apply effective values (DB overrides env) to process.env. */
  async applyToEnv(): Promise<void> {
    const dbValues = await this.getDbValues();
    let applied = 0;
    for (const key of ALLOWED_KEYS) {
      const effective = dbValues[key] || this.envSnapshot[key];
      if (effective) {
        process.env[key] = effective;
        applied++;
      } else {
        delete process.env[key];
      }
    }
    if (applied > 0) {
      this.logger.log(`Applied ${applied} effective setting(s) to process.env`);
    }
  }
}
