/**
 * Daytona sandbox provider — wraps the @daytonaio/sdk.
 *
 * All SDK calls go through a shared concurrency limiter so we never
 * burst more than {@link MAX_CONCURRENT} requests to the Daytona API
 * at once. This prevents 502 / 429 errors from rate-limit hits.
 */

import { Daytona, Sandbox } from "@daytonaio/sdk";
import type {
  SandboxProvider,
  SandboxProviderConfig,
  SandboxInstance,
  SandboxState,
  CreateSandboxParams,
  SandboxFileSystem,
  SandboxProcess,
  SandboxGit,
  PreviewInfo,
  SshAccessInfo,
  ExecuteCommandResult,
  SessionCommandOpts,
} from "./types.js";

// ── Concurrency limiter ──────────────────────────────

const MAX_CONCURRENT = 3;
const MIN_INTERVAL_MS = 150;

class ApiLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  private lastCallTime = 0;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running++;
      return this.waitMinInterval();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        this.waitMinInterval().then(resolve);
      });
    });
  }

  private async waitMinInterval(): Promise<void> {
    const elapsed = Date.now() - this.lastCallTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    this.lastCallTime = Date.now();
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const limiter = new ApiLimiter();

// ── SandboxInstance wrapper around Daytona Sandbox ───

class DaytonaSandboxInstance implements SandboxInstance {
  readonly id: string;

  constructor(private readonly sandbox: Sandbox) {
    this.id = sandbox.id;
  }

  get name(): string | undefined {
    return (this.sandbox as any).name;
  }

  get labels(): Record<string, string> | undefined {
    return (this.sandbox as any).labels;
  }

  get state(): SandboxState {
    return ((this.sandbox as any).state as SandboxState) ?? "unknown";
  }

  set state(_v: SandboxState) {
    // read-only from the outside — state is driven by the SDK
  }

  // ── Lifecycle ─────────────────────────────────────

  async start(timeoutSecs = 60): Promise<void> {
    // The SDK's start() internally polls getSandbox every 100ms which
    // hammers the API.  We trigger the start, then let the caller
    // (ensureSandboxStarted / waitForStableState) poll at a sane rate.
    await limiter.run(async () => {
      try {
        await this.sandbox.start(timeoutSecs);
      } catch (err: any) {
        // If the SDK times out waiting for 'started', that's fine — our
        // caller will poll.  Re-throw anything else.
        if (err?.message?.includes?.("timeout") || err?.message?.includes?.("Sandbox failed to become ready")) {
          return;
        }
        throw err;
      }
    });
  }

  async stop(): Promise<void> {
    await limiter.run(async () => {
      try {
        await this.sandbox.stop();
      } catch (err: any) {
        if (err?.message?.includes?.("timeout") || err?.message?.includes?.("Sandbox failed to become stopped")) {
          return;
        }
        throw err;
      }
    });
  }

  async delete(): Promise<void> {
    await limiter.run(() => this.sandbox.delete());
  }

  async fork(
    name?: string,
  ): Promise<{ id: string; name?: string; state?: string }> {
    if (typeof (this.sandbox as any).fork !== "function") {
      throw new Error(
        "Fork is not available in this version of the Daytona SDK. " +
        "Update @daytonaio/sdk to a version that supports sandbox forking.",
      );
    }
    const result: any = await limiter.run(() => (this.sandbox as any).fork(name));
    return {
      id: result.id,
      name: result.name,
      state: result.state,
    };
  }

  async refreshState(): Promise<void> {
    if (typeof (this.sandbox as any).refreshData === "function") {
      await limiter.run(() => (this.sandbox as any).refreshData());
    }
  }

  // ── File system (delegates to SDK) ────────────────

  readonly fs: SandboxFileSystem = {
    uploadFile: async (content: Buffer, remotePath: string) => {
      await this.sandbox.fs.uploadFile(content, remotePath);
    },
    downloadFile: async (remotePath: string): Promise<Buffer> => {
      return await this.sandbox.fs.downloadFile(remotePath);
    },
    createFolder: async (path: string, mode?: string) => {
      await this.sandbox.fs.createFolder(path, mode ?? "755");
    },
  };

  // ── Process (delegates to SDK) ────────────────────

  readonly process: SandboxProcess = {
    executeCommand: async (
      command: string,
      cwd?: string,
    ): Promise<ExecuteCommandResult> => {
      const result = await this.sandbox.process.executeCommand(command, cwd);
      return { result: result.result, exitCode: (result as any).exitCode };
    },
    createSession: async (sessionId: string) => {
      await this.sandbox.process.createSession(sessionId);
    },
    executeSessionCommand: async (
      sessionId: string,
      opts: SessionCommandOpts,
    ) => {
      return await this.sandbox.process.executeSessionCommand(sessionId, opts);
    },
  };

  // ── Git (delegates to SDK) ────────────────────────

  readonly git: SandboxGit = {
    clone: async (
      url: string,
      path: string,
      branch?: string,
      commit?: string,
      username?: string,
      password?: string,
    ) => {
      await this.sandbox.git.clone(
        url,
        path,
        branch,
        commit,
        username,
        password,
      );
    },
  };

  // ── Networking ────────────────────────────────────

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    const info = await limiter.run(() => this.sandbox.getPreviewLink(port));
    return { url: (info as any).url, token: (info as any).token };
  }

  async getSignedPreviewUrl(
    port: number,
    ttlSecs: number,
  ): Promise<PreviewInfo> {
    const info: any = await limiter.run(() =>
      (this.sandbox as any).getSignedPreviewUrl(port, ttlSecs),
    );
    return { url: info.url, token: info.token };
  }

  /**
   * Get a signed preview URL with a 60-minute TTL (3600 seconds).
   * This is a convenience method that uses the standard TTL for port forwarding.
   */
  async getSignedPreviewUrlWithDefaultTTL(port: number): Promise<PreviewInfo> {
    return this.getSignedPreviewUrl(port, 3600); // 60 minutes
  }

  async createSshAccess(expiresInMinutes: number): Promise<SshAccessInfo> {
    const access = await limiter.run(() =>
      this.sandbox.createSshAccess(expiresInMinutes),
    );
    return {
      sshCommand: access.sshCommand,
      expiresAt: String(access.expiresAt),
    };
  }
}

// ── Provider ─────────────────────────────────────────

export class DaytonaSandboxProvider implements SandboxProvider {
  readonly type = "daytona" as const;
  private daytona: Daytona | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(config: SandboxProviderConfig = {}) {}

  async initialize(): Promise<void> {
    this.daytona = new Daytona();
  }

  /**
   * Fast validation of Daytona API key by making a lightweight API call.
   * Throws an error immediately if authentication fails.
   */
  async validateAuthentication(): Promise<void> {
    if (!this.daytona) throw new Error("DaytonaSandboxProvider not initialized");
    
    try {
      // Make a minimal API call to validate authentication
      // The list() call is lightweight and will fail fast if auth is invalid
      await limiter.run(() => this.daytona!.list());
    } catch (err: any) {
      // Check for authentication-related errors
      if (err?.statusCode === 401 || err?.statusCode === 403) {
        throw new Error(`Daytona API authentication failed: Invalid API key`);
      }
      // For 400-level errors that aren't auth-related, still fail fast
      if (err?.statusCode >= 400 && err?.statusCode < 500) {
        throw new Error(`Daytona API error: ${err.message || 'Client error'}`);
      }
      // Re-throw other errors (network issues, etc.) as-is
      throw err;
    }
  }

  async create(params: CreateSandboxParams): Promise<SandboxInstance> {
    if (!this.daytona) throw new Error("DaytonaSandboxProvider not initialized");
    const daytona = this.daytona;
    const CREATION_TIMEOUT_SECS = 120;
    const sandbox = await limiter.run(() =>
      daytona.create(
        {
          snapshot: params.snapshot,
          autoStopInterval: params.autoStopInterval ?? 0,
          autoDeleteInterval: params.autoDeleteInterval ?? -1,
          autoArchiveInterval: params.autoArchiveInterval ?? 0,
          envVars: params.envVars,
          labels: params.labels,
          name: params.name,
          public: params.public,
        },
        { timeout: CREATION_TIMEOUT_SECS },
      ),
    );
    return new DaytonaSandboxInstance(sandbox);
  }

  async get(sandboxId: string): Promise<SandboxInstance> {
    if (!this.daytona) throw new Error("DaytonaSandboxProvider not initialized");
    const daytona = this.daytona;
    const sandbox = await limiter.run(() => daytona.get(sandboxId));
    return new DaytonaSandboxInstance(sandbox);
  }

  async list(): Promise<SandboxInstance[]> {
    if (!this.daytona) throw new Error("DaytonaSandboxProvider not initialized");
    const daytona = this.daytona;
    const result = await limiter.run(() => daytona.list());
    const sandboxes = (result as any).items ?? result;
    return (Array.isArray(sandboxes) ? sandboxes : []).map(
      (s: Sandbox) => new DaytonaSandboxInstance(s),
    );
  }
}
