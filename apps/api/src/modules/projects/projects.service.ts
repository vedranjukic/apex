import { eq, or, isNull, isNotNull, and, asc, desc, sql } from 'drizzle-orm';
import { db } from '../../database/db';
import { projects, tasks } from '../../database/schema';
import { SandboxManager } from '@apex/orchestrator';
import { projectsWsBroadcast } from './projects.ws';

export type Project = typeof projects.$inferSelect & { threads?: (typeof tasks.$inferSelect)[] };

type ProviderType = 'daytona' | 'docker' | 'apple-container';

class ProjectsService {
  private sandboxManagers = new Map<string, SandboxManager>();

  async init() {
    await this.initSandboxManagers();
  }

  private async initSandboxManagers() {
    this.sandboxManagers.clear();

    const sharedConfig = {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      githubToken: process.env.GITHUB_TOKEN,
    };

    const hasDaytonaKey = !!process.env.DAYTONA_API_KEY;
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

    if (hasDaytonaKey || hasAnthropicKey) {
      try {
        const mgr = new SandboxManager({ ...sharedConfig, provider: 'daytona' });
        await mgr.initialize();
        this.sandboxManagers.set('daytona', mgr);
        console.log('[projects] SandboxManager initialized (provider=daytona)');
      } catch (err) {
        console.error('[projects] SandboxManager init failed (daytona):', err);
      }
    } else {
      console.log('[projects] Daytona SandboxManager skipped – no API keys configured');
    }

    try {
      const mgr = new SandboxManager({ ...sharedConfig, provider: 'docker' });
      await mgr.initialize();
      this.sandboxManagers.set('docker', mgr);
      console.log('[projects] SandboxManager initialized (provider=docker)');
    } catch (err) {
      console.log('[projects] Docker SandboxManager skipped – Docker not available:', (err as Error).message);
    }

    try {
      const mgr = new SandboxManager({ ...sharedConfig, provider: 'apple-container' });
      await mgr.initialize();
      this.sandboxManagers.set('apple-container', mgr);
      console.log('[projects] SandboxManager initialized (provider=apple-container)');
    } catch (err) {
      console.log('[projects] Apple Container SandboxManager skipped – not available:', (err as Error).message);
    }
  }

  async reinitSandboxManager() {
    console.log('[projects] Re-initializing SandboxManagers...');
    await this.initSandboxManagers();
  }

  private async ensureSandboxManager(provider?: string): Promise<boolean> {
    if (provider && this.sandboxManagers.has(provider)) return true;
    if (!provider && this.sandboxManagers.size > 0) return true;
    await this.initSandboxManagers();
    if (provider) return this.sandboxManagers.has(provider);
    return this.sandboxManagers.size > 0;
  }

  async reconcileSandboxStatus(projectId: string): Promise<Project> {
    const project = await this.findById(projectId);
    if (!project.sandboxId) return project;
    const manager = this.getManagerForProject(project);
    if (!manager) return project;

    try {
      const actualState = await manager.getSandboxState(project.sandboxId);
      const stateToStatus: Record<string, string> = {
        started: 'running', stopped: 'stopped', starting: 'starting',
        stopping: 'stopped', error: 'error', archived: 'stopped',
      };
      const expectedStatus = stateToStatus[actualState];
      if (expectedStatus && expectedStatus !== project.status && project.status !== 'creating') {
        await db.update(projects).set({ status: expectedStatus, statusError: null }).where(eq(projects.id, projectId));
        const updated = await this.findById(projectId);
        projectsWsBroadcast('project_updated', updated);
        return updated;
      }
    } catch (err) {
      console.warn(`[projects] Failed to reconcile sandbox status for ${projectId}:`, err);
    }
    return project;
  }

  async startOrProvisionSandbox(projectId: string): Promise<void> {
    const project = await this.findById(projectId);
    if (project.status !== 'stopped' && project.status !== 'error') return;

    const manager = this.getManagerForProject(project);
    if (!manager) {
      if (!(await this.ensureSandboxManager(project.provider))) return;
    }
    const mgr = this.getManagerForProject(project);
    if (!mgr) return;

    if (project.sandboxId) {
      try {
        await db.update(projects).set({ status: 'starting' }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
        await mgr.reconnectSandbox(project.sandboxId, project.name);
        await db.update(projects).set({ status: 'running', statusError: null }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.update(projects).set({ status: 'error', statusError: message }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
      }
    } else {
      await db.update(projects).set({ status: 'creating' }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      await this.provisionSandbox(projectId, project.sandboxSnapshot, project.provider as ProviderType, project.name, project.gitRepo, project.agentType);
    }
  }

  async findAllByUser(userId: string): Promise<Project[]> {
    return db.query.projects.findMany({
      where: and(eq(projects.userId, userId), isNull(projects.deletedAt)),
      orderBy: [desc(projects.createdAt)],
      with: { threads: true },
    }) as Promise<Project[]>;
  }

  async findById(id: string): Promise<Project> {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      with: { threads: true },
    });
    if (!project) throw new Error(`Project ${id} not found`);
    return project as Project;
  }

  async create(
    userId: string,
    data: {
      name: string;
      description?: string;
      agentType?: string;
      sandboxSnapshot?: string;
      provider?: string;
      gitRepo?: string;
      agentConfig?: Record<string, unknown>;
    },
  ): Promise<Project> {
    const id = crypto.randomUUID();
    const provider = data.provider || process.env['SANDBOX_PROVIDER'] || 'daytona';
    await db.insert(projects).values({
      id,
      userId,
      name: data.name,
      description: data.description || '',
      agentType: data.agentType || 'build',
      sandboxSnapshot: data.sandboxSnapshot || process.env['DAYTONA_SNAPSHOT'] || '',
      provider,
      gitRepo: data.gitRepo || null,
      agentConfig: data.agentConfig || null,
      status: 'creating',
    });
    const saved = await this.findById(id);
    projectsWsBroadcast('project_created', saved);

    this.provisionSandbox(saved.id, saved.sandboxSnapshot, saved.provider as ProviderType, saved.name, saved.gitRepo, saved.agentType).catch((err) => {
      console.error(`[projects] Failed to provision sandbox for project ${saved.id}:`, err);
    });

    return saved;
  }

  async update(id: string, data: Partial<Pick<typeof projects.$inferSelect, 'name' | 'description' | 'status' | 'agentConfig'>>): Promise<Project> {
    await db.update(projects).set({ ...data, updatedAt: new Date().toISOString() } as any).where(eq(projects.id, id));
    const updated = await this.findById(id);
    projectsWsBroadcast('project_updated', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, id),
    });
    if (!project) return;

    if (project.deletedAt) {
      await db.delete(projects).where(eq(projects.id, id));
      projectsWsBroadcast('project_deleted', { id });
      return;
    }

    const sandboxId = project.sandboxId;

    let familySandboxIds: string[] = [];
    try {
      const family = await this.findForkFamily(id);
      familySandboxIds = family.filter((m) => m.sandboxId && m.id !== id).map((m) => m.sandboxId!);
    } catch { /* not part of a fork family */ }

    const manager = this.getManagerForProject(project);
    if (sandboxId && manager) {
      const deleted = await this.deleteOrStopSandbox(sandboxId, manager);
      if (deleted) {
        await db.delete(projects).where(eq(projects.id, id));
      } else {
        await db.update(projects).set({ deletedAt: new Date().toISOString() }).where(eq(projects.id, id));
      }
    } else {
      await db.delete(projects).where(eq(projects.id, id));
    }

    projectsWsBroadcast('project_deleted', { id });

    if (sandboxId && manager && familySandboxIds.length > 0) {
      this.cleanupOrphanedFamilySandboxes(familySandboxIds, manager).catch(() => {});
    }
  }

  private async deleteOrStopSandbox(sandboxId: string, manager: SandboxManager): Promise<boolean> {
    try {
      await manager.deleteSandbox(sandboxId);
      return true;
    } catch {
      try { await manager.stopSandbox(sandboxId); } catch { /* ignore */ }
      return false;
    }
  }

  private async cleanupOrphanedFamilySandboxes(sandboxIds: string[], manager: SandboxManager): Promise<void> {
    for (const sbId of sandboxIds) {
      const liveCount = await db.select({ count: sql<number>`count(*)` }).from(projects).where(and(eq(projects.sandboxId, sbId), isNull(projects.deletedAt)));
      if ((liveCount[0]?.count ?? 0) > 0) continue;
      const deleted = await this.deleteOrStopSandbox(sbId, manager);
      if (deleted) {
        const ghost = await db.query.projects.findFirst({
          where: and(eq(projects.sandboxId, sbId), isNotNull(projects.deletedAt)),
        });
        if (ghost) await db.delete(projects).where(eq(projects.id, ghost.id));
      }
    }
  }

  async forkProject(sourceProjectId: string, branchName: string): Promise<Project> {
    const source = await this.findById(sourceProjectId);
    if (!source.sandboxId) throw new Error('Source project has no sandbox — cannot fork');

    const rootId = source.forkedFromId ?? source.id;
    const id = crypto.randomUUID();

    await db.insert(projects).values({
      id,
      userId: source.userId,
      name: `${source.name} (${branchName})`,
      description: source.description,
      agentType: source.agentType,
      sandboxSnapshot: source.sandboxSnapshot,
      provider: source.provider,
      gitRepo: source.gitRepo,
      agentConfig: source.agentConfig,
      forkedFromId: rootId,
      branchName,
      status: 'creating',
    });
    const saved = await this.findById(id);
    projectsWsBroadcast('project_created', saved);

    const rootName = source.forkedFromId
      ? (await this.findById(source.forkedFromId)).name
      : source.name;

    this.provisionFork(saved.id, saved.provider as ProviderType, source.sandboxId, branchName, rootName).catch((err) => {
      console.error(`[projects] Failed to provision fork for project ${saved.id}:`, err);
    });

    return saved;
  }

  async findForkFamily(projectId: string): Promise<Project[]> {
    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new Error(`Project ${projectId} not found`);
    const rootId = project.forkedFromId ?? project.id;

    return db.query.projects.findMany({
      where: or(eq(projects.id, rootId), eq(projects.forkedFromId, rootId)),
      orderBy: [asc(projects.createdAt)],
      with: { threads: true },
    }) as Promise<Project[]>;
  }

  /**
   * Get the sandbox manager for a specific provider, or the first available one.
   * Callers with access to the project should use {@link getManagerForProject} instead.
   */
  getSandboxManager(provider?: string): SandboxManager | null {
    if (provider) return this.sandboxManagers.get(provider) ?? null;
    // Backward-compat: return any available manager (prefer daytona)
    return this.sandboxManagers.get('daytona')
      ?? this.sandboxManagers.values().next().value
      ?? null;
  }

  /** Resolve the correct sandbox manager for a project using its provider field. */
  private getManagerForProject(project: { provider: string }): SandboxManager | null {
    return this.sandboxManagers.get(project.provider) ?? this.getSandboxManager();
  }

  private async provisionSandbox(
    projectId: string, snapshot: string, provider: ProviderType,
    projectName?: string, gitRepo?: string | null, agentType?: string,
  ): Promise<void> {
    if (!(await this.ensureSandboxManager(provider))) {
      await db.update(projects).set({ status: 'stopped' }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      return;
    }
    const manager = this.sandboxManagers.get(provider)!;
    const onStatusChange = async (status: string) => {
      await db.update(projects).set({ status }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
    };
    try {
      const sandboxId = await manager.createSandbox(
        snapshot, projectName, gitRepo || undefined, agentType, projectId, onStatusChange,
      );
      await db.update(projects).set({ sandboxId, status: 'running', statusError: null }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(projects).set({ status: 'error', statusError: message }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      throw err;
    }
  }

  private async provisionFork(
    projectId: string, provider: ProviderType, sourceSandboxId: string,
    branchName: string, projectName?: string,
  ): Promise<void> {
    if (!(await this.ensureSandboxManager(provider))) {
      await db.update(projects).set({ status: 'stopped' }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      return;
    }
    const manager = this.sandboxManagers.get(provider)!;
    try {
      const sandboxId = await manager.forkSandbox(sourceSandboxId, branchName, projectName);
      await db.update(projects).set({ sandboxId, status: 'running', statusError: null }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(projects).set({ status: 'error', statusError: message }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      throw err;
    }
  }
}

export const projectsService = new ProjectsService();
