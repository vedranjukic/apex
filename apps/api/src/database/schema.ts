import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

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
  forkedFromId: text('forked_from_id'),
  branchName: text('branch_name'),
  localDir: text('local_dir'),
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
  claudeSessionId: text('claude_session_id'),
  mode: text('mode'),
  agentType: text('agent_type'),
  model: text('model'),
  planData: text('plan_data', { mode: 'json' }).$type<{ id: string; title: string; filename: string; content: string } | null>(),
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
  name: text('name').notNull(),
  value: text('value').notNull(),
  domain: text('domain').notNull(),
  authType: text('auth_type').notNull().default('bearer'),
  description: text('description'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
});

export const secretsRelations = relations(secrets, ({ one }) => ({
  user: one(users, { fields: [secrets.userId], references: [users.id] }),
  project: one(projects, { fields: [secrets.projectId], references: [projects.id] }),
}));

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
});
