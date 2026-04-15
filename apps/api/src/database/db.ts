import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { SQL } from 'drizzle-orm';
import * as schema from './schema';

const dbPath = process.env.DB_PATH || 'data/apex.sqlite';
const dbDir = join(dbPath, '..');
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(dbPath, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

// ── Phase 1: Create tables (no indexes) ─────────────────────────────
// CREATE TABLE IF NOT EXISTS is a no-op when the table already exists,
// so new columns added here won't reach existing databases. Phase 2
// handles that via auto-sync from the drizzle schema.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    oauth_provider TEXT,
    oauth_provider_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sandbox_id TEXT,
    sandbox_snapshot TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT 'daytona',
    status TEXT NOT NULL DEFAULT 'creating',
    status_error TEXT,
    agent_type TEXT NOT NULL DEFAULT 'build',
    git_repo TEXT,
    agent_config TEXT,
    github_context TEXT,
    merge_status TEXT,
    forked_from_id TEXT,
    branch_name TEXT,
    local_dir TEXT,
    auto_start_prompt TEXT,
    sandbox_config TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    claude_session_id TEXT,
    mode TEXT,
    agent_type TEXT,
    model TEXT,
    plan_data TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    repository_id TEXT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    domain TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'bearer',
    is_secret INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// ── Phase 2: Auto-sync columns from drizzle schema ──────────────────
// Compares drizzle schema definitions against actual SQLite columns and
// adds any missing ones. This is what makes existing databases pick up
// new columns (e.g. repository_id on secrets) without manual ALTERs.
const drizzleTables = [
  schema.users, schema.projects, schema.tasks,
  schema.messages, schema.settings, schema.secrets,
];

for (const table of drizzleTables) {
  const config = getTableConfig(table);
  const existing = new Set(
    (sqlite.query(`PRAGMA table_info("${config.name}")`).all() as { name: string }[])
      .map(r => r.name),
  );

  for (const col of config.columns) {
    if (existing.has(col.name)) continue;

    const sqlType = col.getSQLType();
    let ddl = `ALTER TABLE "${config.name}" ADD COLUMN "${col.name}" ${sqlType}`;

    if (col.notNull && col.default !== undefined) {
      const val = col.default instanceof SQL ? null : col.default;
      if (val !== null && val !== undefined) {
        ddl += ` NOT NULL DEFAULT ${typeof val === 'string' ? `'${val}'` : val}`;
      } else {
        ddl += ` NOT NULL DEFAULT ''`;
      }
    } else if (col.notNull) {
      ddl += ` NOT NULL DEFAULT ''`;
    }

    try {
      sqlite.exec(ddl);
      console.log(`[db] Added column "${config.name}"."${col.name}"`);
    } catch (e) {
      console.warn(`[db] Failed to add column "${config.name}"."${col.name}":`, (e as Error).message);
    }
  }
}

// ── Phase 3: Create indexes ─────────────────────────────────────────
// Runs AFTER column auto-sync so that indexes referencing new columns
// (e.g. repository_id) are safe. Each statement is independent so one
// failure doesn't block the rest.
const indexStatements = [
  `CREATE UNIQUE INDEX IF NOT EXISTS secrets_unique_global ON secrets(user_id, name) WHERE project_id IS NULL AND repository_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS secrets_unique_project ON secrets(user_id, project_id, name) WHERE project_id IS NOT NULL AND repository_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS secrets_unique_repository ON secrets(user_id, repository_id, name) WHERE repository_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS secrets_user_repository_idx ON secrets(user_id, repository_id)`,
  `CREATE INDEX IF NOT EXISTS secrets_user_project_idx ON secrets(user_id, project_id)`,
  `CREATE INDEX IF NOT EXISTS secrets_repository_idx ON secrets(repository_id)`,
  `CREATE INDEX IF NOT EXISTS secrets_is_secret_idx ON secrets(is_secret)`,
];

for (const stmt of indexStatements) {
  try {
    sqlite.exec(stmt);
  } catch (e) {
    console.warn(`[db] Failed to create index:`, (e as Error).message);
  }
}

export const db = drizzle(sqlite, { schema });

// ── Phase 4: Data migrations ────────────────────────────────────────
async function initMigrations() {
  try {
    const { runMigrations } = await import('./migrations/migration-runner');
    await runMigrations(sqlite);
  } catch (error) {
    console.error('[db] Migration failed:', error);
  }
}

initMigrations();
