import { eq, or, isNull, isNotNull, and, asc, desc, sql, inArray } from 'drizzle-orm';
import { execFile as execFileCb } from 'child_process';
import { db } from '../../database/db';
import { projects, tasks } from '../../database/schema';
import { SandboxManager } from '@apex/orchestrator';
import { parseGitHubUrl, issueBranchName, IMergeStatusData } from '@apex/shared';
import { githubService } from '../github/github.service';
import { projectsWsBroadcast } from './projects.ws';
import { getCACertPem } from '../secrets-proxy/ca-manager';
import { getSecretsProxyPort } from '../secrets-proxy/secrets-proxy';
import { secretsService } from '../secrets/secrets.service';
import { settingsService } from '../settings/settings.service';
import { threadsService } from '../tasks/tasks.service';
import { proxySandboxService } from '../llm-proxy/proxy-sandbox.service';
import { proxyProjectsService } from '../llm-proxy/proxy-projects.service';
import type { ProjectSyncPayload } from '../llm-proxy/proxy-projects.service';
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
  private currentSecretPlaceholders: Record<string, string> = {};
  private currentEnvironmentVariables: Record<string, string> = {};
  private secretsCache = new Map<string, { envVars: Record<string, string>; secrets: string[]; timestamp: number }>();
  private readonly SECRETS_CACHE_TTL = 60000; // 1 minute cache TTL
  async init() {
    await this.recoverStaleCreatingProjects();
    await this.initSandboxManagers();
    // Pre-warm bridge connections (non-destructive -- no session clearing)
    if (this.sandboxManagers.has('daytona')) {
      this.initDaytonaBridgeConnections().catch((err) => {
        console.warn('[projects] Bridge reconnection failed (non-fatal):', err);
      });
    }
  }

  /**
   * On startup, any project stuck in 'creating' or 'starting' has no
   * in-flight promise to finish the job.  Mark them as errors so the
   * user can retry instead of staring at a spinner forever.
   */
  private async recoverStaleCreatingProjects(): Promise<void> {
    try {
      const stale = await db.query.projects.findMany({
        where: and(
          isNull(projects.deletedAt),
          inArray(projects.status, ['creating', 'starting']),
        ),
      });
      if (stale.length === 0) return;
      console.log(`[projects] Recovering ${stale.length} project(s) stuck in creating/starting`);
      for (const p of stale) {
        await db.update(projects).set({
          status: 'error',
          statusError: 'Server restarted while sandbox was being provisioned. Click start to retry.',
        }).where(eq(projects.id, p.id));
        projectsWsBroadcast('project_updated', await this.findById(p.id));
        console.log(`[projects]   → ${p.name} (${p.id}): creating → error`);
      }
    } catch (err) {
      console.warn('[projects] Failed to recover stale creating projects:', err);
    }
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
          if (!hasKey) {
            statuses.push({ type, available: false, reason: 'DAYTONA_API_KEY not configured' });
          } else {
            // Quick authentication validation to fail fast on invalid keys
            try {
              const daytonaProvider = new DaytonaSandboxProvider();
              await daytonaProvider.initialize();
              await daytonaProvider.validateAuthentication();
              statuses.push({ type, available: true });
            } catch (err: any) {
              const errorMessage = err?.message?.includes('authentication failed') 
                ? 'Invalid DAYTONA_API_KEY'
                : `Daytona API error: ${err.message || 'Unknown error'}`;
              statuses.push({ type, available: false, reason: errorMessage });
            }
          }
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
    const environmentVariables: Record<string, string> = {};
    let secretDomains: string[] = [];
    try {
      const domains = await secretsService.getSecretDomains();
      secretDomains = [...domains];
      if (domains.size > 0) {
        // Get all items and separate secrets from environment variables
        const allSecrets = await secretsService.findAll();
        for (const s of allSecrets) {
          // For backward compatibility with existing tests, always add placeholders
          // but distinguish between secrets and environment variables in storage
          secretPlaceholders[s.name] = 'sk-proxy-placeholder';
          
          if (!s.isSecret) {
            // Store environment variables with their actual values for direct injection
            environmentVariables[s.name] = s.value;
          }
        }
      }
    } catch { /* secrets table may not exist yet */ }
    
    // Store for use in getContextSecrets
    this.currentSecretPlaceholders = secretPlaceholders;
    this.currentEnvironmentVariables = environmentVariables;
    
    // Pre-populate cache for all known repositories to avoid empty values during startup
    // Skip during e2e tests to avoid potential async issues
    if (process.env.APEX_E2E_TEST !== '1') {
      this.prePopulateRepositoryCaches().catch(err => {
        console.warn('[projects] Failed to pre-populate repository caches:', err);
      });
    }

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
      secretDomains,
      getContextSecrets: (projectId?: string, repositoryId?: string) => {
        return this.getContextSecrets(projectId, repositoryId);
      },
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
                
                // Fast validation of Daytona API key before attempting proxy sandbox creation
                console.log(`[proxy-sandbox] Validating Daytona API key...`);
                await daytonaProvider.validateAuthentication();
                console.log(`[proxy-sandbox] Daytona API key validation successful`);
                
                // Add timeout to prevent hanging during server startup
                const timeoutPromise = new Promise<never>((_, reject) => {
                  setTimeout(() => reject(new Error('Proxy sandbox creation timeout (30s)')), 30000);
                });
                
                const proxyInfo = await Promise.race([
                  proxySandboxService.ensureProxySandbox(daytonaProvider, anthropicKey, openaiKey),
                  timeoutPromise
                ]);
                
                providerConfig.proxyBaseUrl = proxyInfo.proxyBaseUrl;
                providerConfig.proxyAuthToken = proxyInfo.authToken;
                console.log(`[projects] Daytona LLM proxy sandbox ready: ${proxyInfo.proxyBaseUrl}`);
                if (proxyInfo.projectsApiUrl) {
                  console.log(`[projects] 📱 Mobile dashboard: ${proxyInfo.projectsApiUrl}/app`);
                }

                this.syncExistingDaytonaProjects().catch((err) => {
                  console.warn('[projects] Initial proxy project sync failed (non-fatal):', err);
                });
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

  async updateSecretDomainsOnManagers() {
    try {
      const domains = [...(await secretsService.getSecretDomains())];
      for (const [, mgr] of this.sandboxManagers) {
        mgr.updateSecretDomains(domains);
      }
      console.log(`[projects] Updated secret domains on managers (${domains.length} domains)`);
    } catch (err) {
      console.error('[projects] Failed to update secret domains:', err);
    }
  }

  /**
   * Update secrets cache and notify sandbox managers of context-specific changes.
   */
  async updateContextSecretsOnManagers(projectId?: string, repositoryId?: string) {
    try {
      // Clear the cache to force refresh
      this.clearSecretsCache(projectId, repositoryId);
      
      // Update sandbox managers with new context secrets
      for (const [, mgr] of this.sandboxManagers) {
        mgr.updateContextSecrets(projectId, repositoryId);
      }
      
      console.log(`[projects] Updated context secrets for project=${projectId} repository=${repositoryId}`);
    } catch (err) {
      console.error('[projects] Failed to update context secrets:', err);
    }
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
       
       // Fast validation of Daytona API key before attempting proxy sandbox operations
       await daytonaProvider.validateAuthentication();
       
       // Add timeout to prevent hanging during proxy sandbox updates
       const timeoutPromise = new Promise<never>((_, reject) => {
         setTimeout(() => reject(new Error('Proxy sandbox update timeout (30s)')), 30000);
       });
       
       const info = await Promise.race([
         proxySandboxService.ensureProxySandbox(daytonaProvider, anthropicKey, openaiKey),
         timeoutPromise
       ]);
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

    // If we already checked this provider and it was unavailable, skip the
    // expensive full reinit — it won't change the outcome.
    if (provider && this.providerStatuses.length > 0) {
      const status = this.providerStatuses.find((s) => s.type === provider);
      if (status && !status.available) return false;
    }

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
      if (SandboxManager.isSandboxNotFoundError(err)) {
        const errMsg = `Sandbox ${project.sandboxId?.slice(0, 8)} no longer exists or is unavailable`;
        console.error(`[projects] ${errMsg} for project ${projectId}`);
        await db.update(projects).set({ status: 'error', statusError: errMsg }).where(eq(projects.id, projectId));
        const updated = await this.findById(projectId);
        projectsWsBroadcast('project_updated', updated);
        return updated;
      }
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
      await this.provisionSandbox(projectId, project.sandboxSnapshot, project.provider as ProviderType, project.name, project.gitRepo, project.agentType, project.localDir || undefined, undefined, undefined, project.sandboxConfig);
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

  /**
   * Extract repository ID from git repository URL.
   * Returns owner/repo format for GitHub URLs, null otherwise.
   */
  private getRepositoryIdFromGitUrl(gitRepo?: string | null): string | undefined {
    if (!gitRepo) return undefined;
    
    const parsed = parseGitHubUrl(gitRepo);
    return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
  }

  /**
   * Get context-specific secrets and environment variables for a project/repository.
   * Separates environment variables (direct injection) from secrets (MITM proxy).
   * Uses caching to provide synchronous access to async secret resolution.
   */
  private getContextSecrets(projectId?: string, repositoryId?: string): {
    envVars: Record<string, string>;
    secrets: string[];
  } {
    const cacheKey = `${projectId || 'global'}:${repositoryId || 'none'}`;
    const cached = this.secretsCache.get(cacheKey);
    
    // Return cached value if still valid
    if (cached && (Date.now() - cached.timestamp) < this.SECRETS_CACHE_TTL) {
      return { envVars: cached.envVars, secrets: cached.secrets };
    }
    
    // Basic implementation with async cache refresh
    const envVars: Record<string, string> = { ...this.currentEnvironmentVariables };
    const secrets: string[] = [];
    
    // Only placeholders (actual secrets) are treated as secrets
    for (const secretName of Object.keys(this.currentSecretPlaceholders || {})) {
      secrets.push(secretName);
    }
    
    const result = { envVars, secrets };
    
    // Store in cache
    this.secretsCache.set(cacheKey, {
      ...result,
      timestamp: Date.now()
    });
    
    // Async refresh for next time (fire and forget)
    this.refreshSecretsCache(projectId, repositoryId, cacheKey).catch(err => {
      console.warn('[projects] Failed to refresh secrets cache:', err);
    });
    
    return result;
  }

  /**
   * Pre-populate cache for all known repositories during initialization.
   */
  private async prePopulateRepositoryCaches(): Promise<void> {
    try {
      const userId = '00000000-0000-0000-0000-000000000001';
      
      // Get all unique repository IDs from secrets
      const allSecrets = await secretsService.findAll();
      const repositoryIds = new Set<string>();
      
      for (const secret of allSecrets) {
        if (secret.repositoryId) {
          repositoryIds.add(secret.repositoryId);
        }
      }
      
      // Pre-populate cache for each repository
      for (const repositoryId of repositoryIds) {
        await this.refreshSecretsCache(undefined, repositoryId, `global:${repositoryId}`);
      }
    } catch (error) {
      console.warn('[projects] Failed to pre-populate repository caches:', error);
    }
  }

  /**
   * Asynchronously refresh secrets cache for a specific context.
   */
  private async refreshSecretsCache(projectId?: string, repositoryId?: string, cacheKey?: string): Promise<void> {
    try {
      // For now, use a hardcoded user ID. In production, this should be passed through the context
      const userId = '00000000-0000-0000-0000-000000000001';
      
      // Use the new repository-based resolution
      const resolvedSecrets = await secretsService.resolveForContext(userId, projectId, repositoryId);
      const envVars: Record<string, string> = {};
      const secrets: string[] = [];
      
      for (const secret of resolvedSecrets) {
        if (secret.isSecret) {
          // This is a secret that needs MITM proxy
          secrets.push(secret.name);
        } else {
          // This is an environment variable that gets directly injected
          envVars[secret.name] = secret.value;
        }
      }
      
      const result = { envVars, secrets };
      const key = cacheKey || `${projectId || 'global'}:${repositoryId || 'none'}`;
      
      this.secretsCache.set(key, {
        ...result,
        timestamp: Date.now()
      });
      

    } catch (error) {
      console.warn('[projects] Failed to refresh secrets cache:', error);
    }
  }

  /**
   * Clear secrets cache for a specific context or all contexts.
   */
  public clearSecretsCache(projectId?: string, repositoryId?: string): void {
    if (projectId || repositoryId) {
      const cacheKey = `${projectId || 'global'}:${repositoryId || 'none'}`;
      this.secretsCache.delete(cacheKey);
      console.log(`[projects] Cleared secrets cache for ${cacheKey}`);
    } else {
      this.secretsCache.clear();
      console.log('[projects] Cleared all secrets cache');
    }
  }

  private async stopProjectAsync(projectId: string, sandboxId: string, manager: SandboxManager): Promise<void> {
    try {
      await manager.stopSandbox(sandboxId);
      await db.update(projects).set({ status: 'stopped', statusError: null }).where(eq(projects.id, projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(projects).set({ status: 'error', statusError: message }).where(eq(projects.id, projectId));
    }
    const updated = await this.findById(projectId);
    projectsWsBroadcast('project_updated', updated);
    this.syncToProxy(updated);
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
      sandboxConfig?: {
        customImage?: string;
        environmentVariables?: Record<string, string>;
        memoryMB?: number;
        cpus?: number;
        diskGB?: number;
      };
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
      sandboxConfig: data.sandboxConfig || null,
      status: 'creating',
    });
    const saved = await this.findById(id);
    projectsWsBroadcast('project_created', saved);
    this.syncToProxy(saved);

    this.provisionSandbox(saved.id, saved.sandboxSnapshot, saved.provider as ProviderType, saved.name, saved.gitRepo, saved.agentType, saved.localDir || undefined, gitBranch, createBranch, saved.sandboxConfig).catch((err) => {
      console.error(`[projects] Failed to provision sandbox for project ${saved.id}:`, err);
    });

    return saved;
  }

  async update(id: string, data: Partial<Pick<typeof projects.$inferSelect, 'name' | 'description' | 'status' | 'statusError' | 'agentConfig' | 'mergeStatus'>>): Promise<Project> {
    await db.update(projects).set({ ...data, updatedAt: new Date().toISOString() } as any).where(eq(projects.id, id));
    const updated = await this.findById(id);
    projectsWsBroadcast('project_updated', updated);
    this.syncToProxy(updated);
    return updated;
  }

  async updateMergeStatus(id: string, mergeStatus: IMergeStatusData | null): Promise<Project> {
    await db.update(projects).set({ 
      mergeStatus: mergeStatus as any, 
      updatedAt: new Date().toISOString() 
    }).where(eq(projects.id, id));
    const updated = await this.findById(id);
    projectsWsBroadcast('project_updated', updated);
    return updated;
  }

  async refreshMergeStatusFromGitHub(id: string): Promise<Project> {
    const project = await this.findById(id);
    
    try {
      const mergeStatus = await githubService.getProjectMergeStatus({
        repoUrl: project.gitRepo,
        issueUrl: project.githubContext?.url,
        branchName: project.branchName || undefined,
      });
      
      return await this.updateMergeStatus(id, mergeStatus);
    } catch (error) {
      console.log(`[projects] Failed to refresh merge status for project ${id}: ${error instanceof Error ? error.message : error}`);
      // Don't throw error, just return current project state
      return project;
    }
  }

  async batchRefreshMergeStatus(projectIds?: string[]): Promise<Array<{ projectId: string; success: boolean; error?: string }>> {
    let targetProjects: Project[];
    
    if (projectIds) {
      targetProjects = await Promise.all(projectIds.map(id => this.findById(id)));
    } else {
      // Get all projects that have GitHub URLs
      const allProjects = await db.query.projects.findMany({
        where: isNull(projects.deletedAt),
      });
      targetProjects = allProjects.filter(p => p.gitRepo || p.githubContext?.url);
    }

    if (targetProjects.length === 0) {
      return [];
    }

    const projectData = targetProjects.map(p => ({
      id: p.id,
      repoUrl: p.gitRepo,
      issueUrl: p.githubContext?.url,
      branchName: p.branchName || undefined,
    }));

    const results = await githubService.batchCheckMergeStatus(projectData);
    const updateResults: Array<{ projectId: string; success: boolean; error?: string }> = [];

    for (const result of results) {
      try {
        if (result.mergeStatus) {
          await this.updateMergeStatus(result.projectId, result.mergeStatus);
        }
        updateResults.push({ projectId: result.projectId, success: true });
      } catch (error) {
        updateResults.push({ 
          projectId: result.projectId, 
          success: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return updateResults;
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
    this.removeFromProxy(id, project.provider);

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
    this.syncToProxy(saved);

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
    const mgr = this.sandboxManagers.get(project.provider);
    if (!mgr) {
      console.warn(`[projects] No sandbox manager for provider "${project.provider}" — available: [${[...this.sandboxManagers.keys()].join(', ')}]`);
    }
    return mgr ?? null;
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

  private async toSyncPayload(project: Project): Promise<ProjectSyncPayload> {
    let bridgeUrl: string | null = null;
    let bridgeToken: string | null = null;
    if (project.sandboxId && project.provider === 'daytona') {
      const mgr = this.sandboxManagers.get('daytona');
      if (mgr) {
        const cached = mgr.getBridgeInfo(project.sandboxId);
        if (cached) {
          bridgeUrl = cached.previewUrl;
          bridgeToken = cached.previewToken;
        } else if (project.status === 'running') {
          try {
            const fetched = await mgr.fetchBridgePreviewUrl(project.sandboxId);
            if (fetched) {
              bridgeUrl = fetched.url;
              bridgeToken = fetched.token;
            }
          } catch { /* non-fatal */ }
        }
      }
    }

    // Ensure the sandbox .env has the current proxy URL so OpenCode can reach the LLM proxy
    const proxyInfo = proxySandboxService.getCachedInfo();
    if (project.sandboxId && project.provider === 'daytona' && project.status === 'running' && proxyInfo?.proxyBaseUrl) {
      this.ensureSandboxProxyEnv(project.sandboxId, proxyInfo.proxyBaseUrl, proxyInfo.authToken).catch(() => {});
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      gitRepo: project.gitRepo,
      sandboxId: project.sandboxId,
      bridgeUrl,
      bridgeToken,
      proxyBaseUrl: proxyInfo?.proxyBaseUrl || null,
      proxyAuthToken: proxyInfo?.authToken || null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  /**
   * Pre-warm bridge connections for all running Daytona sandboxes.
   * Non-destructive: does NOT clear OpenCode sessions or kill processes.
   * Just reconnects the bridge WebSocket and syncs bridge URLs to the proxy.
   */
  private async initDaytonaBridgeConnections(): Promise<void> {
    const mgr = this.sandboxManagers.get('daytona');
    if (!mgr) return;
    const allProjects = await db.query.projects.findMany({
      where: and(eq(projects.provider, 'daytona'), isNull(projects.deletedAt)),
    });
    const running = allProjects.filter((p) => p.status === 'running' && p.sandboxId);
    if (running.length === 0) return;
    console.log(`[projects] Pre-warming ${running.length} Daytona bridge connection(s)`);
    for (const p of running) {
      try {
        mgr.registerProjectId(p.sandboxId!, p.id);
        await mgr.reconnectSandbox(p.sandboxId!, p.name);
        const payload = await this.toSyncPayload(p as Project);
        if (payload.bridgeUrl) {
          await proxyProjectsService.syncProject(payload);
        }
      } catch (err) {
        console.warn(`[projects] Bridge connect failed for ${p.sandboxId?.slice(0, 8)} (non-fatal):`, (err as Error).message);
      }
    }
    console.log(`[projects] Bridge pre-warm complete`);
  }

  private proxyEnvUpdated = new Set<string>();

  private async ensureSandboxProxyEnv(sandboxId: string, proxyBaseUrl: string, authToken: string): Promise<void> {
    if (this.proxyEnvUpdated.has(sandboxId)) return;
    const mgr = this.sandboxManagers.get('daytona');
    if (!mgr) return;
    try {
      const envUpdates = [
        `ANTHROPIC_BASE_URL=${proxyBaseUrl}/llm-proxy/anthropic/v1`,
        `OPENAI_BASE_URL=${proxyBaseUrl}/llm-proxy/openai/v1`,
        `APEX_PROXY_BASE_URL=${proxyBaseUrl}`,
        `ANTHROPIC_API_KEY=${authToken}`,
        `OPENAI_API_KEY=${authToken}`,
      ];
      const cmd = envUpdates.map((line) => {
        const [key] = line.split('=');
        return `grep -q "^${key}=" /home/daytona/project/.env 2>/dev/null && sed -i "s|^${key}=.*|${line}|" /home/daytona/project/.env || echo "${line}" >> /home/daytona/project/.env`;
      }).join(' && ');
      const sandbox = await (mgr as any).ensureSandbox(sandboxId);
      await sandbox.process.executeCommand(cmd);
      this.proxyEnvUpdated.add(sandboxId);
      console.log(`[projects] Updated .env proxy URLs in sandbox ${sandboxId.slice(0, 8)}`);
    } catch (err) {
      // Non-fatal -- the bridge update_proxy_url will handle it for new bridges
    }
  }

  private syncToProxy(project: Project): void {
    if (project.provider !== 'daytona') return;
    this.toSyncPayload(project).then((payload) => {
      proxyProjectsService.syncProject(payload).catch(() => {});
    }).catch(() => {});
  }

  /**
   * Push all existing Daytona projects and their threads to the proxy
   * registry on startup. Ensures data created before this feature was
   * added is visible on the mobile dashboard.
   */
  private async syncExistingDaytonaProjects(): Promise<void> {
    const allProjects = await db.query.projects.findMany({
      where: and(eq(projects.provider, 'daytona'), isNull(projects.deletedAt)),
    });
    if (allProjects.length === 0) return;
    console.log(`[projects] Syncing ${allProjects.length} existing Daytona project(s) to proxy registry`);
    for (const p of allProjects) {
      const payload = await this.toSyncPayload(p as Project);
      await proxyProjectsService.syncProject(payload);
    }

    const projectIds = allProjects.map((p) => p.id);
    const allThreads = await db.query.tasks.findMany({
      where: sql`${tasks.projectId} IN (${sql.join(projectIds.map((id) => sql`${id}`), sql`, `)})`,
    });
    if (allThreads.length > 0) {
      console.log(`[projects] Syncing ${allThreads.length} thread(s) to proxy registry`);
      for (const t of allThreads) {
        await proxyProjectsService.syncThread({
          id: t.id,
          projectId: t.projectId,
          title: t.title,
          status: t.status,
          agentType: t.agentType,
          model: t.model,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        });
      }

      const completedThreads = allThreads.filter(
        (t) => t.status === 'completed' || t.status === 'error',
      );
      if (completedThreads.length > 0) {
        console.log(`[projects] Syncing messages for ${completedThreads.length} completed thread(s)`);
        for (const t of completedThreads) {
          const msgs = await threadsService.getMessages(t.id);
          if (msgs.length > 0) {
            await proxyProjectsService.syncMessages(t.id, msgs.map((m) => ({
              id: m.id,
              taskId: m.taskId,
              role: m.role,
              content: m.content as unknown[],
              metadata: m.metadata,
              createdAt: m.createdAt,
            })));
          }
        }
      }
    }

    console.log(`[projects] Initial proxy sync complete`);
  }

  private removeFromProxy(projectId: string, provider: string): void {
    if (provider !== 'daytona') return;
    proxyProjectsService.removeProject(projectId).catch(() => {});
  }

  private async provisionSandbox(
    projectId: string, snapshot: string, provider: ProviderType,
    projectName?: string, gitRepo?: string | null, agentType?: string,
    localDir?: string, gitBranch?: string, createBranch?: string,
    sandboxConfig?: { customImage?: string; environmentVariables?: Record<string, string>; memoryMB?: number; cpus?: number; diskGB?: number; } | null,
  ): Promise<void> {
    try {
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
      const repositoryId = this.getRepositoryIdFromGitUrl(gitRepo);
      const sandboxId = await manager.createSandbox(
        snapshot, projectName, gitRepo || undefined, agentType, projectId, onStatusChange, localDir, gitBranch, createBranch, sandboxConfig, repositoryId,
      );
      await db.update(projects).set({ sandboxId, status: 'running', statusError: null }).where(eq(projects.id, projectId));
      const readyProject = await this.findById(projectId);
      projectsWsBroadcast('project_updated', readyProject);
      this.syncToProxy(readyProject);
      await this.triggerAutoStart(readyProject);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[projects] provisionSandbox failed for ${projectId}:`, message);
      try {
        await db.update(projects).set({ status: 'error', statusError: message }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
      } catch (dbErr) {
        console.error(`[projects] Failed to persist error status for ${projectId}:`, dbErr);
      }
      throw err;
    }
  }

  private async provisionFork(
    projectId: string, provider: ProviderType, sourceSandboxId: string,
    branchName: string, projectName?: string,
  ): Promise<void> {
    try {
      if (!(await this.ensureSandboxManager(provider))) {
        await db.update(projects).set({ status: 'stopped' }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
        return;
      }
      if (provider === 'daytona') await this.ensureDaytonaProxy();
      const manager = this.sandboxManagers.get(provider)!;
      const sandboxId = await manager.forkSandbox(sourceSandboxId, branchName, projectName);
      await db.update(projects).set({ sandboxId, status: 'running', statusError: null }).where(eq(projects.id, projectId));
      projectsWsBroadcast('project_updated', await this.findById(projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[projects] provisionFork failed for ${projectId}:`, message);
      try {
        await db.update(projects).set({ status: 'error', statusError: message }).where(eq(projects.id, projectId));
        projectsWsBroadcast('project_updated', await this.findById(projectId));
      } catch (dbErr) {
        console.error(`[projects] Failed to persist error status for ${projectId}:`, dbErr);
      }
      throw err;
    }
  }
}

export const projectsService = new ProjectsService();
