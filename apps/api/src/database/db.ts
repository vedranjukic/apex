import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as schema from './schema';

const dbPath = process.env.DB_PATH || 'data/apex.sqlite';
const dbDir = join(dbPath, '..');
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(dbPath, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

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
    forked_from_id TEXT,
    branch_name TEXT,
    local_dir TEXT,
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
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    domain TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'bearer',
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, project_id, name)
  );
`);

// Migrations for columns added after initial schema
try { sqlite.exec(`ALTER TABLE projects ADD COLUMN provider TEXT NOT NULL DEFAULT 'daytona'`); } catch { /* column already exists */ }
try { sqlite.exec(`ALTER TABLE projects ADD COLUMN local_dir TEXT`); } catch { /* column already exists */ }
try { sqlite.exec(`ALTER TABLE projects ADD COLUMN github_context TEXT`); } catch { /* column already exists */ }
try { sqlite.exec(`ALTER TABLE projects ADD COLUMN auto_start_prompt TEXT`); } catch { /* column already exists */ }

export const db = drizzle(sqlite, { schema });
