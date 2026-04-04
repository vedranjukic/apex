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
import { secretsService } from '../secrets/secrets.service';
import { getCACertPem, getCAKeyPem } from '../secrets-proxy/ca-manager';
import { getCombinedProxyServiceScript } from '@apex/orchestrator';
import type { SandboxProvider, SandboxInstance } from '@apex/orchestrator';

const PROXY_PORT = 3000;
const MITM_PORT = 9340;
const PORT_RELAY_PORT = 9341;
const PROXY_DIR = '/home/daytona/proxy';
const HEALTH_MAX_ATTEMPTS = 30;
const HEALTH_INTERVAL_MS = 1000;
const SIGNED_URL_TTL_SECS = 86_400; // 24 hours (Daytona max)

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

// Bump this when the combined proxy service script changes to force recreation
const PROXY_SCRIPT_VERSION = '5';

function hashKeys(anthropicKey: string, openaiKey: string): string {
  return crypto
    .createHash('sha256')
    .update(`${PROXY_SCRIPT_VERSION}|${anthropicKey}|${openaiKey}`)
    .digest('hex');
}

function generateAuthToken(): string {
  return `sk-proxy-${crypto.randomBytes(24).toString('hex')}`;
}

class ProxySandboxService {
  private cachedInfo: ProxySandboxInfo | null = null;
  private ensureInFlight: Promise<ProxySandboxInfo> | null = null;

  /**
   * Ensure the proxy sandbox exists and is healthy.  Creates or recreates
   * the sandbox when keys change or the sandbox is stopped/destroyed.
   *
   * Returns the proxy base URL and auth token for regular sandboxes to use.
   * Serialized: concurrent callers wait for the same in-flight operation.
   */
  async ensureProxySandbox(
    daytonaProvider: SandboxProvider,
    anthropicKey: string,
    openaiKey: string,
  ): Promise<ProxySandboxInfo> {
    if (this.ensureInFlight) return this.ensureInFlight;
    this.ensureInFlight = this.doEnsureProxySandbox(daytonaProvider, anthropicKey, openaiKey)
      .finally(() => { this.ensureInFlight = null; });
    return this.ensureInFlight;
  }

  private async doEnsureProxySandbox(
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

    let needsRecreate = false;
    let recreateReason = '';

    if (storedId && storedHash === currentHash && storedUrl && storedToken) {
      const freshUrl = await this.checkHealthAndRefreshUrl(daytonaProvider, storedId, storedUrl);
      if (freshUrl) {
        if (freshUrl !== storedUrl) {
          await settingsService.setAll({ [SETTINGS_KEYS.url]: freshUrl });
        }
        this.cachedInfo = { proxyBaseUrl: freshUrl, authToken: storedToken };
        return this.cachedInfo;
      }
      needsRecreate = true;
      recreateReason = 'Existing proxy sandbox unhealthy';
    } else if (storedId && storedHash !== currentHash) {
      needsRecreate = true;
      recreateReason = 'API keys changed';
    } else if (!storedId) {
      needsRecreate = true;
      recreateReason = 'No proxy sandbox configured';
    }

    if (needsRecreate) {
      console.log(`[proxy-sandbox] ${recreateReason} — creating new proxy sandbox`);
    }

    const info = await this.createProxySandbox(
      daytonaProvider, anthropicKey, openaiKey, currentHash,
    );

    if (storedId) {
      console.log(`[proxy-sandbox] New proxy ready, destroying old proxy ${storedId.slice(0, 8)}`);
      await this.destroyQuietly(daytonaProvider, storedId);
    }

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
   * Create proxy sandbox with conflict resolution.
   * On 409 name conflict, falls back to a unique name rather than deleting
   * sandboxes that may belong to another app instance.
   */
  private async createProxySandboxWithConflictResolution(
    daytonaProvider: SandboxProvider,
    params: {
      snapshot: string;
      autoStopInterval: number;
      autoDeleteInterval?: number;
      autoArchiveInterval?: number;
      envVars: Record<string, string>;
      labels: Record<string, string>;
    },
  ): Promise<any> {
    const canonicalName = 'apex-llm-proxy';
    try {
      console.log(`[proxy-sandbox] Attempting to create sandbox with name: ${canonicalName}`);
      return await daytonaProvider.create({ ...params, name: canonicalName });
    } catch (error: any) {
      if (error?.statusCode === 409 || error?.message?.includes('already exists')) {
        const shortId = crypto.randomUUID().slice(0, 8);
        const uniqueName = `apex-llm-proxy-${shortId}`;
        console.log(`[proxy-sandbox] Name '${canonicalName}' already taken, using unique name: ${uniqueName}`);
        return await daytonaProvider.create({ ...params, name: uniqueName });
      }
      throw error;
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

    console.log(`[proxy-sandbox] Creating combined proxy sandbox (snapshot=${snapshot})`);

    // Get all secrets for MITM proxy
    const allSecrets = await secretsService.findAll();
    const secretsJson = JSON.stringify(allSecrets.map(secret => ({
      id: secret.id,
      name: secret.name,
      value: secret.value,
      domain: secret.domain,
      authType: secret.authType || 'bearer'
    })));

    // Get GitHub token if available
    const githubToken = await settingsService.get('GITHUB_TOKEN') || '';

    // Get CA certificate and key (will be generated if not exists)
    let caCertPem = '';
    let caKeyPem = '';
    try {
      caCertPem = getCACertPem();
      caKeyPem = getCAKeyPem();
    } catch (err) {
      console.warn('[proxy-sandbox] CA certificate not available:', err);
    }

    const sandbox = await this.createProxySandboxWithConflictResolution(daytonaProvider, {
      snapshot,
      autoStopInterval: 0,
      autoDeleteInterval: -1,
      autoArchiveInterval: 0,
      envVars: {
        REAL_ANTHROPIC_API_KEY: anthropicKey,
        REAL_OPENAI_API_KEY: openaiKey,
        PROXY_AUTH_TOKEN: authToken,
        PROXY_PORT: String(PROXY_PORT),
        MITM_PROXY_PORT: String(MITM_PORT),
        PORT_RELAY_PORT: String(PORT_RELAY_PORT),
        SECRETS_JSON: secretsJson,
        GITHUB_TOKEN: githubToken,
        CA_CERT_PEM: caCertPem,
        CA_KEY_PEM: caKeyPem,
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

    await sandbox.process.executeCommand(
      `cd ${PROXY_DIR} && npm init -y && npm install ws node-forge`
    );

    const script = getCombinedProxyServiceScript(PROXY_PORT, MITM_PORT, PORT_RELAY_PORT);
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

  private urlRefreshedAt = 0;

  private async checkHealthAndRefreshUrl(
    daytonaProvider: SandboxProvider,
    sandboxId: string,
    storedUrl?: string,
  ): Promise<string | null> {
    try {
      const sandbox = await daytonaProvider.get(sandboxId);
      if (sandbox.state !== 'started' && sandbox.state !== 'unknown') {
        try {
          await sandbox.start(60);
        } catch (startErr) {
          console.warn(`[proxy-sandbox] Failed to start proxy sandbox ${sandboxId.slice(0, 8)}:`, startErr);
          return null;
        }
      }
      const result = await sandbox.process.executeCommand(
        `curl -sf http://localhost:${PROXY_PORT}/health 2>&1 || echo "NOT_READY"`,
      );
      if (!(result.result ?? '').includes('"ok"')) return null;

      // Only generate a new signed URL if we don't have one or it's older than
      // half the TTL. Generating new signed URLs on every health check causes
      // URL rotation that breaks tunnel connections in running sandboxes.
      const urlAge = Date.now() - this.urlRefreshedAt;
      const needsRefresh = !storedUrl || urlAge > (SIGNED_URL_TTL_SECS * 1000 / 2);
      if (needsRefresh) {
        const previewInfo = sandbox.getSignedPreviewUrl
          ? await sandbox.getSignedPreviewUrl(PROXY_PORT, SIGNED_URL_TTL_SECS)
          : await sandbox.getPreviewLink(PROXY_PORT);
        this.urlRefreshedAt = Date.now();
        return previewInfo.url.replace(/\/$/, '');
      }
      return storedUrl;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      const isGone = /not found|does not exist/i.test(msg)
        || err?.statusCode === 404
        || err?.name === 'DaytonaNotFoundError';
      if (isGone) {
        console.log(`[proxy-sandbox] Proxy sandbox ${sandboxId.slice(0, 8)} no longer exists`);
        return null;
      }
      // Transient error (network, rate limit, etc.) — keep the existing proxy
      // rather than destroying it and risking a recreation failure
      console.warn(`[proxy-sandbox] Transient health check error for ${sandboxId.slice(0, 8)}, keeping existing proxy:`, msg);
      return storedUrl || null;
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
