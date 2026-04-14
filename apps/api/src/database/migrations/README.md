# Database Migrations

This directory contains the database migration system for transforming project-scoped secrets to repository-scoped secrets and other future migrations.

## Overview

The migration system provides a safe, trackable, and idempotent way to modify the database schema and data. Each migration runs exactly once and is tracked in the `migrations` table.

## Files

- `migration-runner.ts` - Core migration runner with tracking and safety features
- `run-migrations.ts` - Standalone script to run migrations manually
- `migration-runner.test.ts` - Unit tests for the migration system
- `test-migration.ts` - Integration test with real data scenarios
- `debug-migration.ts` - Debug script for troubleshooting migrations

## Usage

### Automatic Migration (Recommended)

Migrations run automatically when the API starts up. The migration system is integrated into the database initialization in `db.ts`.

### Manual Migration

You can run migrations manually using the npm script:

```bash
npm run migrate
```

Or directly with bun:

```bash
bun apps/api/src/database/migrations/run-migrations.ts
```

### Testing

Run the migration tests:

```bash
bun test apps/api/src/database/migrations/migration-runner.test.ts
```

Run the integration test:

```bash
bun apps/api/src/database/migrations/test-migration.ts
```

## Migration 001: Project to Repository Secrets

The first migration transforms existing project-scoped secrets to repository-scoped secrets by:

1. Finding all secrets with `projectId` but no `repositoryId`
2. Looking up each project's `gitRepo` field
3. Parsing GitHub URLs using the `parseGitHubUrl` utility
4. Converting the repository URL to `owner/repo` format
5. Updating the secret to set `repositoryId` and clear `projectId`

### Edge Cases Handled

- **Non-GitHub URLs**: Secrets from GitLab, Bitbucket, or other providers are skipped and remain project-scoped
- **Missing git_repo**: Projects without a git repository are skipped
- **Invalid URLs**: Unparseable URLs are logged and skipped
- **Already repository-scoped**: Secrets that already have a `repositoryId` are untouched
- **Global secrets**: Secrets with neither `projectId` nor `repositoryId` remain global

### Safety Features

- **Idempotent**: Safe to run multiple times
- **Tracked**: Each migration runs exactly once using the `migrations` table
- **Transactional**: Uses SQLite's ACID properties for consistency
- **Logged**: Detailed logging of all operations and edge cases
- **Non-destructive**: Only updates secrets that can be safely migrated

### Example Transformation

Before migration:
```sql
-- Project-scoped secret
INSERT INTO secrets (user_id, project_id, repository_id, name, value, domain) 
VALUES ('user1', 'project1', NULL, 'API_KEY', 'secret', 'api.example.com');
```

After migration:
```sql
-- Repository-scoped secret (assuming project1 has git_repo = 'https://github.com/owner/repo')
UPDATE secrets 
SET project_id = NULL, repository_id = 'owner/repo' 
WHERE id = 'secret_id';
```

## Adding New Migrations

To add a new migration:

1. Add a new migration object to the `getMigrations()` method in `migration-runner.ts`:

```typescript
{
  id: '002_your_migration_name',
  name: 'Human readable description',
  execute: this.yourMigrationMethod.bind(this)
}
```

2. Implement the migration method:

```typescript
private async yourMigrationMethod(): Promise<void> {
  console.log('[migration] Starting your migration...');
  
  // Your migration logic here using this.sqlite.query()
  // Use raw SQL for maximum compatibility and reliability
  
  console.log('[migration] Your migration completed');
}
```

3. Add comprehensive tests to verify the migration works correctly

## Migration Guidelines

- **Use raw SQL**: Avoid ORM queries to prevent dependency issues
- **Be idempotent**: Ensure migrations can run multiple times safely  
- **Handle edge cases**: Account for missing, invalid, or unexpected data
- **Log thoroughly**: Provide detailed logging for debugging
- **Test extensively**: Include unit tests, integration tests, and edge cases
- **Document changes**: Update this README with migration details
- **Backwards compatible**: Don't break existing functionality

## Troubleshooting

If a migration fails:

1. Check the console logs for detailed error information
2. Verify the database state manually
3. Use the debug script to isolate issues:
   ```bash
   bun apps/api/src/database/migrations/debug-migration.ts
   ```
4. Test with the integration test:
   ```bash
   bun apps/api/src/database/migrations/test-migration.ts
   ```

The migration system is designed to be safe and recovery-friendly. Failed migrations don't mark themselves as completed, so they will retry on the next run.