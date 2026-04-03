/**
 * Sandbox provider abstraction layer.
 *
 * Defines the interfaces that all sandbox backends (Daytona, Docker, Apple
 * Containers, ...) must implement.  The bridge/daemon API surface (fs,
 * process, git) is uniform because the Daytona daemon binary is baked into
 * every container image regardless of provider.
 */

// ── Provider types ───────────────────────────────────

export type SandboxProviderType = 'daytona' | 'docker' | 'apple-container' | 'local';

export type SandboxState =
  | 'started'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'error'
  | 'archived'
  | 'unknown';

// ── Create params ────────────────────────────────────

export interface CreateSandboxParams {
  /** Daytona snapshot name (Daytona provider). */
  snapshot?: string;
  /** Container image reference (Docker / Apple Container providers). */
  image?: string;
  /** Disable auto-stop (0 = never). */
  autoStopInterval?: number;
  /** Auto-delete interval in minutes (-1 = never, 0 = immediately on stop). */
  autoDeleteInterval?: number;
  /** Auto-archive interval in minutes (0 = max/30 days). */
  autoArchiveInterval?: number;
  /** Environment variables injected at creation time. */
  envVars?: Record<string, string>;
  /** Metadata labels. */
  labels?: Record<string, string>;
  /** Human-readable sandbox name. */
  name?: string;
  /** User-specified working directory (Local provider). */
  localDir?: string;
  /** Called by the provider to signal status changes (e.g. 'pulling_image'). */
  onStatusChange?: (status: string) => void;
  /** Memory allocation in MB (Docker / Apple Container providers). */
  memoryMB?: number;
  /** Number of CPU cores (Docker / Apple Container providers). */
  cpus?: number;
}

// ── File system sub-interface ────────────────────────

export interface SandboxFileSystem {
  uploadFile(content: Buffer, remotePath: string): Promise<void>;
  downloadFile(remotePath: string): Promise<Buffer>;
  createFolder(path: string, mode?: string): Promise<void>;
}

// ── Process sub-interface ────────────────────────────

export interface ExecuteCommandResult {
  result?: string;
  exitCode?: number;
}

export interface SessionCommandOpts {
  command: string;
  async?: boolean;
}

export interface SandboxProcess {
  executeCommand(command: string, cwd?: string): Promise<ExecuteCommandResult>;
  createSession(sessionId: string): Promise<void>;
  executeSessionCommand(
    sessionId: string,
    opts: SessionCommandOpts,
  ): Promise<unknown>;
}

// ── Git sub-interface ────────────────────────────────

export interface SandboxGit {
  clone(
    url: string,
    path: string,
    branch?: string,
    commit?: string,
    username?: string,
    password?: string,
  ): Promise<void>;
}

// ── Preview / networking ─────────────────────────────

export interface PreviewInfo {
  url: string;
  token?: string;
}

export interface SshAccessInfo {
  sshCommand: string;
  expiresAt: string;
}

// ── SandboxInstance ──────────────────────────────────

/**
 * Represents a running (or stopped) sandbox.  Wraps both the lifecycle
 * operations and the daemon API for interacting with the sandbox internals.
 */
export interface SandboxInstance {
  readonly id: string;
  /** Human-readable name (may not be set for all providers). */
  readonly name?: string;
  /** Metadata labels attached at creation time. */
  readonly labels?: Record<string, string>;
  /** Current state — may be stale; call {@link refreshState} to update. */
  state: SandboxState;

  // Lifecycle
  start(timeoutSecs?: number): Promise<void>;
  stop(): Promise<void>;
  delete(): Promise<void>;
  fork(name?: string): Promise<{ id: string; name?: string; state?: string }>;
  refreshState(): Promise<void>;

  // Daemon API (uniform across providers)
  fs: SandboxFileSystem;
  process: SandboxProcess;
  git: SandboxGit;

  // Networking (provider-specific)
  getPreviewLink(port: number): Promise<PreviewInfo>;
  getSignedPreviewUrl?(
    port: number,
    ttlSecs: number,
  ): Promise<PreviewInfo>;
  createSshAccess?(
    expiresInMinutes: number,
  ): Promise<SshAccessInfo>;
}

// ── SandboxProvider ──────────────────────────────────

/** Provider configuration passed to the factory. */
export interface SandboxProviderConfig {
  /** Daytona API key (Daytona provider). */
  apiKey?: string;
  /** Daytona API URL (Daytona provider). */
  apiUrl?: string;
  /** Docker host URI (Docker provider). */
  dockerHost?: string;
  /** Container image to use (Docker / Apple Container providers). */
  image?: string;
  /** Base directory for local sandboxes (Local provider). Defaults to `~/.apex/sandboxes`. */
  localBaseDir?: string;
}

/**
 * Factory / registry that creates and retrieves {@link SandboxInstance}s.
 * Each provider type implements this interface.
 */
export interface SandboxProvider {
  readonly type: SandboxProviderType;
  initialize(): Promise<void>;
  create(params: CreateSandboxParams): Promise<SandboxInstance>;
  get(sandboxId: string): Promise<SandboxInstance>;
  list(): Promise<SandboxInstance[]>;
}
