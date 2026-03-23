import { eq, and, isNull, or } from 'drizzle-orm';
import { db } from '../../database/db';
import { secrets } from '../../database/schema';

export interface SecretRecord {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  value: string;
  domain: string;
  authType: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecretListItem {
  id: string;
  name: string;
  domain: string;
  authType: string;
  description: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecretInput {
  name: string;
  value: string;
  domain: string;
  authType?: string;
  description?: string;
  projectId?: string | null;
}

class SecretsService {
  async list(userId: string, projectId?: string): Promise<SecretListItem[]> {
    const rows = projectId
      ? await db.select().from(secrets).where(
          and(
            eq(secrets.userId, userId),
            or(eq(secrets.projectId, projectId), isNull(secrets.projectId)),
          ),
        )
      : await db.select().from(secrets).where(eq(secrets.userId, userId));

    return rows.map(({ value: _v, ...rest }) => rest);
  }

  async create(userId: string, input: CreateSecretInput): Promise<SecretRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      userId,
      projectId: input.projectId ?? null,
      name: input.name,
      value: input.value,
      domain: input.domain,
      authType: input.authType || 'bearer',
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
    if (updates.description !== undefined) set.description = updates.description;
    if (updates.projectId !== undefined) set.projectId = updates.projectId;

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
   * Look up secrets matching a domain. Used by the MITM proxy to decide
   * whether to intercept a CONNECT and which auth to inject.
   */
  async findByDomain(domain: string): Promise<SecretRecord[]> {
    const rows = await db.select().from(secrets).where(eq(secrets.domain, domain));
    return rows as SecretRecord[];
  }

  /** Get all unique domains that have secrets configured. */
  async getSecretDomains(): Promise<Set<string>> {
    const rows = await db.select({ domain: secrets.domain }).from(secrets);
    return new Set(rows.map((r) => r.domain));
  }
}

export const secretsService = new SecretsService();
