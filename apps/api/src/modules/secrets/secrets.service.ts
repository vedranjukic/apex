import { eq, and, isNull, or, sql, count } from 'drizzle-orm';
import { db } from '../../database/db';
import { secrets } from '../../database/schema';

export interface SecretRecord {
  id: string;
  userId: string;
  projectId: string | null;
  repositoryId: string | null; // GitHub repository in "owner/repo" format
  name: string;
  value: string;
  domain: string;
  authType: string;
  isSecret: boolean; // true for secrets, false for environment variables
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecretListItem {
  id: string;
  name: string;
  domain: string;
  authType: string;
  isSecret: boolean;
  description: string | null;
  projectId: string | null;
  repositoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecretInput {
  name: string;
  value: string;
  domain: string;
  authType?: string;
  isSecret?: boolean;
  description?: string;
  projectId?: string | null;
  repositoryId?: string | null;
}

export interface RepositoryInfo {
  repositoryId: string;
  secretCount: number;
  envVarCount: number;
  totalCount: number;
}

class SecretsService {
  async list(userId: string, projectId?: string, repositoryId?: string, scope?: string): Promise<SecretListItem[]> {
    let whereCondition = eq(secrets.userId, userId);
    
    if (scope === 'global') {
      // Only return global secrets (no project or repository scope)
      whereCondition = and(
        eq(secrets.userId, userId),
        isNull(secrets.projectId),
        isNull(secrets.repositoryId)
      );
    } else if (scope === 'repository' && repositoryId) {
      // Only return repository-specific secrets
      whereCondition = and(
        eq(secrets.userId, userId),
        eq(secrets.repositoryId, repositoryId)
      );
    } else if (projectId && repositoryId) {
      // Both project and repository specified - filter by both
      whereCondition = and(
        eq(secrets.userId, userId),
        or(
          eq(secrets.projectId, projectId),
          eq(secrets.repositoryId, repositoryId),
          and(isNull(secrets.projectId), isNull(secrets.repositoryId))
        )
      );
    } else if (projectId) {
      // Only project specified - backward compatibility
      whereCondition = and(
        eq(secrets.userId, userId),
        or(eq(secrets.projectId, projectId), isNull(secrets.projectId))
      );
    } else if (repositoryId) {
      // Only repository specified - filter by repository or globals
      whereCondition = and(
        eq(secrets.userId, userId),
        or(eq(secrets.repositoryId, repositoryId), and(isNull(secrets.projectId), isNull(secrets.repositoryId)))
      );
    }

    const rows = await db.select().from(secrets).where(whereCondition);
    return rows.map(({ value: _v, ...rest }) => rest);
  }

  /**
   * List all repositories that have secrets configured for the user
   * Returns repository IDs with counts of secrets and environment variables
   */
  async listRepositories(userId: string): Promise<RepositoryInfo[]> {
    const rows = await db
      .select({
        repositoryId: secrets.repositoryId,
        secretCount: sql<number>`count(case when ${secrets.isSecret} = true then 1 end)`,
        envVarCount: sql<number>`count(case when ${secrets.isSecret} = false then 1 end)`,
        totalCount: count(),
      })
      .from(secrets)
      .where(and(
        eq(secrets.userId, userId),
        sql`${secrets.repositoryId} IS NOT NULL`
      ))
      .groupBy(secrets.repositoryId);

    return rows.map(row => ({
      repositoryId: row.repositoryId!,
      secretCount: Number(row.secretCount) || 0,
      envVarCount: Number(row.envVarCount) || 0,
      totalCount: Number(row.totalCount) || 0,
    }));
  }

  /**
   * List secrets for a specific repository
   */
  async listRepositorySecrets(userId: string, repositoryId: string): Promise<SecretListItem[]> {
    const rows = await db.select().from(secrets).where(
      and(
        eq(secrets.userId, userId),
        eq(secrets.repositoryId, repositoryId)
      )
    );
    return rows.map(({ value: _v, ...rest }) => rest);
  }

  /**
   * Create a secret for a specific repository
   */
  async createRepositorySecret(userId: string, repositoryId: string, input: Omit<CreateSecretInput, 'repositoryId' | 'projectId'>): Promise<SecretRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      userId,
      projectId: null,
      repositoryId,
      name: input.name,
      value: input.value,
      domain: input.domain,
      authType: input.authType || 'bearer',
      isSecret: input.isSecret ?? true,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(secrets).values(row);
    return row;
  }

  /**
   * Update a repository secret (with repository scope validation)
   */
  async updateRepositorySecret(id: string, userId: string, repositoryId: string, updates: Partial<Omit<CreateSecretInput, 'repositoryId' | 'projectId'>>): Promise<SecretRecord | null> {
    const existing = await db.query.secrets.findFirst({
      where: and(
        eq(secrets.id, id), 
        eq(secrets.userId, userId),
        eq(secrets.repositoryId, repositoryId)
      ),
    });
    if (!existing) return null;

    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.name !== undefined) set.name = updates.name;
    if (updates.value !== undefined) set.value = updates.value;
    if (updates.domain !== undefined) set.domain = updates.domain;
    if (updates.authType !== undefined) set.authType = updates.authType;
    if (updates.isSecret !== undefined) set.isSecret = updates.isSecret;
    if (updates.description !== undefined) set.description = updates.description;

    await db.update(secrets).set(set).where(eq(secrets.id, id));

    const updated = await db.query.secrets.findFirst({ where: eq(secrets.id, id) });
    return updated ?? null;
  }

  /**
   * Remove a repository secret (with repository scope validation)
   */
  async removeRepositorySecret(id: string, userId: string, repositoryId: string): Promise<boolean> {
    const existing = await db.query.secrets.findFirst({
      where: and(
        eq(secrets.id, id), 
        eq(secrets.userId, userId),
        eq(secrets.repositoryId, repositoryId)
      ),
    });
    if (!existing) return false;
    await db.delete(secrets).where(eq(secrets.id, id));
    return true;
  }

  async create(userId: string, input: CreateSecretInput): Promise<SecretRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      userId,
      projectId: input.projectId ?? null,
      repositoryId: input.repositoryId ?? null,
      name: input.name,
      value: input.value,
      domain: input.domain,
      authType: input.authType || 'bearer',
      isSecret: input.isSecret ?? true,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(secrets).values(row);
    return row;
  }

  async update(id: string, userId: string, updates: Partial<CreateSecretInput>): Promise<SecretRecord | null> {
    const existing = await db.query.secrets.findFirst({
      where: and(eq(secrets.id, id), eq(secrets.userId, userId)),
    });
    if (!existing) return null;

    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.name !== undefined) set.name = updates.name;
    if (updates.value !== undefined) set.value = updates.value;
    if (updates.domain !== undefined) set.domain = updates.domain;
    if (updates.authType !== undefined) set.authType = updates.authType;
    if (updates.isSecret !== undefined) set.isSecret = updates.isSecret;
    if (updates.description !== undefined) set.description = updates.description;
    if (updates.projectId !== undefined) set.projectId = updates.projectId;
    if (updates.repositoryId !== undefined) set.repositoryId = updates.repositoryId;

    await db.update(secrets).set(set).where(eq(secrets.id, id));

    const updated = await db.query.secrets.findFirst({ where: eq(secrets.id, id) });
    return updated ?? null;
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const existing = await db.query.secrets.findFirst({
      where: and(eq(secrets.id, id), eq(secrets.userId, userId)),
    });
    if (!existing) return false;
    await db.delete(secrets).where(eq(secrets.id, id));
    return true;
  }

  /**
   * Resolve all secrets for a project, merging global + project-scoped.
   * Project-scoped secrets override globals by name. Returns full records
   * WITH values (internal use only — proxy, bridge).
   */
  async resolveForProject(userId: string, projectId: string): Promise<SecretRecord[]> {
    const rows = await db.select().from(secrets).where(
      and(
        eq(secrets.userId, userId),
        or(eq(secrets.projectId, projectId), isNull(secrets.projectId)),
      ),
    );

    const byName = new Map<string, SecretRecord>();
    for (const row of rows) {
      const existing = byName.get(row.name);
      if (!existing || (row.projectId && !existing.projectId)) {
        byName.set(row.name, row as SecretRecord);
      }
    }
    return Array.from(byName.values());
  }

  /**
   * Resolve all secrets for a repository, merging global + repository-scoped.
   * Repository-scoped secrets override globals by name. Returns full records
   * WITH values (internal use only — proxy, bridge).
   */
  async resolveForRepository(userId: string, repositoryId: string): Promise<SecretRecord[]> {
    const rows = await db.select().from(secrets).where(
      and(
        eq(secrets.userId, userId),
        or(
          eq(secrets.repositoryId, repositoryId), 
          and(isNull(secrets.projectId), isNull(secrets.repositoryId))
        ),
      ),
    );

    const byName = new Map<string, SecretRecord>();
    for (const row of rows) {
      const existing = byName.get(row.name);
      // Repository-scoped secrets override global secrets (repository takes precedence over global)
      if (!existing || (row.repositoryId && !existing.repositoryId)) {
        byName.set(row.name, row as SecretRecord);
      }
    }
    return Array.from(byName.values());
  }

  /**
   * Resolve all secrets for both project and repository context.
   * Priority: repository-scoped > project-scoped > global
   * Returns full records WITH values (internal use only — proxy, bridge).
   */
  async resolveForContext(userId: string, projectId?: string, repositoryId?: string): Promise<SecretRecord[]> {
    const conditions = [eq(secrets.userId, userId)];
    
    if (projectId && repositoryId) {
      conditions.push(or(
        eq(secrets.repositoryId, repositoryId),
        eq(secrets.projectId, projectId),
        and(isNull(secrets.projectId), isNull(secrets.repositoryId))
      ));
    } else if (repositoryId) {
      conditions.push(or(
        eq(secrets.repositoryId, repositoryId),
        and(isNull(secrets.projectId), isNull(secrets.repositoryId))
      ));
    } else if (projectId) {
      conditions.push(or(
        eq(secrets.projectId, projectId),
        isNull(secrets.projectId)
      ));
    }

    const rows = await db.select().from(secrets).where(and(...conditions));

    const byName = new Map<string, SecretRecord>();
    for (const row of rows) {
      const existing = byName.get(row.name);
      // Priority: repository-scoped > project-scoped > global
      if (!existing || 
          (row.repositoryId && !existing.repositoryId) ||
          (row.projectId && !existing.projectId && !existing.repositoryId)) {
        byName.set(row.name, row as SecretRecord);
      }
    }
    return Array.from(byName.values());
  }

  /**
   * Resolve only actual secrets (isSecret=true) for context, excluding environment variables.
   * Priority: repository-scoped > project-scoped > global
   * Used by proxy to configure MITM interception more efficiently.
   */
  async resolveSecretsForContext(userId: string, projectId?: string, repositoryId?: string): Promise<SecretRecord[]> {
    const allResolved = await this.resolveForContext(userId, projectId, repositoryId);
    return allResolved.filter(record => record.isSecret);
  }

  /**
   * Look up secrets matching a domain. Used by the MITM proxy to decide
   * whether to intercept a CONNECT and which auth to inject.
   */
  async findByDomain(domain: string): Promise<SecretRecord[]> {
    const rows = await db.select().from(secrets).where(eq(secrets.domain, domain));
    return rows as SecretRecord[];
  }

  /**
   * Return ALL secrets with values (not user-scoped).
   * Used internally by the proxy sandbox to configure MITM interception.
   */
  async findAll(): Promise<SecretRecord[]> {
    const rows = await db.select().from(secrets);
    return rows as SecretRecord[];
  }

  /**
   * Return only actual secrets (isSecret=true), excluding environment variables.
   * Used by proxy to configure MITM interception more efficiently.
   */
  async findAllSecrets(): Promise<SecretRecord[]> {
    const rows = await db.select().from(secrets).where(eq(secrets.isSecret, true));
    return rows as SecretRecord[];
  }

  /** Get all unique domains that have secrets configured. */
  async getSecretDomains(): Promise<Set<string>> {
    const rows = await db.select({ domain: secrets.domain }).from(secrets);
    return new Set(rows.map((r) => r.domain));
  }
}

export const secretsService = new SecretsService();
