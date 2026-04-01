/**
 * Daytona sandbox provider — wraps the @daytonaio/sdk.
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
    await this.sandbox.start(timeoutSecs);
  }

  async stop(): Promise<void> {
    await this.sandbox.stop();
  }

  async delete(): Promise<void> {
    await this.sandbox.delete();
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
    const result = await (this.sandbox as any).fork(name);
    return {
      id: result.id,
      name: result.name,
      state: result.state,
    };
  }

  async refreshState(): Promise<void> {
    if (typeof (this.sandbox as any).refreshData === "function") {
      await (this.sandbox as any).refreshData();
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
    const info = await this.sandbox.getPreviewLink(port);
    return { url: (info as any).url, token: (info as any).token };
  }

  async getSignedPreviewUrl(
    port: number,
    ttlSecs: number,
  ): Promise<PreviewInfo> {
    const info = await (this.sandbox as any).getSignedPreviewUrl(port, ttlSecs);
    return { url: info.url, token: info.token };
  }

  async createSshAccess(expiresInMinutes: number): Promise<SshAccessInfo> {
    const access = await this.sandbox.createSshAccess(expiresInMinutes);
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

  async create(params: CreateSandboxParams): Promise<SandboxInstance> {
    if (!this.daytona) throw new Error("DaytonaSandboxProvider not initialized");
    const sandbox = await this.daytona.create({
      snapshot: params.snapshot,
      autoStopInterval: params.autoStopInterval,
      envVars: params.envVars,
      labels: params.labels,
      name: params.name,
    });
    return new DaytonaSandboxInstance(sandbox);
  }

  async get(sandboxId: string): Promise<SandboxInstance> {
    if (!this.daytona) throw new Error("DaytonaSandboxProvider not initialized");
    const sandbox = await this.daytona.get(sandboxId);
    return new DaytonaSandboxInstance(sandbox);
  }

  async list(): Promise<SandboxInstance[]> {
    if (!this.daytona) throw new Error("DaytonaSandboxProvider not initialized");
    const result = await this.daytona.list();
    const sandboxes = (result as any).items ?? result;
    return (Array.isArray(sandboxes) ? sandboxes : []).map(
      (s: Sandbox) => new DaytonaSandboxInstance(s),
    );
  }
}
