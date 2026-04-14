#!/usr/bin/env bun

/**
 * Integration test for the migration
 * Creates test data, runs the migration, and verifies the results
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { runMigrations } from './migration-runner';

async function testMigration() {
  console.log('[test-migration] Starting migration integration test...');

  // Create a temporary test database
  const testDbPath = 'test-migration.db';
  if (existsSync(testDbPath)) {
    unlinkSync(testDbPath);
  }

  const sqlite = new Database(testDbPath, { create: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  try {
    // Initialize schema
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE TABLE projects (
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
      
      CREATE TABLE secrets (
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

    // Insert test data
    const now = new Date().toISOString();
    const userId = 'test-user-1';
    const projectId1 = 'test-project-1';
    const projectId2 = 'test-project-2';
    const projectId3 = 'test-project-3';

    // Insert user
    sqlite.query('INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'test@example.com', 'Test User', now, now);

    // Insert projects with different scenarios
    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId1, userId, 'GitHub Project', 'https://github.com/owner1/repo1', now, now);

    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId2, userId, 'Non-GitHub Project', 'https://gitlab.com/owner2/repo2', now, now);

    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId3, userId, 'No Git Project', null, now, now);

    // Insert secrets with different scopes
    const secrets = [
      { id: 'secret-1', projectId: projectId1, repositoryId: null, name: 'GITHUB_API_KEY', description: 'Should be migrated to owner1/repo1' },
      { id: 'secret-2', projectId: projectId2, repositoryId: null, name: 'GITLAB_API_KEY', description: 'Should remain project-scoped (non-GitHub)' },
      { id: 'secret-3', projectId: projectId3, repositoryId: null, name: 'LOCAL_API_KEY', description: 'Should remain project-scoped (no git repo)' },
      { id: 'secret-4', projectId: null, repositoryId: null, name: 'GLOBAL_API_KEY', description: 'Should remain global' },
      { id: 'secret-5', projectId: null, repositoryId: 'owner/existing-repo', name: 'EXISTING_REPO_KEY', description: 'Should remain repository-scoped' }
    ];

    for (const secret of secrets) {
      sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(secret.id, userId, secret.projectId, secret.repositoryId, secret.name, 'secret-value', 'api.example.com', now, now);
    }

    console.log('[test-migration] Test data created successfully');

    // Verify initial state
    const beforeMigration = sqlite.query('SELECT id, project_id, repository_id, name FROM secrets ORDER BY id').all();
    console.log('[test-migration] Secrets before migration:');
    beforeMigration.forEach((secret: any) => {
      console.log(`  ${secret.id}: project=${secret.project_id || 'null'}, repository=${secret.repository_id || 'null'}, name=${secret.name}`);
    });

    // Run migration
    console.log('[test-migration] Running migrations...');
    await runMigrations(sqlite);

    // Verify migration results
    const afterMigration = sqlite.query('SELECT id, project_id, repository_id, name FROM secrets ORDER BY id').all();
    console.log('[test-migration] Secrets after migration:');
    afterMigration.forEach((secret: any) => {
      console.log(`  ${secret.id}: project=${secret.project_id || 'null'}, repository=${secret.repository_id || 'null'}, name=${secret.name}`);
    });

    // Assertions
    const secretsMap = new Map(afterMigration.map((s: any) => [s.id, s]));

    // secret-1 should be migrated to repository scope
    const secret1 = secretsMap.get('secret-1');
    if (secret1?.repository_id !== 'owner1/repo1' || secret1?.project_id !== null) {
      throw new Error(`secret-1 migration failed: expected repository_id=owner1/repo1 and project_id=null, got repository_id=${secret1?.repository_id} and project_id=${secret1?.project_id}`);
    }

    // secret-2 should remain project-scoped (non-GitHub)
    const secret2 = secretsMap.get('secret-2');
    if (secret2?.project_id !== projectId2 || secret2?.repository_id !== null) {
      throw new Error(`secret-2 should remain project-scoped: expected project_id=${projectId2} and repository_id=null, got project_id=${secret2?.project_id} and repository_id=${secret2?.repository_id}`);
    }

    // secret-3 should remain project-scoped (no git repo)
    const secret3 = secretsMap.get('secret-3');
    if (secret3?.project_id !== projectId3 || secret3?.repository_id !== null) {
      throw new Error(`secret-3 should remain project-scoped: expected project_id=${projectId3} and repository_id=null, got project_id=${secret3?.project_id} and repository_id=${secret3?.repository_id}`);
    }

    // secret-4 should remain global
    const secret4 = secretsMap.get('secret-4');
    if (secret4?.project_id !== null || secret4?.repository_id !== null) {
      throw new Error(`secret-4 should remain global: expected project_id=null and repository_id=null, got project_id=${secret4?.project_id} and repository_id=${secret4?.repository_id}`);
    }

    // secret-5 should remain repository-scoped
    const secret5 = secretsMap.get('secret-5');
    if (secret5?.project_id !== null || secret5?.repository_id !== 'owner/existing-repo') {
      throw new Error(`secret-5 should remain repository-scoped: expected project_id=null and repository_id=owner/existing-repo, got project_id=${secret5?.project_id} and repository_id=${secret5?.repository_id}`);
    }

    // Verify migration tracking
    const migrationRecords = sqlite.query('SELECT * FROM migrations').all();
    if (migrationRecords.length !== 1) {
      throw new Error(`Expected 1 migration record, got ${migrationRecords.length}`);
    }

    // Run migration again to test idempotency
    console.log('[test-migration] Testing idempotency by running migration again...');
    await runMigrations(sqlite);

    const afterSecondRun = sqlite.query('SELECT id, project_id, repository_id, name FROM secrets ORDER BY id').all();
    if (JSON.stringify(afterMigration) !== JSON.stringify(afterSecondRun)) {
      throw new Error('Migration is not idempotent - results changed on second run');
    }

    const migrationRecordsAfterSecond = sqlite.query('SELECT * FROM migrations').all();
    if (migrationRecordsAfterSecond.length !== 1) {
      throw new Error(`Migration should still have only 1 record after second run, got ${migrationRecordsAfterSecond.length}`);
    }

    console.log('[test-migration] ✅ All tests passed! Migration works correctly.');

  } catch (error) {
    console.error('[test-migration] ❌ Test failed:', error);
    throw error;
  } finally {
    sqlite.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  }
}

// Run the test
testMigration().catch((error) => {
  console.error('[test-migration] Unexpected error:', error);
  process.exit(1);
});