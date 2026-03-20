import { eq, or, isNull, isNotNull, and, asc, desc, sql } from 'drizzle-orm';
import { db } from '../../database/db';
import { projects, tasks } from '../../database/schema';
import { SandboxManager } from '@apex/orchestrator';
import { projectsWsBroadcast } from './projects.ws';

export type Project = typeof projects.$inferSelect & { threads?: (typeof tasks.$inferSelect)[] };

class ProjectsService {
  private sandboxManager: SandboxManager | null = null;

  async init() {
    await this.initSandboxManager();
  }

  private async initSandboxManager() {
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasDaytonaKey = !!process.env.DAYTONA_API_KEY;
    const provider = (process.env.SANDBOX_PROVIDER as 'daytona' | 'docker' | 'apple-container') || 'daytona';

    if (provider === 'daytona' && !hasAnthropicKey && !hasDaytonaKey) {
      console.log('[projects] SandboxManager skipped – no API keys configured');
      this.sandboxManager = null;
      return;
    }
    try {
      this.sandboxManager = new SandboxManager({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
        githubToken: process.env.GITHUB_TOKEN,
        provider,
      });
      await this.sandboxManager.initialize();
      console.log(`[projects] SandboxManager initialized (provider=${provider})`);
    } catch (err) {
      console.error(`[projects] SandboxManager init failed:`, err);
      this.sandboxManager = null;
    }
  }

  async reinitSandboxManager() {
    console.log('[projects] Re-initializing SandboxManager...');
    await this.initSandboxManager();
  }

  private async ensureSandboxManager(): Promise<boolean> {
    if (this.sandboxManager) return true;
    await this.initSandboxManager();
    return this.sandboxManager !== null;
  }

  async reconcileSandboxStatus(projectId: string): Promise<Project> {
    const project = await this.findById(projectId);
    if (!project.sandboxId) return project;
    if (!(await this.ensureSandboxManager())) return project;

    try {
      const actualState = await this.sandboxManager!.getSandboxState(project.sandboxId);
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

    if (!(await this.ensureSandboxManager())) return;

    if (project.sandboxId) {
      try {
        await db.update(projects).set({ status: 'starting' }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
        await this.sandboxManager!.reconnectSandbox(project.sandboxId, project.name);
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
      await this.provisionSandbox(projectId, project.sandboxSnapshot, project.name, project.gitRepo, project.agentType);
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
      gitRepo?: string;
      agentConfig?: Record<string, unknown>;
    },
  ): Promise<Project> {
    const id = crypto.randomUUID();
    await db.insert(projects).values({
      id,
      userId,
      name: data.name,
      description: data.description || '',
      agentType: data.agentType || 'build',
      sandboxSnapshot: data.sandboxSnapshot || process.env['DAYTONA_SNAPSHOT'] || '',
      gitRepo: data.gitRepo || null,
      agentConfig: data.agentConfig || null,
      status: 'creating',
    });
    const saved = await this.findById(id);
    projectsWsBroadcast('project_created', saved);

    this.provisionSandbox(saved.id, saved.sandboxSnapshot, saved.name, saved.gitRepo, saved.agentType).catch((err) => {
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
    const project = await this.findById(id);
    const sandboxId = project.sandboxId;

    let familySandboxIds: string[] = [];
    try {
      const family = await this.findForkFamily(id);
      familySandboxIds = family.filter((m) => m.sandboxId && m.id !== id).map((m) => m.sandboxId!);
    } catch { /* not part of a fork family */ }

    if (sandboxId && this.sandboxManager) {
      const deleted = await this.deleteOrStopSandbox(sandboxId);
      if (deleted) {
        await db.delete(projects).where(eq(projects.id, id));
      } else {
        await db.update(projects).set({ deletedAt: new Date().toISOString() }).where(eq(projects.id, id));
      }
    } else {
      await db.delete(projects).where(eq(projects.id, id));
    }

    projectsWsBroadcast('project_deleted', { id });

    if (sandboxId && this.sandboxManager && familySandboxIds.length > 0) {
      this.cleanupOrphanedFamilySandboxes(familySandboxIds).catch(() => {});
    }
  }

  private async deleteOrStopSandbox(sandboxId: string): Promise<boolean> {
    if (!this.sandboxManager) return false;
    try {
      await this.sandboxManager.deleteSandbox(sandboxId);
      return true;
    } catch {
      try { await this.sandboxManager.stopSandbox(sandboxId); } catch { /* ignore */ }
      return false;
    }
  }

  private async cleanupOrphanedFamilySandboxes(sandboxIds: string[]): Promise<void> {
    if (!this.sandboxManager) return;
    for (const sbId of sandboxIds) {
      const liveCount = await db.select({ count: sql<number>`count(*)` }).from(projects).where(and(eq(projects.sandboxId, sbId), isNull(projects.deletedAt)));
      if ((liveCount[0]?.count ?? 0) > 0) continue;
      const deleted = await this.deleteOrStopSandbox(sbId);
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

    this.provisionFork(saved.id, source.sandboxId, branchName, rootName).catch((err) => {
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

  getSandboxManager(): SandboxManager | null {
    return this.sandboxManager;
  }

  private async provisionSandbox(
    projectId: string, snapshot: string, projectName?: string,
    gitRepo?: string | null, agentType?: string,
  ): Promise<void> {
    if (!(await this.ensureSandboxManager())) {
      await db.update(projects).set({ status: 'stopped' }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      return;
    }
    try {
      const sandboxId = await this.sandboxManager!.createSandbox(snapshot, projectName, gitRepo || undefined, agentType);
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
    projectId: string, sourceSandboxId: string, branchName: string, projectName?: string,
  ): Promise<void> {
    if (!(await this.ensureSandboxManager())) {
      await db.update(projects).set({ status: 'stopped' }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      return;
    }
    try {
      const sandboxId = await this.sandboxManager!.forkSandbox(sourceSandboxId, branchName, projectName);
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
