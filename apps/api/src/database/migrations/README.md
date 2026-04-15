# Database Migrations

## How the DB Initializes (`db.ts`)

Database startup runs four phases in order:

| Phase | What it does | Handles |
|-------|-------------|---------|
| **1. Create tables** | `CREATE TABLE IF NOT EXISTS` for every table | Fresh databases get the full schema. Existing databases skip (no-op). |
| **2. Auto-sync columns** | Compares drizzle schema → SQLite `PRAGMA table_info` and runs `ALTER TABLE ADD COLUMN` for anything missing | New columns added to the drizzle schema reach existing databases automatically. |
| **3. Create indexes** | `CREATE INDEX IF NOT EXISTS` for every index, each in its own try/catch | Safe because Phase 2 already added any missing columns they reference. |
| **4. Data migrations** | Runs the migration runner (this directory) | One-time data transformations, complex schema changes that auto-sync can't handle. |

## How to Evolve the Schema

### Adding a new column

1. Add the column to the drizzle schema in `schema.ts`.
2. Add the column to the `CREATE TABLE` block in `db.ts` Phase 1 (so fresh databases get it).
3. **Done.** Phase 2 auto-sync handles existing databases.

### Adding a new index

1. Add the index definition to the drizzle schema's third parameter (the index builder).
2. Add a matching `CREATE INDEX IF NOT EXISTS` statement to the `indexStatements` array in `db.ts` Phase 3.

### Adding a new table

1. Define the table + relations in `schema.ts`.
2. Add `CREATE TABLE IF NOT EXISTS` to Phase 1.
3. Add the table to the `drizzleTables` array in Phase 2.
4. Add any indexes to Phase 3.

### Data migrations / complex schema changes

For anything auto-sync can't handle (renaming columns, backfilling data, dropping columns), add a migration to the runner. See [Adding New Migrations](#adding-new-migrations) below.

## Files

- `migration-runner.ts` - Core migration runner with tracking and safety features
- `run-migrations.ts` - Standalone script to run migrations manually
- `migration-runner.test.ts` - Unit tests for the migration system
- `test-migration.ts` - Integration test with real data scenarios

## Usage

### Automatic (Recommended)

Migrations run automatically when the API starts (Phase 4 of `db.ts`).

### Manual

```bash
bun apps/api/src/database/migrations/run-migrations.ts
```

## Adding New Migrations

1. Add a new entry to `getMigrations()` in `migration-runner.ts`:

```typescript
{
  id: '002_your_migration_name',
  name: 'Human readable description',
  execute: this.yourMigrationMethod.bind(this)
}
```

2. Implement the method on the `MigrationRunner` class:

```typescript
private async yourMigrationMethod(): Promise<void> {
  // Use this.sqlite.query() with raw SQL
}
```

## Migration Guidelines

- **Use raw SQL** — avoid ORM queries to prevent circular dependency issues
- **Be idempotent** — safe to run multiple times
- **Handle edge cases** — account for missing, invalid, or unexpected data
- **Backwards compatible** — don't break existing functionality

## Troubleshooting

Failed migrations don't mark themselves as completed, so they retry on next startup. Check console logs for `[migration]` prefixed messages.