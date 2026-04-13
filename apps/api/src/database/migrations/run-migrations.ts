#!/usr/bin/env bun

/**
 * Standalone migration runner script
 * 
 * Usage:
 *   bun run apps/api/src/database/migrations/run-migrations.ts
 * 
 * This script can be run independently to execute migrations
 * without starting the full API server.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runMigrations } from './migration-runner';

async function main() {
  console.log('[migration-runner] Starting standalone migration runner...');

  // Initialize database connection (same as in db.ts)
  const dbPath = process.env.DB_PATH || 'data/apex.sqlite';
  const dbDir = join(dbPath, '..');
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  try {
    await runMigrations(sqlite);
    console.log('[migration-runner] All migrations completed successfully');
  } catch (error) {
    console.error('[migration-runner] Migration failed:', error);
    process.exit(1);
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error('[migration-runner] Unexpected error:', error);
  process.exit(1);
});