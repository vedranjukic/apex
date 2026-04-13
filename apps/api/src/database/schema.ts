import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  oauthProvider: text('oauth_provider'),
  oauthProviderId: text('oauth_provider_id'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sandboxId: text('sandbox_id'),
  sandboxSnapshot: text('sandbox_snapshot').notNull().default(''),
  provider: text('provider').notNull().default('daytona'),
  status: text('status').notNull().default('creating'),
  statusError: text('status_error'),
  agentType: text('agent_type').notNull().default('build'),
  gitRepo: text('git_repo'),
  agentConfig: text('agent_config', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  githubContext: text('github_context', { mode: 'json' }).$type<{
    type: 'issue' | 'pull';
    number: number;
    title: string;
    body: string;
    url: string;
    branch?: string;
    labels?: string[];
  } | null>(),
  mergeStatus: text('merge_status', { mode: 'json' }).$type<{
    mergeable: boolean | null;
    mergeable_state: string;
    checks_status: 'pending' | 'success' | 'failure' | 'neutral';
    merge_behind_by: number;
    last_checked: string;
    pr_state: 'open' | 'closed' | 'merged';
  } | null>(),
  forkedFromId: text('forked_from_id'),
  branchName: text('branch_name'),
  localDir: text('local_dir'),
  autoStartPrompt: text('auto_start_prompt'),
  sandboxConfig: text('sandbox_config', { mode: 'json' }).$type<{
    customImage?: string;
    environmentVariables?: Record<string, string>;
    memoryMB?: number;
    cpus?: number;
    diskGB?: number;
  } | null>(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
  deletedAt: text('deleted_at'),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  threads: many(tasks),
}));

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('completed'),
  agentSessionId: text('claude_session_id'),
  mode: text('mode'),
  agentType: text('agent_type'),
  model: text('model'),
  planData: text('plan_data', { mode: 'json' }).$type<{ id: string; title: string; filename: string; content: string } | null>(),
  lastPersistedSeq: integer('last_persisted_seq'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
});

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  messages: many(messages),
}));

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>[]>(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  task: one(tasks, { fields: [messages.taskId], references: [tasks.id] }),
}));

export const secrets = sqliteTable('secrets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  repositoryId: text('repository_id'), // GitHub repository in "owner/repo" format
  name: text('name').notNull(),
  value: text('value').notNull(),
  domain: text('domain').notNull(),
  authType: text('auth_type').notNull().default('bearer'),
  isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(true), // true for secrets, false for env vars
  description: text('description'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, (table) => ({
  // Index for efficient lookup by user and repository
  userRepositoryIdx: index('secrets_user_repository_idx').on(table.userId, table.repositoryId),
  // Index for efficient lookup by user and project (backward compatibility)
  userProjectIdx: index('secrets_user_project_idx').on(table.userId, table.projectId),
  // Index for efficient lookup by repository
  repositoryIdx: index('secrets_repository_idx').on(table.repositoryId),
  // Index for efficient filtering by secret type
  isSecretIdx: index('secrets_is_secret_idx').on(table.isSecret),
  // Unique constraints for different scopes
  uniqueGlobal: uniqueIndex('secrets_unique_global').on(table.userId, table.name).where(sql`project_id IS NULL AND repository_id IS NULL`),
  uniqueProject: uniqueIndex('secrets_unique_project').on(table.userId, table.projectId, table.name).where(sql`project_id IS NOT NULL AND repository_id IS NULL`),
  uniqueRepository: uniqueIndex('secrets_unique_repository').on(table.userId, table.repositoryId, table.name).where(sql`repository_id IS NOT NULL`),
}));

export const secretsRelations = relations(secrets, ({ one }) => ({
  user: one(users, { fields: [secrets.userId], references: [users.id] }),
  project: one(projects, { fields: [secrets.projectId], references: [projects.id] }),
}));

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
});
