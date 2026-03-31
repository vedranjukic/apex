import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { homedir, platform } from 'os';
import { config } from 'dotenv';
import type { CliConfig } from '../types/index.js';

export class ConfigManager {
  private static instance: ConfigManager;
  private _config: CliConfig;

  private constructor() {
    this._config = this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public get config(): CliConfig {
    return this._config;
  }

  public updateConfig(updates: Partial<CliConfig>): void {
    this._config = { ...this._config, ...updates };
  }

  private loadConfig(): CliConfig {
    // Load .env from workspace root if in development
    this.loadDotEnv();

    const dbPath = this.resolveDBPath();
    
    return {
      dbPath,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      daytonaApiKey: process.env.DAYTONA_API_KEY,
      daytonaApiUrl: process.env.DAYTONA_API_URL || 'https://api.daytona.io',
      openaiApiKey: process.env.OPENAI_API_KEY,
      defaultProvider: (process.env.APEX_DEFAULT_PROVIDER as any) || 'daytona',
      defaultAgentType: (process.env.APEX_DEFAULT_AGENT_TYPE as any) || 'build',
    };
  }

  private loadDotEnv(): void {
    // Try to find workspace root by looking for nx.json
    let currentDir = process.cwd();
    let workspaceRoot = null;

    while (currentDir !== '/') {
      if (existsSync(join(currentDir, 'nx.json'))) {
        workspaceRoot = currentDir;
        break;
      }
      currentDir = resolve(currentDir, '..');
    }

    if (workspaceRoot) {
      const envPath = join(workspaceRoot, '.env');
      if (existsSync(envPath)) {
        config({ path: envPath });
      }
    }
  }

  private resolveDBPath(): string {
    // Priority: CLI flag → env var → dev workspace → user data dir
    
    // Check env var
    if (process.env.APEX_DB_PATH) {
      return process.env.APEX_DB_PATH;
    }

    // Check if we're in development (workspace has nx.json)
    let currentDir = process.cwd();
    while (currentDir !== '/') {
      if (existsSync(join(currentDir, 'nx.json'))) {
        return join(currentDir, 'apex.db');
      }
      currentDir = resolve(currentDir, '..');
    }

    // Fall back to user data directory (Electron-compatible paths)
    return join(this.getUserDataDir(), 'apex.db');
  }

  private getUserDataDir(): string {
    const home = homedir();
    
    switch (platform()) {
      case 'win32':
        return process.env.APPDATA || join(home, 'AppData', 'Roaming', 'Apex');
      case 'darwin':
        return join(home, 'Library', 'Application Support', 'Apex');
      case 'linux':
      default:
        return process.env.XDG_DATA_HOME || join(home, '.local', 'share', 'apex');
    }
  }

  public setDbPath(path: string): void {
    this._config.dbPath = path;
  }
}

export const configManager = ConfigManager.getInstance();