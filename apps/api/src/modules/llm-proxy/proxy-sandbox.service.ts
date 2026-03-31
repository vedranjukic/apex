/**
 * Manages the lifecycle of a dedicated Daytona proxy sandbox that runs
 * the LLM API key proxy.  One proxy sandbox is shared across all regular
 * Daytona sandboxes in the same application instance.
 *
 * Real API keys live only inside this sandbox — regular sandboxes receive
 * an auth token that the proxy verifies before forwarding to upstream.
 */

import crypto from 'crypto';
import { settingsService } from '../settings/settings.service';
import { getLlmProxyServiceScript } from '@apex/orchestrator';
import type { SandboxProvider, SandboxInstance } from '@apex/orchestrator';

const PROXY_PORT = 3000;
const PROXY_DIR = '/home/daytona/proxy';
const HEALTH_MAX_ATTEMPTS = 30;
const HEALTH_INTERVAL_MS = 1000;
const SIGNED_URL_TTL_SECS = 8 * 60 * 60; // 8 hours

const SETTINGS_KEYS = {
  sandboxId: 'LLM_PROXY_SANDBOX_ID',
  authToken: 'LLM_PROXY_AUTH_TOKEN',
  url: 'LLM_PROXY_URL',
  keysHash: 'LLM_PROXY_KEYS_HASH',
  snapshot: 'PROXY_SANDBOX_SNAPSHOT',
} as const;

export interface ProxySandboxInfo {
  proxyBaseUrl: string;
  authToken: string;
}

function hashKeys(anthropicKey: string, openaiKey: string): string {
  return crypto
    .createHash('sha256')
    .update(`${anthropicKey}|${openaiKey}`)
    .digest('hex');
}

function generateAuthToken(): string {
  return `sk-proxy-${crypto.randomBytes(24).toString('hex')}`;
}

class ProxySandboxService {
  private cachedInfo: ProxySandboxInfo | null = null;

  /**
   * Ensure the proxy sandbox exists and is healthy.  Creates or recreates
   * the sandbox when keys change or the sandbox is stopped/destroyed.
   *
   * Returns the proxy base URL and auth token for regular sandboxes to use.
   */
  async ensureProxySandbox(
    daytonaProvider: SandboxProvider,
    anthropicKey: string,
    openaiKey: string,
  ): Promise<ProxySandboxInfo> {
    const currentHash = hashKeys(anthropicKey, openaiKey);

    const [storedId, storedHash, storedUrl, storedToken] = await Promise.all([
      settingsService.get(SETTINGS_KEYS.sandboxId),
      settingsService.get(SETTINGS_KEYS.keysHash),
      settingsService.get(SETTINGS_KEYS.url),
      settingsService.get(SETTINGS_KEYS.authToken),
    ]);

    if (storedId && storedHash === currentHash && storedUrl && storedToken) {
      const freshUrl = await this.checkHealthAndRefreshUrl(daytonaProvider, storedId);
      if (freshUrl) {
        if (freshUrl !== storedUrl) {
          await settingsService.setAll({ [SETTINGS_KEYS.url]: freshUrl });
        }
        this.cachedInfo = { proxyBaseUrl: freshUrl, authToken: storedToken };
        return this.cachedInfo;
      }
      console.log('[proxy-sandbox] Existing proxy sandbox unhealthy — recreating');
    } else if (storedId && storedHash !== currentHash) {
      console.log('[proxy-sandbox] API keys changed — recreating proxy sandbox');
    }

    if (storedId) {
      await this.destroyQuietly(daytonaProvider, storedId);
    }

    const info = await this.createProxySandbox(
      daytonaProvider, anthropicKey, openaiKey, currentHash,
    );
    this.cachedInfo = info;
    return info;
  }

  /**
   * Destroy the current proxy sandbox and clear persisted metadata.
   */
  async destroyProxySandbox(daytonaProvider: SandboxProvider): Promise<void> {
    const storedId = await settingsService.get(SETTINGS_KEYS.sandboxId);
    if (storedId) {
      await this.destroyQuietly(daytonaProvider, storedId);
    }
    await this.clearSettings();
    this.cachedInfo = null;
  }

  /** Quickly check if the cached info is still valid without a full health check. */
  getCachedInfo(): ProxySandboxInfo | null {
    return this.cachedInfo;
  }

  // ── Private helpers ─────────────────────────────────

  /**
   * Create proxy sandbox with conflict resolution and fallback naming.
   * Handles 409 name conflicts by cleaning up orphaned sandboxes or using unique names.
   */
  private async createProxySandboxWithConflictResolution(
    daytonaProvider: SandboxProvider,
    params: {
      snapshot: string;
      autoStopInterval: number;
      envVars: Record<string, string>;
      labels: Record<string, string>;
    },
  ): Promise<any> {
    let sandboxName = 'apex-llm-proxy';
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        console.log(`[proxy-sandbox] Attempting to create sandbox with name: ${sandboxName}`);
        
        return await daytonaProvider.create({
          ...params,
          name: sandboxName,
        });
      } catch (error: any) {
        attempts++;

        // Handle 409 conflict - sandbox with this name already exists
        if (error?.statusCode === 409 || error?.message?.includes('already exists')) {
          console.log(`[proxy-sandbox] Name conflict detected for '${sandboxName}' (attempt ${attempts}/${maxAttempts})`);
          
          if (attempts <= 2) {
            // First two attempts: try to find and clean orphaned proxy sandboxes
            const cleanupSuccessful = await this.cleanupOrphanedProxySandboxes(daytonaProvider, sandboxName);
            
            if (cleanupSuccessful && attempts === 1) {
              // First attempt after cleanup - retry with same name
              console.log(`[proxy-sandbox] Retrying creation with same name after cleanup`);
              continue;
            } else {
              // If cleanup failed or this is attempt 2+, switch to unique naming
              const shortId = crypto.randomUUID().slice(0, 8);
              sandboxName = `apex-llm-proxy-${shortId}`;
              console.log(`[proxy-sandbox] Switching to unique name due to persistent conflict: ${sandboxName}`);
              continue;
            }
          }
        }

        // For non-conflict errors or after max attempts, re-throw
        console.error(`[proxy-sandbox] Failed to create sandbox after ${attempts} attempts:`, error);
        throw error;
      }
    }

    throw new Error(`Failed to create proxy sandbox after ${maxAttempts} attempts`);
  }

  /**
   * Find and destroy orphaned proxy sandboxes with the target name.
   * Returns true if cleanup was attempted and may have succeeded.
   */
  private async cleanupOrphanedProxySandboxes(
    daytonaProvider: SandboxProvider,
    targetName: string,
  ): Promise<boolean> {
    try {
      console.log(`[proxy-sandbox] Searching for orphaned proxy sandboxes named '${targetName}'`);
      
      // List all sandboxes and find ones with the target name
      // Check for both labeled proxy sandboxes and legacy ones with the target name
      const allSandboxes = await daytonaProvider.list();
      const orphanedProxySandboxes = allSandboxes.filter(sandbox => 
        sandbox.name === targetName && (
          // Modern sandboxes with proper labeling
          sandbox.labels?.['apex.proxy'] === 'true' ||
          // Legacy sandboxes that might not have labels but match the proxy naming pattern
          (targetName.includes('apex-llm-proxy') && !sandbox.labels?.['apex.proxy'])
        )
      );

      if (orphanedProxySandboxes.length === 0) {
        console.log(`[proxy-sandbox] No orphaned proxy sandboxes found with name '${targetName}'`);
        return false;
      }

      console.log(`[proxy-sandbox] Found ${orphanedProxySandboxes.length} orphaned proxy sandbox(s) to clean up`);

      // Attempt to destroy each orphaned sandbox
      const destroyPromises = orphanedProxySandboxes.map(sandbox => 
        this.destroyQuietly(daytonaProvider, sandbox.id)
      );
      
      await Promise.all(destroyPromises);
      
      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log(`[proxy-sandbox] Cleanup completed for orphaned proxy sandboxes`);
      return true;
    } catch (error) {
      console.warn(`[proxy-sandbox] Failed to cleanup orphaned proxy sandboxes:`, error);
      return false; // Don't fail the entire operation due to cleanup issues
    }
  }

  private async createProxySandbox(
    daytonaProvider: SandboxProvider,
    anthropicKey: string,
    openaiKey: string,
    keysHash: string,
  ): Promise<ProxySandboxInfo> {
    const authToken = generateAuthToken();
    const snapshot = await settingsService.get(SETTINGS_KEYS.snapshot)
      || process.env['PROXY_SANDBOX_SNAPSHOT']
      || 'apex-proxy-0.1.0';

    console.log(`[proxy-sandbox] Creating proxy sandbox (snapshot=${snapshot})`);

    const sandbox = await this.createProxySandboxWithConflictResolution(daytonaProvider, {
      snapshot,
      autoStopInterval: 0,
      envVars: {
        REAL_ANTHROPIC_API_KEY: anthropicKey,
        REAL_OPENAI_API_KEY: openaiKey,
        PROXY_AUTH_TOKEN: authToken,
        PROXY_PORT: String(PROXY_PORT),
      },
      labels: { 'apex.proxy': 'true' },
    });

    try {
      await this.installAndStart(sandbox, authToken);
      const previewInfo = sandbox.getSignedPreviewUrl
        ? await sandbox.getSignedPreviewUrl(PROXY_PORT, SIGNED_URL_TTL_SECS)
        : await sandbox.getPreviewLink(PROXY_PORT);
      const proxyBaseUrl = previewInfo.url.replace(/\/$/, '');

      await this.persistSettings(sandbox.id, authToken, proxyBaseUrl, keysHash);

      console.log(`[proxy-sandbox] Proxy sandbox ready: ${sandbox.id} → ${proxyBaseUrl}`);
      return { proxyBaseUrl, authToken };
    } catch (err) {
      console.error('[proxy-sandbox] Failed to set up proxy sandbox, cleaning up:', err);
      await this.destroyQuietly(daytonaProvider, sandbox.id);
      throw err;
    }
  }

  private async installAndStart(sandbox: SandboxInstance, _authToken: string): Promise<void> {
    await sandbox.fs.createFolder(PROXY_DIR, '755');

    const script = getLlmProxyServiceScript(PROXY_PORT);
    await sandbox.fs.uploadFile(Buffer.from(script), `${PROXY_DIR}/proxy.cjs`);

    const sessionId = `proxy-${Date.now()}`;
    await sandbox.process.createSession(sessionId);
    await sandbox.process.executeSessionCommand(sessionId, {
      command: `cd ${PROXY_DIR} && node proxy.cjs > ${PROXY_DIR}/proxy.log 2>&1`,
      async: true,
    });

    await this.waitForHealth(sandbox);
  }

  private async waitForHealth(sandbox: SandboxInstance): Promise<void> {
    for (let i = 0; i < HEALTH_MAX_ATTEMPTS; i++) {
      try {
        const result = await sandbox.process.executeCommand(
          `curl -sf http://localhost:${PROXY_PORT}/health 2>&1 || echo "NOT_READY"`,
        );
        const output = (result.result ?? '').trim();
        if (output.includes('"ok"')) return;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
    }
    throw new Error('Proxy sandbox health check timed out');
  }

  private async checkHealthAndRefreshUrl(
    daytonaProvider: SandboxProvider,
    sandboxId: string,
  ): Promise<string | null> {
    try {
      const sandbox = await daytonaProvider.get(sandboxId);
      if (sandbox.state !== 'started' && sandbox.state !== 'unknown') {
        try {
          await sandbox.start(60);
        } catch {
          return null;
        }
      }
      const result = await sandbox.process.executeCommand(
        `curl -sf http://localhost:${PROXY_PORT}/health 2>&1 || echo "NOT_READY"`,
      );
      if (!(result.result ?? '').includes('"ok"')) return null;

      const previewInfo = sandbox.getSignedPreviewUrl
        ? await sandbox.getSignedPreviewUrl(PROXY_PORT, SIGNED_URL_TTL_SECS)
        : await sandbox.getPreviewLink(PROXY_PORT);
      return previewInfo.url.replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  private async destroyQuietly(
    daytonaProvider: SandboxProvider,
    sandboxId: string,
  ): Promise<void> {
    try {
      const sandbox = await daytonaProvider.get(sandboxId);
      await sandbox.delete();
      console.log(`[proxy-sandbox] Deleted proxy sandbox ${sandboxId}`);
    } catch (err: any) {
      // Don't warn for already-deleted sandboxes
      if (err?.statusCode === 404 || err?.message?.includes('not found')) {
        console.log(`[proxy-sandbox] Sandbox ${sandboxId} already deleted or not found`);
      } else {
        console.warn(`[proxy-sandbox] Failed to delete sandbox ${sandboxId}:`, err);
      }
    }
  }

  private async persistSettings(
    sandboxId: string,
    authToken: string,
    url: string,
    keysHash: string,
  ): Promise<void> {
    await settingsService.setAll({
      [SETTINGS_KEYS.sandboxId]: sandboxId,
      [SETTINGS_KEYS.authToken]: authToken,
      [SETTINGS_KEYS.url]: url,
      [SETTINGS_KEYS.keysHash]: keysHash,
    });
  }

  private async clearSettings(): Promise<void> {
    await settingsService.setAll({
      [SETTINGS_KEYS.sandboxId]: '',
      [SETTINGS_KEYS.authToken]: '',
      [SETTINGS_KEYS.url]: '',
      [SETTINGS_KEYS.keysHash]: '',
    });
  }
}

export const proxySandboxService = new ProxySandboxService();
