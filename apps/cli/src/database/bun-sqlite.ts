import { Database } from 'bun:sqlite';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Project, Thread, Message, User } from '../types/index.js';

export class DatabaseManager {
  private db: Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Create tables compatible with existing TypeORM schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        sandbox_id TEXT,
        provider TEXT NOT NULL DEFAULT 'daytona',
        status TEXT NOT NULL DEFAULT 'creating',
        agent_type TEXT NOT NULL DEFAULT 'build',
        git_repo TEXT,
        agent_config TEXT NOT NULL DEFAULT '{}',
        local_dir TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '[]',
        token_count INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
      CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
    `);

    // Create default user if none exists
    this.ensureDefaultUser();
  }

  private ensureDefaultUser(): void {
    const existingUser = this.db.query('SELECT id FROM users LIMIT 1').get();
    if (!existingUser) {
      const userId = 'default-user';
      this.db.query(`
        INSERT INTO users (id, email, created_at, updated_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(userId, null);
    }
  }

  // User operations
  public getDefaultUser(): User {
    const row = this.db.query('SELECT * FROM users LIMIT 1').get() as any;
    return {
      id: row.id,
      email: row.email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Project operations
  public createProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project {
    const now = new Date().toISOString();
    const stmt = this.db.query(`
      INSERT INTO projects (id, user_id, name, description, sandbox_id, provider, status, agent_type, git_repo, agent_config, local_dir, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      project.id,
      project.userId,
      project.name,
      project.description || null,
      project.sandboxId || null,
      project.provider,
      project.status,
      project.agentType,
      project.gitRepo || null,
      JSON.stringify(project.agentConfig),
      project.localDir || null,
      now,
      now
    );

    return { ...project, createdAt: now, updatedAt: now };
  }

  public getProject(id: string): Project | null {
    const row = this.db.query('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      sandboxId: row.sandbox_id,
      provider: row.provider,
      status: row.status,
      agentType: row.agent_type,
      gitRepo: row.git_repo,
      agentConfig: JSON.parse(row.agent_config || '{}'),
      localDir: row.local_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public getProjectByName(name: string): Project | null {
    const row = this.db.query('SELECT * FROM projects WHERE name = ? COLLATE NOCASE').get(name) as any;
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      sandboxId: row.sandbox_id,
      provider: row.provider,
      status: row.status,
      agentType: row.agent_type,
      gitRepo: row.git_repo,
      agentConfig: JSON.parse(row.agent_config || '{}'),
      localDir: row.local_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public listProjects(userId?: string): Project[] {
    const query = userId 
      ? 'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
      : 'SELECT * FROM projects ORDER BY updated_at DESC';
    
    const params = userId ? [userId] : [];
    const rows = this.db.query(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      sandboxId: row.sandbox_id,
      provider: row.provider,
      status: row.status,
      agentType: row.agent_type,
      gitRepo: row.git_repo,
      agentConfig: JSON.parse(row.agent_config || '{}'),
      localDir: row.local_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public updateProject(id: string, updates: Partial<Project>): void {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'createdAt');
    if (fields.length === 0) return;

    const setClause = fields
      .map(field => {
        const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        return `${dbField} = ?`;
      })
      .join(', ');

    const values = fields.map(field => {
      const value = (updates as any)[field];
      return field === 'agentConfig' ? JSON.stringify(value) : value;
    });

    values.push(new Date().toISOString()); // updated_at
    values.push(id); // WHERE id = ?

    this.db.query(`UPDATE projects SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values);
  }

  public deleteProject(id: string): void {
    this.db.query('DELETE FROM projects WHERE id = ?').run(id);
  }

  // Thread operations
  public createThread(thread: Omit<Thread, 'createdAt' | 'updatedAt'>): Thread {
    const now = new Date().toISOString();
    const stmt = this.db.query(`
      INSERT INTO tasks (id, project_id, title, status, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      thread.id,
      thread.projectId,
      thread.title || null,
      thread.status,
      thread.sessionId || null,
      now,
      now
    );

    return { ...thread, createdAt: now, updatedAt: now };
  }

  public getThread(id: string): Thread | null {
    const row = this.db.query('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      sessionId: row.session_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public listThreads(projectId: string): Thread[] {
    const rows = this.db.query('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[];
    
    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      sessionId: row.session_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public updateThread(id: string, updates: Partial<Thread>): void {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'createdAt');
    if (fields.length === 0) return;

    const setClause = fields
      .map(field => {
        const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        return `${dbField} = ?`;
      })
      .join(', ');

    const values = fields.map(field => (updates as any)[field]);
    values.push(new Date().toISOString()); // updated_at
    values.push(id); // WHERE id = ?

    this.db.query(`UPDATE tasks SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values);
  }

  public deleteThread(id: string): void {
    this.db.query('DELETE FROM tasks WHERE id = ?').run(id);
  }

  // Message operations
  public createMessage(message: Omit<Message, 'createdAt'>): Message {
    const now = new Date().toISOString();
    const stmt = this.db.query(`
      INSERT INTO messages (id, task_id, role, content, token_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      message.id,
      message.threadId,
      message.role,
      JSON.stringify(message.content),
      message.tokenCount || null,
      now
    );

    return { ...message, createdAt: now };
  }

  public getMessages(threadId: string): Message[] {
    const rows = this.db.query('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC').all(threadId) as any[];
    
    return rows.map(row => ({
      id: row.id,
      threadId: row.task_id,
      role: row.role,
      content: JSON.parse(row.content || '[]'),
      tokenCount: row.token_count,
      createdAt: row.created_at,
    }));
  }

  // Settings operations
  public getSetting(key: string): string | null {
    const row = this.db.query('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row ? row.value : null;
  }

  public setSetting(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT OR REPLACE INTO settings (id, key, value, created_at, updated_at)
      VALUES (?, ?, ?, COALESCE((SELECT created_at FROM settings WHERE key = ?), ?), ?)
    `).run(`setting-${key}`, key, value, key, now, now);
  }

  public deleteSetting(key: string): void {
    this.db.query('DELETE FROM settings WHERE key = ?').run(key);
  }

  public getAllSettings(): Record<string, string> {
    const rows = this.db.query('SELECT key, value FROM settings').all() as any[];
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  public close(): void {
    this.db.close();
  }
}