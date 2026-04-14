import { Database } from 'bun:sqlite';
import { parseGitHubUrl } from '@apex/shared';

interface Migration {
  id: string;
  name: string;
  execute: () => Promise<void>;
}

/**
 * Migration runner that tracks executed migrations and ensures they only run once.
 * Safe to run multiple times.
 */
class MigrationRunner {
  private sqlite: Database;

  constructor(sqlite: Database) {
    this.sqlite = sqlite;
    this.initializeMigrationTable();
  }

  /**
   * Initialize the migrations table to track executed migrations
   */
  private initializeMigrationTable() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Check if a migration has already been executed
   */
  private isMigrationExecuted(migrationId: string): boolean {
    const result = this.sqlite.query('SELECT id FROM migrations WHERE id = ?').get(migrationId);
    return result !== null;
  }

  /**
   * Mark a migration as executed
   */
  private markMigrationAsExecuted(migrationId: string, name: string) {
    this.sqlite.query('INSERT INTO migrations (id, name, executed_at) VALUES (?, ?, ?)')
      .run(migrationId, name, new Date().toISOString());
  }

  /**
   * Run a single migration if it hasn't been executed yet
   */
  async runMigration(migration: Migration): Promise<void> {
    if (this.isMigrationExecuted(migration.id)) {
      console.log(`[migration] Skipping already executed migration: ${migration.name}`);
      return;
    }

    console.log(`[migration] Running migration: ${migration.name}`);
    try {
      await migration.execute();
      this.markMigrationAsExecuted(migration.id, migration.name);
      console.log(`[migration] Successfully completed: ${migration.name}`);
    } catch (error) {
      console.error(`[migration] Failed to execute migration ${migration.name}:`, error);
      throw error;
    }
  }

  /**
   * Run all migrations in sequence
   */
  async runAllMigrations(): Promise<void> {
    const migrations = this.getMigrations();
    
    for (const migration of migrations) {
      await this.runMigration(migration);
    }

    if (migrations.length > 0) {
      console.log(`[migration] All migrations completed successfully`);
    }
  }

  /**
   * Define all migrations here
   */
  private getMigrations(): Migration[] {
    return [
      {
        id: '001_project_to_repository_secrets',
        name: 'Transform project-scoped secrets to repository-scoped secrets',
        execute: this.migrateProjectSecretsToRepositorySecrets.bind(this)
      }
    ];
  }

  /**
   * Migration 001: Transform project-scoped secrets to repository-scoped secrets
   */
  private async migrateProjectSecretsToRepositorySecrets(): Promise<void> {
    console.log('[migration] Starting project-to-repository secrets migration...');

    // Find all secrets that have projectId but no repositoryId
    // Use a raw query to be explicit about the NULL checks
    const rawSecrets = this.sqlite.query(`
      SELECT s.*, p.git_repo
      FROM secrets s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.project_id IS NOT NULL 
        AND s.repository_id IS NULL
    `).all() as Array<{
      id: string;
      user_id: string;
      project_id: string;
      repository_id: string | null;
      name: string;
      value: string;
      domain: string;
      auth_type: string;
      is_secret: number;
      description: string | null;
      created_at: string;
      updated_at: string;
      git_repo: string | null;
    }>;

    console.log(`[migration] Found ${rawSecrets.length} project-scoped secrets to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const secret of rawSecrets) {
      try {
        if (!secret.git_repo) {
          console.warn(`[migration] Skipping secret ${secret.id}: project has no git_repo`);
          skippedCount++;
          continue;
        }

        // Parse the GitHub URL to extract repository ID
        const parsed = parseGitHubUrl(secret.git_repo);
        if (!parsed) {
          console.warn(`[migration] Skipping secret ${secret.id}: could not parse git URL: ${secret.git_repo}`);
          skippedCount++;
          continue;
        }

        const repositoryId = `${parsed.owner}/${parsed.repo}`;

        // Update the secret to use repository scope instead of project scope
        this.sqlite.query(`
          UPDATE secrets 
          SET repository_id = ?, project_id = NULL, updated_at = ?
          WHERE id = ?
        `).run(repositoryId, new Date().toISOString(), secret.id);

        console.log(`[migration] Migrated secret ${secret.name} from project ${secret.project_id} to repository ${repositoryId}`);
        migratedCount++;

      } catch (error) {
        console.error(`[migration] Error migrating secret ${secret.id}:`, error);
        errorCount++;
      }
    }

    console.log(`[migration] Migration completed: ${migratedCount} migrated, ${skippedCount} skipped, ${errorCount} errors`);

    if (errorCount > 0) {
      throw new Error(`Migration completed with ${errorCount} errors. Check logs for details.`);
    }
  }
}

/**
 * Run all pending migrations
 */
export async function runMigrations(sqlite: Database): Promise<void> {
  const runner = new MigrationRunner(sqlite);
  await runner.runAllMigrations();
}

export { MigrationRunner };