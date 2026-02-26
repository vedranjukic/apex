import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity } from '../../database/entities/project.entity';
import { SandboxManager } from '@apex/orchestrator';
import { ProjectsGateway } from './projects.gateway';

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);
  private sandboxManager: SandboxManager | null = null;

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
    @Inject(forwardRef(() => ProjectsGateway))
    private readonly gateway: ProjectsGateway,
  ) {}

  async onModuleInit() {
    await this.initSandboxManager();
  }

  private async initSandboxManager() {
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasDaytonaKey = !!process.env.DAYTONA_API_KEY;
    if (!hasAnthropicKey && !hasDaytonaKey) {
      this.logger.warn('SandboxManager skipped – no API keys configured (set them in Settings)');
      this.sandboxManager = null;
      return;
    }
    try {
      this.sandboxManager = new SandboxManager({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });
      await this.sandboxManager.initialize();
      this.logger.log(
        `SandboxManager initialized (anthropicKey=${hasAnthropicKey}, daytonaKey=${hasDaytonaKey})`,
      );
    } catch (err) {
      this.logger.error(`SandboxManager init failed: ${err instanceof Error ? err.stack : err}`);
      this.sandboxManager = null;
    }
  }

  async reinitSandboxManager() {
    this.logger.log('Re-initializing SandboxManager with updated settings...');
    await this.initSandboxManager();
  }

  private async ensureSandboxManager(): Promise<boolean> {
    if (this.sandboxManager) return true;
    await this.initSandboxManager();
    return this.sandboxManager !== null;
  }

  async reconcileSandboxStatus(projectId: string): Promise<ProjectEntity> {
    const project = await this.findById(projectId);
    if (!project.sandboxId) return project;
    if (!(await this.ensureSandboxManager())) return project;

    try {
      const actualState = await this.sandboxManager!.getSandboxState(project.sandboxId);
      this.logger.log(`Sandbox ${project.sandboxId} actual state: ${actualState}, DB status: ${project.status}`);

      const stateToStatus: Record<string, string> = {
        started: 'running',
        stopped: 'stopped',
        starting: 'starting',
        stopping: 'stopped',
        error: 'error',
        archived: 'stopped',
      };
      const expectedStatus = stateToStatus[actualState];

      if (expectedStatus && expectedStatus !== project.status && project.status !== 'creating') {
        this.logger.log(`Reconciling project ${projectId}: ${project.status} → ${expectedStatus}`);
        await this.repo.update(projectId, { status: expectedStatus, statusError: null });
        const updated = await this.findById(projectId);
        this.gateway.notifyUpdated(updated);
        return updated;
      }
    } catch (err) {
      this.logger.warn(`Failed to reconcile sandbox status for ${projectId}: ${err}`);
    }
    return project;
  }

  async startOrProvisionSandbox(projectId: string): Promise<void> {
    const project = await this.findById(projectId);
    if (project.status !== 'stopped' && project.status !== 'error') return;

    if (!(await this.ensureSandboxManager())) {
      this.logger.warn(`Cannot start/provision sandbox for ${projectId} – no SandboxManager`);
      return;
    }

    if (project.sandboxId) {
      try {
        this.logger.log(`Starting stopped sandbox ${project.sandboxId} for project ${projectId}...`);
        await this.repo.update(projectId, { status: 'starting' });
        this.gateway.notifyUpdated(await this.findById(projectId));

        await this.sandboxManager!.reconnectSandbox(project.sandboxId, project.name);

        await this.repo.update(projectId, { status: 'running', statusError: null });
        this.logger.log(`Sandbox ${project.sandboxId} started successfully`);
        this.gateway.notifyUpdated(await this.findById(projectId));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to start sandbox ${project.sandboxId}: ${message}`);
        await this.repo.update(projectId, { status: 'error', statusError: message });
        this.gateway.notifyUpdated(await this.findById(projectId));
      }
    } else {
      this.logger.log(`No sandboxId for project ${projectId} – provisioning new sandbox`);
      await this.repo.update(projectId, { status: 'creating' });
      this.gateway.notifyUpdated(await this.findById(projectId));
      await this.provisionSandbox(projectId, project.sandboxSnapshot, project.name, project.gitRepo);
    }
  }

  async findAllByUser(userId: string): Promise<ProjectEntity[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      relations: ['chats'],
    });
  }

  async findById(id: string): Promise<ProjectEntity> {
    const project = await this.repo.findOne({
      where: { id },
      relations: ['chats'],
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
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
  ): Promise<ProjectEntity> {
    const project = this.repo.create({
      userId,
      name: data.name,
      description: data.description || '',
      agentType: data.agentType || 'claude_code',
      sandboxSnapshot: data.sandboxSnapshot || process.env['DAYTONA_SNAPSHOT'] || '',
      gitRepo: data.gitRepo || null,
      agentConfig: data.agentConfig || null,
      status: 'creating',
    });
    const saved = await this.repo.save(project);
    this.gateway.notifyCreated(saved);

    // Asynchronously create the Daytona sandbox
    this.provisionSandbox(saved.id, saved.sandboxSnapshot, saved.name, saved.gitRepo).catch((err) => {
      this.logger.error(`Failed to provision sandbox for project ${saved.id}: ${err}`);
    });

    return saved;
  }

  async update(
    id: string,
    data: Partial<
      Pick<ProjectEntity, 'name' | 'description' | 'status' | 'agentConfig'>
    >,
  ): Promise<ProjectEntity> {
    await this.repo.update(id, data);
    const updated = await this.findById(id);
    this.gateway.notifyUpdated(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const project = await this.findById(id);
    const projectId = project.id;
    const sandboxId = project.sandboxId;

    // Collect sandbox IDs from the entire fork family (including soft-deleted
    // members) so we can clean up orphaned sandboxes after a successful delete.
    let familySandboxIds: string[] = [];
    try {
      const family = await this.findForkFamily(id);
      familySandboxIds = family
        .filter((m) => m.sandboxId && m.id !== id)
        .map((m) => m.sandboxId!);
    } catch {
      // project may not belong to a fork family
    }

    if (sandboxId && this.sandboxManager) {
      const deleted = await this.deleteOrStopSandbox(sandboxId);

      if (deleted) {
        // Sandbox is gone — hard-delete the project record.
        await this.repo.remove(project);
      } else {
        // Sandbox couldn't be deleted (e.g. it still has fork children).
        // Soft-delete the project so the fork family query can still
        // discover this sandbox for cleanup when the children are removed.
        await this.repo.softRemove(project);
      }
    } else {
      // No sandbox to worry about — hard-delete.
      await this.repo.remove(project);
    }

    this.gateway.notifyDeleted(projectId);

    // After a successful sandbox deletion, ancestor/sibling sandboxes that
    // previously couldn't be removed may now be eligible.
    if (sandboxId && this.sandboxManager && familySandboxIds.length > 0) {
      this.cleanupOrphanedFamilySandboxes(familySandboxIds).catch((err) => {
        this.logger.warn(`Error cleaning up orphaned family sandboxes: ${err}`);
      });
    }
  }

  /**
   * Try to delete a sandbox; if that fails (e.g. it still has fork children),
   * stop it instead.  Returns `true` when the sandbox was fully deleted.
   */
  private async deleteOrStopSandbox(sandboxId: string): Promise<boolean> {
    if (!this.sandboxManager) return false;
    try {
      await this.sandboxManager.deleteSandbox(sandboxId);
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to delete sandbox ${sandboxId}, attempting stop: ${err}`,
      );
      try {
        await this.sandboxManager.stopSandbox(sandboxId);
      } catch (stopErr) {
        this.logger.warn(`Failed to stop sandbox ${sandboxId}: ${stopErr}`);
      }
      return false;
    }
  }

  /**
   * For each sandbox ID, check whether any *live* (non-deleted) project still
   * references it.  Orphaned sandboxes are deleted (or stopped as fallback),
   * and their soft-deleted project records are hard-deleted.
   */
  private async cleanupOrphanedFamilySandboxes(
    sandboxIds: string[],
  ): Promise<void> {
    if (!this.sandboxManager) return;

    for (const sbId of sandboxIds) {
      // Only live projects count — soft-deleted ones are already "gone".
      const liveRefCount = await this.repo.count({
        where: { sandboxId: sbId },
      });
      if (liveRefCount > 0) continue;

      this.logger.log(`Cleaning up orphaned sandbox ${sbId}`);
      const deleted = await this.deleteOrStopSandbox(sbId);

      if (deleted) {
        // Hard-delete the soft-deleted project record that held this sandbox.
        const ghost = await this.repo
          .createQueryBuilder('p')
          .withDeleted()
          .where('p.sandboxId = :sbId', { sbId })
          .andWhere('p.deletedAt IS NOT NULL')
          .getOne();
        if (ghost) {
          await this.repo.remove(ghost);
          this.logger.log(`Removed soft-deleted project ${ghost.id}`);
        }
      }
    }
  }

  async forkProject(
    sourceProjectId: string,
    branchName: string,
  ): Promise<ProjectEntity> {
    const source = await this.findById(sourceProjectId);

    if (!source.sandboxId) {
      throw new BadRequestException('Source project has no sandbox — cannot fork');
    }

    // Resolve root: if source is itself a fork, use its root; otherwise source IS the root
    const rootId = source.forkedFromId ?? source.id;

    const project = this.repo.create({
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
    const saved = await this.repo.save(project);
    this.gateway.notifyCreated(saved);

    // Resolve the root project's name for the sandbox directory path.
    // The forked sandbox's filesystem uses the root's directory layout.
    const rootName = source.forkedFromId
      ? (await this.findById(source.forkedFromId)).name
      : source.name;

    this.provisionFork(saved.id, source.sandboxId, branchName, rootName).catch((err) => {
      this.logger.error(`Failed to provision fork for project ${saved.id}: ${err}`);
    });

    return saved;
  }

  async findForkFamily(projectId: string): Promise<ProjectEntity[]> {
    // Use withDeleted so we can resolve a soft-deleted root project.
    const project = await this.repo.findOne({
      withDeleted: true,
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    const rootId = project.forkedFromId ?? project.id;

    // Include soft-deleted projects so we can discover orphaned sandboxes
    // whose project was removed but whose sandbox couldn't be deleted yet.
    return this.repo.find({
      withDeleted: true,
      where: [
        { id: rootId },
        { forkedFromId: rootId },
      ],
      order: { createdAt: 'ASC' },
      relations: ['chats'],
    });
  }

  getSandboxManager(): SandboxManager | null {
    return this.sandboxManager;
  }

  // ── Private ──────────────────────────────────────

  private async provisionSandbox(
    projectId: string,
    snapshot: string,
    projectName?: string,
    gitRepo?: string | null,
  ): Promise<void> {
    if (!(await this.ensureSandboxManager())) {
      this.logger.warn('No SandboxManager – skipping sandbox creation (configure API keys in Settings)');
      await this.repo.update(projectId, { status: 'stopped' });
      const project = await this.findById(projectId);
      this.gateway.notifyUpdated(project);
      return;
    }

    try {
      const sandboxId = await this.sandboxManager.createSandbox(snapshot, projectName, gitRepo || undefined);
      await this.repo.update(projectId, {
        sandboxId,
        status: 'running',
        statusError: null,
      });
      this.logger.log(`Sandbox ${sandboxId} provisioned for project ${projectId}`);
      const project = await this.findById(projectId);
      this.gateway.notifyUpdated(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.update(projectId, { status: 'error', statusError: message });
      const project = await this.findById(projectId);
      this.gateway.notifyUpdated(project);
      throw err;
    }
  }

  private async provisionFork(
    projectId: string,
    sourceSandboxId: string,
    branchName: string,
    projectName?: string,
  ): Promise<void> {
    if (!(await this.ensureSandboxManager())) {
      this.logger.warn('No SandboxManager – skipping fork (configure API keys in Settings)');
      await this.repo.update(projectId, { status: 'stopped' });
      const project = await this.findById(projectId);
      this.gateway.notifyUpdated(project);
      return;
    }

    try {
      const sandboxId = await this.sandboxManager.forkSandbox(
        sourceSandboxId,
        branchName,
        projectName,
      );
      await this.repo.update(projectId, {
        sandboxId,
        status: 'running',
        statusError: null,
      });
      this.logger.log(`Forked sandbox ${sandboxId} provisioned for project ${projectId}`);
      const project = await this.findById(projectId);
      this.gateway.notifyUpdated(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.update(projectId, { status: 'error', statusError: message });
      const project = await this.findById(projectId);
      this.gateway.notifyUpdated(project);
      throw err;
    }
  }
}
