import { eq } from 'drizzle-orm';
import { db } from '../../database/db';
import { settings } from '../../database/schema';

export const ALLOWED_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DAYTONA_API_KEY',
  'DAYTONA_API_URL',
  'DAYTONA_SNAPSHOT',
  'SANDBOX_IMAGE',
  'GITHUB_TOKEN',
  'GIT_USER_NAME',
  'GIT_USER_EMAIL',
  'PROXY_CA_CERT',
  'PROXY_CA_KEY',
  'LLM_PROXY_SANDBOX_ID',
  'LLM_PROXY_AUTH_TOKEN',
  'LLM_PROXY_URL',
  'LLM_PROXY_KEYS_HASH',
  'LLM_PROXY_PROJECTS_URL',
  'PROXY_SANDBOX_SNAPSHOT',
  'AGENT_MAX_TOKENS',
  'AGENT_BUILD_MAX_TOKENS',
  'AGENT_BUILD_REASONING_EFFORT',
  'AGENT_PLAN_MAX_TOKENS',
  'AGENT_PLAN_REASONING_EFFORT',
  'AGENT_SISYPHUS_MAX_STEPS',
  'AGENT_SISYPHUS_MAX_TOKENS',
  'AGENT_SISYPHUS_REASONING_EFFORT',
]);

export type SettingSource = 'settings' | 'env' | 'none';

export interface SettingEntry {
  value: string;
  source: SettingSource;
}

class SettingsService {
  private readonly envSnapshot: Record<string, string> = {};

  constructor() {
    for (const key of ALLOWED_KEYS) {
      const v = process.env[key];
      if (v) this.envSnapshot[key] = v;
    }
  }

  async init() {
    await this.applyToEnv();
  }

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

  async getDbValues(): Promise<Record<string, string>> {
    const rows = await db.select().from(settings);
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
    const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
    if (row?.value) return row.value;
    return this.envSnapshot[key] ?? null;
  }

  async setAll(vals: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(vals)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      if (value) {
        await db.insert(settings).values({ key, value }).onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: new Date().toISOString() },
        });
      } else {
        await db.delete(settings).where(eq(settings.key, key));
      }
    }
    await this.applyToEnv();
  }

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
      console.log(`[settings] Applied ${applied} effective setting(s) to process.env`);
    }
  }
}

export const settingsService = new SettingsService();
