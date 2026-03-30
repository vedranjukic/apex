import { eq, or, isNull, isNotNull, and, asc, desc, sql } from 'drizzle-orm';
import { execFile as execFileCb } from 'child_process';
import { db } from '../../database/db';
import { projects, tasks } from '../../database/schema';
import { SandboxManager } from '@apex/orchestrator';
import { parseGitHubUrl, issueBranchName } from '@apex/shared';
import { githubService } from '../github/github.service';
import { projectsWsBroadcast } from './projects.ws';
import { getCACertPem } from '../secrets-proxy/ca-manager';
import { getSecretsProxyPort } from '../secrets-proxy/secrets-proxy';
import { secretsService } from '../secrets/secrets.service';
import { settingsService } from '../settings/settings.service';
import { threadsService } from '../tasks/tasks.service';
import { proxySandboxService } from '../llm-proxy/proxy-sandbox.service';
import { DaytonaSandboxProvider } from '@apex/orchestrator';

export type Project = typeof projects.$inferSelect & { threads?: (typeof tasks.$inferSelect)[] };

type ProviderType = 'daytona' | 'docker' | 'apple-container' | 'local';

export interface ProviderStatus {
  type: ProviderType;
  available: boolean;
  reason?: string;
}

/** Quick shell-out check — resolves true if the command exits 0. */
function canExec(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFileCb(cmd, args, { timeout: 5000 }, (err) => resolve(!err));
  });
}

type AutoStartHandler = (threadId: string, prompt: string) => Promise<void>;

class ProjectsService {
  private sandboxManagers = new Map<string, SandboxManager>();
  private providerStatuses: ProviderStatus[] = [];
  private autoStartHandler: AutoStartHandler | null = null;

  async init() {
    await this.initSandboxManagers();
  }

  registerAutoStartHandler(handler: AutoStartHandler) {
    this.autoStartHandler = handler;
  }

  /** Run lightweight dependency checks for every provider (once at startup). */
  private async checkProviderDependencies(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];

    const ENV_FLAGS: Record<ProviderType, string> = {
      daytona: 'DISABLE_PROVIDER_DAYTONA',
      docker: 'DISABLE_PROVIDER_DOCKER',
      'apple-container': 'DISABLE_PROVIDER_APPLE_CONTAINER',
      local: 'DISABLE_PROVIDER_LOCAL',
    };

    for (const type of ['daytona', 'docker', 'apple-container', 'local'] as ProviderType[]) {
      if (process.env[ENV_FLAGS[type]] === 'true') {
        statuses.push({ type, available: false, reason: `Disabled via ${ENV_FLAGS[type]}` });
        continue;
      }

      switch (type) {
        case 'daytona': {
          const hasKey = !!(process.env.DAYTONA_API_KEY);
          statuses.push(hasKey
            ? { type, available: true }
            : { type, available: false, reason: 'DAYTONA_API_KEY not configured' });
          break;
        }
        case 'docker': {
          const dockerOk = await canExec('docker', ['info']);
          statuses.push(dockerOk
            ? { type, available: true }
            : { type, available: false, reason: 'Docker is not installed or the daemon is not running' });
          break;
        }
        case 'apple-container': {
          const containerOk = await canExec('container', ['system', 'status']);
          statuses.push(containerOk
            ? { type, available: true }
            : { type, available: false, reason: 'Apple Container CLI not found or service not running' });
          break;
        }
        case 'local': {
          statuses.push({ type, available: true });
          break;
        }
      }
    }
    return statuses;
  }

  private async initSandboxManagers() {
    this.sandboxManagers.clear();

    this.providerStatuses = await this.checkProviderDependencies();
    for (const s of this.providerStatuses) {
      if (!s.available) {
        console.log(`[projects] ${s.type} provider unavailable: ${s.reason}`);
      }
    }

    let caCert = '';
    try { caCert = getCACertPem(); } catch { /* CA not yet initialized */ }

    const secretPlaceholders: Record<string, string> = {};
    try {
      const domains = await secretsService.getSecretDomains();
      if (domains.size > 0) {
        const allSecrets = await secretsService.list(
          '00000000-0000-0000-0000-000000000001',
        );
        for (const s of allSecrets) {
          secretPlaceholders[s.name] = 'sk-proxy-placeholder';
        }
      }
    } catch { /* secrets table may not exist yet */ }

    let gitUserName = '';
    let gitUserEmail = '';
    try {
      const nameOverride = await settingsService.get('GIT_USER_NAME');
      const emailOverride = await settingsService.get('GIT_USER_EMAIL');
      if (nameOverride && emailOverride) {
        gitUserName = nameOverride;
        gitUserEmail = emailOverride;
      } else if (process.env.GITHUB_TOKEN) {
        const ghUser = await githubService.fetchUser();
        if (ghUser) {
          gitUserName = nameOverride || ghUser.name;
          gitUserEmail = emailOverride || ghUser.email;
        }
      }
    } catch { /* non-fatal — sandboxes will just lack git identity */ }

    const sharedConfig = {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      githubToken: process.env.GITHUB_TOKEN,
      gitUserName,
      gitUserEmail,
      secretsProxyCaCert: caCert,
      secretsProxyPort: getSecretsProxyPort(),
      secretPlaceholders,
    };

    for (const status of this.providerStatuses) {
      if (!status.available) continue;
      try {
        const providerConfig: Record<string, unknown> = { ...sharedConfig, provider: status.type };

        if (status.type === 'daytona') {
          const anthropicKey = sharedConfig.anthropicApiKey || '';
          const openaiKey = sharedConfig.openaiApiKey || '';
          if (anthropicKey || openaiKey) {
            try {
              const daytonaProvider = new DaytonaSandboxProvider();
              await daytonaProvider.initialize();
              const proxyInfo = await proxySandboxService.ensureProxySandbox(
                daytonaProvider, anthropicKey, openaiKey,
              );
              providerConfig.proxyBaseUrl = proxyInfo.proxyBaseUrl;
              providerConfig.proxyAuthToken = proxyInfo.authToken;
              console.log(`[projects] Daytona LLM proxy sandbox ready: ${proxyInfo.proxyBaseUrl}`);
            } catch (proxyErr) {
              console.warn(`[projects] Daytona LLM proxy sandbox failed (non-fatal):`, proxyErr);
            }
          }
        }

        if (status.type === 'daytona') {
          console.log(`[projects] Daytona SandboxManager config: proxyBaseUrl=${providerConfig.proxyBaseUrl} hasAuthToken=${!!providerConfig.proxyAuthToken}`);
        }
        const mgr = new SandboxManager(providerConfig);
        await mgr.initialize();
        this.sandboxManagers.set(status.type, mgr);
        console.log(`[projects] SandboxManager initialized (provider=${status.type})`);
      } catch (err) {
        const reason = (err as Error).message;
        status.available = false;
        status.reason = reason;
        console.log(`[projects] ${status.type} SandboxManager failed to initialize: ${reason}`);
      }
    }
  }

  async reinitSandboxManager() {
    console.log('[projects] Re-initializing SandboxManagers...');
    await this.initSandboxManagers();
  }

  /**
   * Verify the Daytona LLM proxy sandbox is healthy and hot-update the
   * SandboxManager config if a new proxy sandbox was created.
   * Called lazily before every Daytona sandbox operation.
   */
  async ensureDaytonaProxy(): Promise<void> {
    const manager = this.sandboxManagers.get('daytona');
    if (!manager) return;

    const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    const openaiKey = process.env.OPENAI_API_KEY || '';
    if (!anthropicKey && !openaiKey) return;

    try {
      const oldCached = proxySandboxService.getCachedInfo();
      const daytonaProvider = new DaytonaSandboxProvider();
      await daytonaProvider.initialize();
      const info = await proxySandboxService.ensureProxySandbox(
        daytonaProvider, anthropicKey, openaiKey,
      );
      if (!oldCached || oldCached.proxyBaseUrl !== info.proxyBaseUrl) {
        manager.updateProxyConfig(info.proxyBaseUrl, info.authToken);
        console.log(`[projects] Daytona proxy config updated: ${info.proxyBaseUrl}`);
      }
    } catch (err) {
      console.warn('[projects] ensureDaytonaProxy failed:', err);
    }
  }

  /** Return provider types that are currently initialized. */
  getEnabledProviders(): string[] {
    return [...this.sandboxManagers.keys()];
  }

  /** Return full status (available/unavailable + reason) for all providers. */
  getProviderStatuses(): ProviderStatus[] {
    return this.providerStatuses;
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

    if (project.provider === 'daytona') await this.ensureDaytonaProxy();

    if (project.sandboxId) {
      try {
        await db.update(projects).set({ status: 'starting' }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
        await mgr.reconnectSandbox(project.sandboxId, project.name, project.localDir || undefined);
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
      await this.provisionSandbox(projectId, project.sandboxSnapshot, project.provider as ProviderType, project.name, project.gitRepo, project.agentType, project.localDir || undefined);
    }
  }

  async stopProject(projectId: string): Promise<Project> {
    const project = await this.findById(projectId);
    if (!project.sandboxId) throw new Error('No sandbox to stop');
    const manager = this.getManagerForProject(project);
    if (!manager) throw new Error('Sandbox manager not available');

    await db.update(projects).set({ status: 'stopping' }).where(eq(projects.id, projectId));
    const intermediate = await this.findById(projectId);
    projectsWsBroadcast('project_updated', intermediate);

    this.stopProjectAsync(projectId, project.sandboxId, manager).catch((err) => {
      console.error(`[projects] Background stop failed for ${projectId}:`, err);
    });

    return intermediate;
  }

  private async stopProjectAsync(projectId: string, sandboxId: string, manager: SandboxManager): Promise<void> {
    try {
      await manager.stopSandbox(sandboxId);
      await db.update(projects).set({ status: 'stopped', statusError: null }).where(eq(projects.id, projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(projects).set({ status: 'error', statusError: message }).where(eq(projects.id, projectId));
    }
    projectsWsBroadcast('project_updated', await this.findById(projectId));
  }

  async restartProject(projectId: string): Promise<Project> {
    const project = await this.findById(projectId);
    if (!project.sandboxId) throw new Error('No sandbox to restart');
    const manager = this.getManagerForProject(project);
    if (!manager) throw new Error('Sandbox manager not available');

    await db.update(projects).set({ status: 'stopping' }).where(eq(projects.id, projectId));
    const intermediate = await this.findById(projectId);
    projectsWsBroadcast('project_updated', intermediate);

    this.restartProjectAsync(projectId, project.sandboxId, manager).catch((err) => {
      console.error(`[projects] Background restart failed for ${projectId}:`, err);
    });

    return intermediate;
  }

  private async restartProjectAsync(projectId: string, sandboxId: string, manager: SandboxManager): Promise<void> {
    try { await manager.stopSandbox(sandboxId); } catch { /* may already be stopped */ }
    await db.update(projects).set({ status: 'stopped', statusError: null }).where(eq(projects.id, projectId));
    projectsWsBroadcast('project_updated', await this.findById(projectId));
    await this.startOrProvisionSandbox(projectId);
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
      gitBranch?: string;
      localDir?: string;
      agentConfig?: Record<string, unknown>;
      githubContext?: Record<string, unknown>;
      autoStartPrompt?: string;
    },
  ): Promise<Project> {
    const id = crypto.randomUUID();
    const provider = data.provider || process.env['SANDBOX_PROVIDER'] || 'daytona';

    // Normalize GitHub URLs: extract clone URL and branch from issue/PR/branch/commit URLs
    // Auto-fetch issue/PR content if the frontend didn't provide it
    let gitRepo = data.gitRepo || null;
    let gitBranch = data.gitBranch;
    let githubContext = data.githubContext || null;
    if (gitRepo) {
      const parsed = parseGitHubUrl(gitRepo);
      if (parsed) {
        gitRepo = parsed.cloneUrl;
        if (!gitBranch && parsed.ref) {
          gitBranch = parsed.ref;
        }
        if (!githubContext && (parsed.type === 'issue' || parsed.type === 'pull') && parsed.number) {
          try {
            const resolved = await githubService.resolve(data.gitRepo!);
            if (resolved.content) {
              githubContext = resolved.content as unknown as Record<string, unknown>;
              if (!gitBranch && resolved.parsed.ref) {
                gitBranch = resolved.parsed.ref;
              }
            }
          } catch (err) {
            console.warn(`[projects] Failed to fetch GitHub context: ${err}`);
          }
        }
      }
    }

    // For issue-based projects, auto-create a feature branch so agent commits
    // land on a separate branch instead of the repo's default branch.
    let createBranch: string | undefined;
    if (!gitBranch && githubContext && (githubContext as any).type === 'issue' && (githubContext as any).number && (githubContext as any).title) {
      createBranch = issueBranchName((githubContext as any).number, (githubContext as any).title);
    }

    await db.insert(projects).values({
      id,
      userId,
      name: data.name,
      description: data.description || '',
      agentType: data.agentType || 'build',
      sandboxSnapshot: data.sandboxSnapshot || process.env['DAYTONA_SNAPSHOT'] || '',
      provider,
      gitRepo,
      localDir: data.localDir || null,
      agentConfig: data.agentConfig || null,
      githubContext: (githubContext as any) || null,
      branchName: createBranch || null,
      autoStartPrompt: data.autoStartPrompt || null,
      status: 'creating',
    });
    const saved = await this.findById(id);
    projectsWsBroadcast('project_created', saved);

    this.provisionSandbox(saved.id, saved.sandboxSnapshot, saved.provider as ProviderType, saved.name, saved.gitRepo, saved.agentType, saved.localDir || undefined, gitBranch, createBranch).catch((err) => {
      console.error(`[projects] Failed to provision sandbox for project ${saved.id}:`, err);
    });

    return saved;
  }

  async update(id: string, data: Partial<Pick<typeof projects.$inferSelect, 'name' | 'description' | 'status' | 'statusError' | 'agentConfig'>>): Promise<Project> {
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

  private async triggerAutoStart(project: Project): Promise<void> {
    if (!project.autoStartPrompt || !this.autoStartHandler) return;
    try {
      const thread = await threadsService.create(project.id, {
        prompt: project.autoStartPrompt,
        agentType: 'sisyphus',
      });
      await db.update(projects).set({ autoStartPrompt: null }).where(eq(projects.id, project.id));
      projectsWsBroadcast('project_updated', await this.findById(project.id));
      this.autoStartHandler(thread.id, project.autoStartPrompt).catch((err) => {
        console.error(`[projects] Auto-start execution failed for project ${project.id}:`, err);
      });
      console.log(`[projects] Auto-started thread ${thread.id} for project ${project.id}`);
    } catch (err) {
      console.error(`[projects] Failed to auto-start for project ${project.id}:`, err);
    }
  }

  private async provisionSandbox(
    projectId: string, snapshot: string, provider: ProviderType,
    projectName?: string, gitRepo?: string | null, agentType?: string,
    localDir?: string, gitBranch?: string, createBranch?: string,
  ): Promise<void> {
    if (!(await this.ensureSandboxManager(provider))) {
      await db.update(projects).set({ status: 'stopped' }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
      return;
    }
    if (provider === 'daytona') await this.ensureDaytonaProxy();
    const manager = this.sandboxManagers.get(provider)!;
    const onStatusChange = async (status: string) => {
      await db.update(projects).set({ status }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
    };
    try {
      const sandboxId = await manager.createSandbox(
        snapshot, projectName, gitRepo || undefined, agentType, projectId, onStatusChange, localDir, gitBranch, createBranch,
      );
      await db.update(projects).set({ sandboxId, status: 'running', statusError: null }).where(eq(projects.id, projectId));
      const readyProject = await this.findById(projectId);
      projectsWsBroadcast('project_updated', readyProject);
      await this.triggerAutoStart(readyProject);
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
    if (provider === 'daytona') await this.ensureDaytonaProxy();
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
