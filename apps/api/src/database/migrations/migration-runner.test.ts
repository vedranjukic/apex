import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from './migration-runner';

describe('MigrationRunner', () => {
  let sqlite: Database;
  let migrationRunner: MigrationRunner;

  beforeEach(() => {
    // Create in-memory database for testing
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    
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
        git_repo TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

    migrationRunner = new MigrationRunner(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should create migrations table', () => {
    const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").all();
    expect(tables).toHaveLength(1);
  });

  it('should not run the same migration twice', async () => {
    // Insert a mock migration record
    sqlite.query('INSERT INTO migrations (id, name, executed_at) VALUES (?, ?, ?)')
      .run('001_project_to_repository_secrets', 'Test Migration', new Date().toISOString());

    // Create a spy to check if migration logic runs
    let migrationExecuted = false;
    const mockMigration = {
      id: '001_project_to_repository_secrets',
      name: 'Test Migration',
      execute: async () => {
        migrationExecuted = true;
      }
    };

    await migrationRunner.runMigration(mockMigration);
    expect(migrationExecuted).toBe(false);
  });

  it('should transform project-scoped secrets to repository-scoped secrets', async () => {
    // Setup test data
    const userId = 'user1';
    const projectId = 'project1';
    const secretId = 'secret1';

    // Insert test user
    sqlite.query('INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'test@example.com', 'Test User', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert test project with GitHub URL
    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, userId, 'Test Project', 'https://github.com/owner/repo', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert project-scoped secret
    sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(secretId, userId, projectId, null, 'API_KEY', 'secret-value', 'api.example.com', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Run migrations
    await migrationRunner.runAllMigrations();

    // Verify the secret was transformed
    const updatedSecret = sqlite.query('SELECT * FROM secrets WHERE id = ?').get(secretId) as any;
    expect(updatedSecret).toBeDefined();
    expect(updatedSecret.project_id).toBeNull();
    expect(updatedSecret.repository_id).toBe('owner/repo');
  });

  it('should skip secrets from projects without git_repo', async () => {
    // Setup test data
    const userId = 'user1';
    const projectId = 'project1';
    const secretId = 'secret1';

    // Insert test user
    sqlite.query('INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'test@example.com', 'Test User', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert test project WITHOUT git_repo
    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, userId, 'Test Project', null, '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert project-scoped secret
    sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(secretId, userId, projectId, null, 'API_KEY', 'secret-value', 'api.example.com', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Run migrations
    await migrationRunner.runAllMigrations();

    // Verify the secret was NOT transformed (still project-scoped)
    const secret = sqlite.query('SELECT * FROM secrets WHERE id = ?').get(secretId) as any;
    expect(secret).toBeDefined();
    expect(secret.project_id).toBe(projectId);
    expect(secret.repository_id).toBeNull();
  });

  it('should skip secrets from projects with non-GitHub URLs', async () => {
    // Setup test data
    const userId = 'user1';
    const projectId = 'project1';
    const secretId = 'secret1';

    // Insert test user
    sqlite.query('INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'test@example.com', 'Test User', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert test project with non-GitHub URL
    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, userId, 'Test Project', 'https://gitlab.com/owner/repo', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert project-scoped secret
    sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(secretId, userId, projectId, null, 'API_KEY', 'secret-value', 'api.example.com', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Run migrations
    await migrationRunner.runAllMigrations();

    // Verify the secret was NOT transformed (still project-scoped)
    const secret = sqlite.query('SELECT * FROM secrets WHERE id = ?').get(secretId) as any;
    expect(secret).toBeDefined();
    expect(secret.project_id).toBe(projectId);
    expect(secret.repository_id).toBeNull();
  });

  it('should handle multiple secrets correctly', async () => {
    // Setup test data
    const userId = 'user1';
    const project1Id = 'project1';
    const project2Id = 'project2';
    const secret1Id = 'secret1';
    const secret2Id = 'secret2';
    const secret3Id = 'secret3';

    // Insert test user
    sqlite.query('INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'test@example.com', 'Test User', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert test projects
    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(project1Id, userId, 'Test Project 1', 'https://github.com/owner1/repo1', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');
    
    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(project2Id, userId, 'Test Project 2', 'https://github.com/owner2/repo2', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert project-scoped secrets
    sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(secret1Id, userId, project1Id, null, 'API_KEY', 'secret-value-1', 'api.example.com', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');
    
    sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(secret2Id, userId, project2Id, null, 'API_KEY', 'secret-value-2', 'api.example.com', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert global secret (should be untouched)
    sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(secret3Id, userId, null, null, 'GLOBAL_KEY', 'global-value', 'global.example.com', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Run migrations
    await migrationRunner.runAllMigrations();

    // Verify secrets were transformed correctly
    const secret1 = sqlite.query('SELECT * FROM secrets WHERE id = ?').get(secret1Id) as any;
    expect(secret1.project_id).toBeNull();
    expect(secret1.repository_id).toBe('owner1/repo1');

    const secret2 = sqlite.query('SELECT * FROM secrets WHERE id = ?').get(secret2Id) as any;
    expect(secret2.project_id).toBeNull();
    expect(secret2.repository_id).toBe('owner2/repo2');

    // Global secret should be untouched
    const secret3 = sqlite.query('SELECT * FROM secrets WHERE id = ?').get(secret3Id) as any;
    expect(secret3.project_id).toBeNull();
    expect(secret3.repository_id).toBeNull();
  });

  it('should be safe to run multiple times', async () => {
    // Setup test data
    const userId = 'user1';
    const projectId = 'project1';
    const secretId = 'secret1';

    // Insert test user
    sqlite.query('INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'test@example.com', 'Test User', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert test project
    sqlite.query('INSERT INTO projects (id, user_id, name, git_repo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, userId, 'Test Project', 'https://github.com/owner/repo', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Insert project-scoped secret
    sqlite.query('INSERT INTO secrets (id, user_id, project_id, repository_id, name, value, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(secretId, userId, projectId, null, 'API_KEY', 'secret-value', 'api.example.com', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z');

    // Run migrations twice
    await migrationRunner.runAllMigrations();
    await migrationRunner.runAllMigrations();

    // Verify the secret was transformed only once
    const secret = sqlite.query('SELECT * FROM secrets WHERE id = ?').get(secretId) as any;
    expect(secret.project_id).toBeNull();
    expect(secret.repository_id).toBe('owner/repo');

    // Check that migration was recorded only once
    const migrationRecords = sqlite.query('SELECT * FROM migrations WHERE id = ?').all('001_project_to_repository_secrets');
    expect(migrationRecords).toHaveLength(1);
  });
});