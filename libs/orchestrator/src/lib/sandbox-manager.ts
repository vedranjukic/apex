/**
 * SandboxManager – creates / connects / manages sandboxes
 * and the WebSocket bridge that runs inside each one.
 *
 * Provider-agnostic: the actual sandbox backend (Daytona, Docker, Apple
 * Containers, …) is selected via {@link OrchestratorConfig.provider}.
 */

import WebSocket from "ws";
import crypto from "crypto";
import os from "os";
import {
  createSandboxProvider,
  type SandboxProvider,
  type SandboxInstance,
  type SandboxProviderType,
} from "./providers/index.js";
import { EventEmitter } from "events";
import {
  BridgeMessage,
  BridgeTerminalCreated,
  BridgeTerminalOutput,
  BridgeTerminalExit,
  BridgeTerminalError,
  BridgeTerminalList,
  BridgePortsUpdate,
  BridgeLspResponse,
  BridgeLspStatus,
  PortInfo,
  LayoutData,
  FileEntry,
  SearchResult,
  SearchMatch,
  ClaudeAssistantMessage,
  ClaudeResultMessage,
  OrchestratorConfig,
  SandboxSession,
} from "./types.js";
import { getBridgeScript } from "./bridge-script.js";
import { getMcpTerminalScript } from "./mcp-terminal-script.js";
import { getMcpLspScript } from "./mcp-lsp-script.js";

const BRIDGE_PORT = 8080;
const VSCODE_PORT = 9090;
const BRIDGE_DIR = "/home/daytona/bridge";
const HOME_DIR = "/home/daytona";

/**
 * Resolve the LLM proxy base URL that containers will use to reach the host API.
 *
 * - For the local provider: localhost URLs work as-is (process runs on host).
 * - For container providers (docker, apple-container): replace localhost/127.0.0.1
 *   with the host's LAN IP so the container can reach it.
 * - For Daytona (cloud): only works when a public `API_BASE_URL` is set.
 *   If the URL still points at localhost, returns `null` to signal that the
 *   proxy is unreachable and the caller should fall back to direct keys.
 */
function resolveProxyBaseUrl(
  raw: string,
  provider: string,
): string | null {
  try {
    const u = new URL(raw);
    const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";

    if (provider === "daytona") {
      return isLocal ? null : raw;
    }

    // Local provider runs on the host — localhost works directly
    if (provider === "local") {
      return raw;
    }

    // Container providers: swap localhost for the host's LAN IP
    if (isLocal) {
      const hostIp = getHostLanIp();
      if (hostIp) {
        u.hostname = hostIp;
        return u.toString().replace(/\/$/, "");
      }
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Resolve the MITM secrets proxy URL that containers will use.
 * Same host-resolution logic as resolveProxyBaseUrl but for the secrets proxy port.
 */
function resolveSecretsProxyUrl(
  proxyBaseUrl: string,
  provider: string,
  secretsProxyPort: number,
): string | null {
  try {
    const u = new URL(proxyBaseUrl);
    u.port = String(secretsProxyPort);
    const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";

    if (provider === "daytona") {
      return isLocal ? null : u.toString().replace(/\/$/, "");
    }

    if (provider === "local") {
      return u.toString().replace(/\/$/, "");
    }

    if (isLocal) {
      const hostIp = getHostLanIp();
      if (hostIp) {
        u.hostname = hostIp;
        return u.toString().replace(/\/$/, "");
      }
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const CA_CERT_PATH = "/usr/local/share/ca-certificates/apex-proxy.crt";

/** Find the first non-internal IPv4 address on a LAN interface. */
function getHostLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") return addr.address;
    }
  }
  return null;
}

/** Convert a project name into a filesystem-safe slug. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^a-z0-9]+/g, "-") // non-alphanum → hyphen
      .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
      .replace(/-{2,}/g, "-") || // collapse consecutive hyphens
    "project"
  ); // fallback if empty
}

export interface SandboxManagerEvents {
  message: (sandboxId: string, msg: BridgeMessage) => void;
  status: (
    sandboxId: string,
    status: SandboxSession["status"],
    error?: string,
  ) => void;
  terminal_created: (sandboxId: string, msg: BridgeTerminalCreated) => void;
  terminal_output: (sandboxId: string, msg: BridgeTerminalOutput) => void;
  terminal_exit: (sandboxId: string, msg: BridgeTerminalExit) => void;
  terminal_error: (sandboxId: string, msg: BridgeTerminalError) => void;
  terminal_list: (sandboxId: string, msg: BridgeTerminalList) => void;
  file_changed: (sandboxId: string, dirs: string[]) => void;
  ports_update: (sandboxId: string, msg: BridgePortsUpdate) => void;
  lsp_response: (sandboxId: string, msg: BridgeLspResponse) => void;
  lsp_status: (sandboxId: string, msg: BridgeLspStatus) => void;
}

export declare interface SandboxManager {
  on<E extends keyof SandboxManagerEvents>(
    event: E,
    listener: SandboxManagerEvents[E],
  ): this;
  emit<E extends keyof SandboxManagerEvents>(
    event: E,
    ...args: Parameters<SandboxManagerEvents[E]>
  ): boolean;
}

type InternalSession = SandboxSession & {
  sandbox: SandboxInstance;
  ws: WebSocket | null;
  projectDir: string;
  bridgeDir: string;
};

/** Ports filtered from auto-detection (infrastructure / well-known services) */
const FILTERED_PORTS = new Set([
  BRIDGE_PORT, 9090, 4096,
  22, 25, 53, 445, 2375, 2376, 3306, 3389, 5432, 6379, 27017,
  2280, 22220, 22222, 33333,
]);

/** TTL for cached Sandbox objects (avoid redundant daytona.get() calls) */
const SANDBOX_CACHE_TTL = 60_000;
/** How long to trust a "started" state without re-checking */
const STARTED_STATE_TTL = 30_000;

export class SandboxManager extends EventEmitter {
  private config: Required<OrchestratorConfig>;
  private provider: SandboxProvider | null = null;
  private sessions: Map<string, InternalSession> = new Map();
  private lastPortsBySandbox = new Map<string, BridgePortsUpdate>();
  private sandboxCache = new Map<
    string,
    { sandbox: SandboxInstance; cachedAt: number }
  >();
  private startedAt = new Map<string, number>();
  private reconnectPromises = new Map<string, Promise<void>>();
  private projectNames = new Map<string, string>();
  private projectIds = new Map<string, string>();
  private localDirs = new Map<string, string>();

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = {
      anthropicApiKey:
        config.anthropicApiKey || process.env["ANTHROPIC_API_KEY"] || "",
      openaiApiKey:
        config.openaiApiKey || process.env["OPENAI_API_KEY"] || "",
      githubToken:
        config.githubToken || process.env["GITHUB_TOKEN"] || "",
      snapshot:
        config.snapshot || process.env["DAYTONA_SNAPSHOT"] || "apex-default-0.2.1-m",
      image:
        config.image || process.env["SANDBOX_IMAGE"] || "daytonaio/apex-default:0.2.1-m",
      timeoutMs: config.timeoutMs || 600000,
      provider:
        (config.provider as SandboxProviderType) ||
        (process.env["SANDBOX_PROVIDER"] as SandboxProviderType) ||
        "daytona",
      proxyBaseUrl:
        config.proxyBaseUrl ||
        process.env["API_BASE_URL"] ||
        `http://localhost:${process.env["PORT"] || "3000"}`,
      secretsProxyCaCert: config.secretsProxyCaCert || "",
      secretsProxyPort:
        config.secretsProxyPort ||
        Number(process.env["SECRETS_PROXY_PORT"] || "3001"),
      secretPlaceholders: config.secretPlaceholders || {},
      memoryMB: config.memoryMB || Number(process.env["SANDBOX_MEMORY_MB"] || "4096"),
      cpus: config.cpus || Number(process.env["SANDBOX_CPUS"] || "2"),
      gitUserName: config.gitUserName || "",
      gitUserEmail: config.gitUserEmail || "",
      proxyAuthToken: config.proxyAuthToken || "",
      secretsProxyBaseUrl:
        config.secretsProxyBaseUrl ||
        process.env["API_BASE_URL"] ||
        `http://localhost:${process.env["PORT"] || "3000"}`,
    };
  }

  async initialize(): Promise<void> {
    this.provider = createSandboxProvider(this.config.provider, {
      image: this.config.image,
    });
    await this.provider.initialize();
  }

  /** Store a sandboxId → projectName mapping so reconnections use the correct project directory. */
  registerProjectName(sandboxId: string, projectName: string): void {
    if (projectName) this.projectNames.set(sandboxId, projectName);
  }

  /** Store a sandboxId → projectId mapping so the bridge gets the correct preview proxy URLs. */
  registerProjectId(sandboxId: string, projectId: string): void {
    if (projectId) this.projectIds.set(sandboxId, projectId);
  }

  /**
   * Hot-update the LLM proxy config (base URL + auth token).
   * Called when the Daytona proxy sandbox is re-created mid-flight so that
   * subsequent bridge starts and sandbox creations use the new URL.
   */
  updateProxyConfig(proxyBaseUrl: string, authToken: string): void {
    this.config.proxyBaseUrl = proxyBaseUrl;
    this.config.proxyAuthToken = authToken;
  }

  /**
   * Build env vars to inject into the container/sandbox at creation time.
   * Used for Docker, Apple Container, and Daytona providers.
   * Local provider ignores env vars (user manages their own environment).
   */
  private buildContainerEnvVars(): Record<string, string> {
    const proxyBase = resolveProxyBaseUrl(this.config.proxyBaseUrl, this.config.provider);
    const useProxy = !!proxyBase;
    const envVars: Record<string, string> = {};

    const isDaytona = this.config.provider === "daytona";

    if (this.config.anthropicApiKey) {
      if (useProxy) {
        envVars["ANTHROPIC_API_KEY"] = "sk-proxy-placeholder";
        envVars["ANTHROPIC_BASE_URL"] = `${proxyBase}/llm-proxy/anthropic/v1`;
      } else if (isDaytona) {
        envVars["ANTHROPIC_API_KEY"] = "sk-proxy-placeholder";
      } else {
        envVars["ANTHROPIC_API_KEY"] = this.config.anthropicApiKey;
      }
    }
    if (this.config.openaiApiKey) {
      if (useProxy) {
        envVars["OPENAI_API_KEY"] = "sk-proxy-placeholder";
        envVars["OPENAI_BASE_URL"] = `${proxyBase}/llm-proxy/openai/v1`;
      } else if (isDaytona) {
        envVars["OPENAI_API_KEY"] = "sk-proxy-placeholder";
      } else {
        envVars["OPENAI_API_KEY"] = this.config.openaiApiKey;
      }
    }

    if (isDaytona && !useProxy) {
      console.warn(
        "[sandbox] Daytona provider without a public API_BASE_URL — LLM proxy unreachable. " +
        "Set API_BASE_URL to a publicly reachable URL to enable the LLM proxy.",
      );
    }

    const secretsProxyUrl = resolveSecretsProxyUrl(
      this.config.secretsProxyBaseUrl, this.config.provider, this.config.secretsProxyPort,
    );
    // For Daytona the MITM proxy runs in the proxy sandbox (reachable via tunnel),
    // not on the host — so availability depends on proxyBase, not secretsProxyUrl.
    const secretsProxyAvailable = isDaytona ? useProxy : !!secretsProxyUrl;

    if (secretsProxyAvailable) {
      if (isDaytona) {
        // For Daytona: use tunnel client on localhost:9339
        envVars["HTTPS_PROXY"] = "http://localhost:9339";
        envVars["HTTP_PROXY"] = "http://localhost:9339";
        envVars["https_proxy"] = "http://localhost:9339";
        envVars["http_proxy"] = "http://localhost:9339";
        envVars["TUNNEL_ENDPOINT_URL"] = `${proxyBase}/tunnel`;
      } else {
        // For other providers: use direct proxy URL
        envVars["HTTPS_PROXY"] = secretsProxyUrl!;
        envVars["HTTP_PROXY"] = secretsProxyUrl!;
        envVars["https_proxy"] = secretsProxyUrl!;
        envVars["http_proxy"] = secretsProxyUrl!;
      }
      envVars["NO_PROXY"] = "localhost,127.0.0.1,0.0.0.0";
      envVars["no_proxy"] = "localhost,127.0.0.1,0.0.0.0";
      envVars["NODE_EXTRA_CA_CERTS"] = CA_CERT_PATH;
      envVars["SSL_CERT_FILE"] = "/etc/ssl/certs/ca-certificates.crt";
      envVars["REQUESTS_CA_BUNDLE"] = "/etc/ssl/certs/ca-certificates.crt";
      envVars["CURL_CA_BUNDLE"] = "/etc/ssl/certs/ca-certificates.crt";
    }

    if (this.config.githubToken && secretsProxyAvailable) {
      envVars["GH_TOKEN"] = "gh-proxy-placeholder";
    }

    for (const [name, placeholder] of Object.entries(this.config.secretPlaceholders)) {
      envVars[name] = placeholder;
    }

    return envVars;
  }

  /** Create a sandbox, install bridge, return the sandboxId. */
  async createSandbox(
    snapshot?: string,
    projectName?: string,
    gitRepo?: string,
    agentType?: string,
    projectId?: string,
    onStatusChange?: (status: string) => void,
    localDir?: string,
    gitBranch?: string,
    createBranch?: string,
  ): Promise<string> {
    if (!this.provider) throw new Error("SandboxManager not initialized");

    const envVars = this.config.provider !== "local"
      ? this.buildContainerEnvVars()
      : undefined;

    const sandbox = await this.provider.create({
      snapshot: snapshot || this.config.snapshot,
      image: this.config.image,
      autoStopInterval: 0,
      envVars,
      onStatusChange,
      localDir,
      memoryMB: this.config.memoryMB,
      cpus: this.config.cpus,
    });

    if (projectName) this.projectNames.set(sandbox.id, projectName);
    if (projectId) this.projectIds.set(sandbox.id, projectId);

    const isLocal = this.config.provider === "local";
    let projectDir: string;
    let bridgeDir: string;

    if (isLocal && localDir) {
      projectDir = localDir;
      bridgeDir = `${localDir}/.apex`;
    } else {
      const projectSlug = projectName ? slugify(projectName) : null;
      projectDir = projectSlug ? `${HOME_DIR}/${projectSlug}` : HOME_DIR;
      bridgeDir = BRIDGE_DIR;
    }

    if (localDir) this.localDirs.set(sandbox.id, localDir);

    const sessionId = crypto.randomUUID();
    const session: InternalSession = {
      id: sessionId,
      sandboxId: sandbox.id,
      previewUrl: null,
      previewToken: null,
      bridgeSessionId: null,
      ws: null,
      status: "creating",
      messages: [],
      startTime: Date.now(),
      sandbox,
      projectDir,
      bridgeDir,
    };
    this.sessions.set(sandbox.id, session);

    await this.installBridge(session, gitRepo, agentType, gitBranch, createBranch);

    return sandbox.id;
  }

  /**
   * Reconnect to an existing sandbox that was created in a previous process.
   * Deduplicates concurrent calls — if a reconnect is already in progress
   * for this sandbox, callers wait for the same promise.
   */
  /** Store a sandboxId → localDir mapping for local provider reconnections. */
  registerLocalDir(sandboxId: string, localDir: string): void {
    if (localDir) this.localDirs.set(sandboxId, localDir);
  }

  async reconnectSandbox(
    sandboxId: string,
    projectName?: string,
    localDir?: string,
  ): Promise<void> {
    if (!this.provider) throw new Error("SandboxManager not initialized");

    if (projectName) this.projectNames.set(sandboxId, projectName);
    if (localDir) this.localDirs.set(sandboxId, localDir);

    const existing = this.sessions.get(sandboxId);
    if (existing?.ws?.readyState === WebSocket.OPEN) return;

    const inflight = this.reconnectPromises.get(sandboxId);
    if (inflight) {
      await inflight;
      return;
    }

    const promise = this.doReconnect(sandboxId, projectName, localDir);
    this.reconnectPromises.set(sandboxId, promise);
    try {
      await promise;
    } finally {
      this.reconnectPromises.delete(sandboxId);
    }
  }

  private async doReconnect(
    sandboxId: string,
    projectName?: string,
    localDir?: string,
  ): Promise<void> {
    const t0 = Date.now();
    const log = (msg: string) =>
      console.log(
        `[reconnect:${sandboxId.slice(0, 8)}] ${msg} (+${Date.now() - t0}ms)`,
      );

    // Hard timeout so doReconnect never blocks forever.
    // 90s allows for container restart + bridge upload + WS connect.
    const RECONNECT_TIMEOUT = 90_000;

    const work = async () => {
      log("start");
      const sandbox = await this.getCachedSandbox(sandboxId);
      log("got sandbox object");

      const isLocal = this.config.provider === "local";
      const resolvedLocalDir = localDir || this.localDirs.get(sandboxId);
      const resolvedName = projectName || this.projectNames.get(sandboxId);

      let projectDir: string;
      let bridgeDir: string;

      if (isLocal && resolvedLocalDir) {
        projectDir = resolvedLocalDir;
        bridgeDir = `${resolvedLocalDir}/.apex`;
      } else {
        const projectSlug = resolvedName ? slugify(resolvedName) : null;
        projectDir = projectSlug ? `${HOME_DIR}/${projectSlug}` : HOME_DIR;
        bridgeDir = BRIDGE_DIR;
      }

      const existing = this.sessions.get(sandboxId);
      const session: InternalSession = existing ?? {
        id: crypto.randomUUID(),
        sandboxId: sandbox.id,
        previewUrl: null,
        previewToken: null,
        bridgeSessionId: null,
        ws: null,
        status: "connecting",
        messages: [],
        startTime: Date.now(),
        sandbox,
        projectDir,
        bridgeDir,
      };
      if (existing) {
        if (resolvedName || resolvedLocalDir) existing.projectDir = projectDir;
        existing.bridgeDir = bridgeDir;
      }
      if (!existing) {
        this.sessions.set(sandbox.id, session);
      }
      session.sandbox = sandbox;

      await this.ensureSandboxStarted(sandbox);
      log("sandbox started");

      const [previewInfo] = await Promise.all([
        sandbox.getPreviewLink(BRIDGE_PORT),
        sandbox.fs
          .uploadFile(
            Buffer.from(getBridgeScript(BRIDGE_PORT, session.projectDir, undefined)),
            `${session.bridgeDir}/bridge.cjs`,
          )
          .catch(() => {
            /* best-effort */
          }),
      ]);
      session.previewUrl = previewInfo.url;
      session.previewToken = previewInfo.token ?? null;
      log("got preview URL");

      await this.connectWithRetry(session);
      log("connected");
    };

    await Promise.race([
      work(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Bridge reconnect timed out after ${RECONNECT_TIMEOUT / 1000}s`,
              ),
            ),
          RECONNECT_TIMEOUT,
        ),
      ),
    ]);
  }

  /**
   * Get a Sandbox object, using a cache to avoid redundant daytona.get() calls
   * when multiple operations fire concurrently.
   */
  private async getCachedSandbox(sandboxId: string): Promise<SandboxInstance> {
    const cached = this.sandboxCache.get(sandboxId);
    if (cached && Date.now() - cached.cachedAt < SANDBOX_CACHE_TTL) {
      return cached.sandbox;
    }
    if (!this.provider) throw new Error("SandboxManager not initialized");
    const sandbox = await this.provider.get(sandboxId);
    this.sandboxCache.set(sandboxId, { sandbox, cachedAt: Date.now() });
    return sandbox;
  }

  /**
   * Check if the sandbox is running and start it if not.
   * After starting, also restarts the bridge process.
   * Skips the expensive refreshData() API call when we have recent proof the
   * sandbox is running (active WS connection or recently verified state).
   */
  private async ensureSandboxStarted(sandbox: SandboxInstance): Promise<void> {
    const session = this.sessions.get(sandbox.id);
    if (session?.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    const lastConfirmed = this.startedAt.get(sandbox.id);
    if (lastConfirmed && Date.now() - lastConfirmed < STARTED_STATE_TTL) {
      return;
    }

    try {
      await sandbox.refreshState();
    } catch {
      /* best-effort */
    }

    if (sandbox.state === "started") {
      this.startedAt.set(sandbox.id, Date.now());
      return;
    }

    this.emit("status", sandbox.id, "starting_sandbox" as any);
    await sandbox.start(60);
    this.startedAt.set(sandbox.id, Date.now());

    if (session) {
      await this.restartBridge(session);
    }
  }

  /** Connect to an existing sandbox's bridge and send a prompt. */
  async sendPrompt(
    sandboxId: string,
    prompt: string,
    threadId?: string,
    sessionId?: string | null,
    mode?: string,
    model?: string,
    agent?: string,
    forceRestart?: boolean,
    images?: { type: 'base64'; media_type: string; data: string }[],
    agentSettings?: Record<string, unknown>,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    const effectiveAgent = agent || (mode === 'plan' ? 'plan' : 'build');
    session.ws!.send(
      JSON.stringify({
        type: "start_claude",
        prompt,
        threadId,
        sessionId: sessionId || undefined,
        agent: effectiveAgent,
        model: model || undefined,
        forceRestart: forceRestart || undefined,
        images: images && images.length > 0 ? images : undefined,
        agentSettings: agentSettings || undefined,
      }),
    );
    session.status = "running";
    this.emit("status", sandboxId, "running");
  }

  /** Stop (kill) the Claude process for a thread. Used for testing or manual cancellation. */
  async stopClaude(sandboxId: string, threadId?: string): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({
        type: "stop_claude",
        threadId: threadId || undefined,
      }),
    );
  }

  /** Send a user's answer to an AskUserQuestion back to the running Claude process. */
  async sendUserAnswer(
    sandboxId: string,
    threadId: string,
    toolUseId: string,
    answer: string,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({
        type: "claude_user_answer",
        threadId,
        toolUseId,
        answer,
      }),
    );
  }


  /** Check if the bridge WebSocket for a sandbox is currently connected */
  isBridgeConnected(sandboxId: string): boolean {
    const session = this.sessions.get(sandboxId);
    return !!session?.ws && session.ws.readyState === WebSocket.OPEN;
  }

  /** Get session info for a sandbox */
  getSession(sandboxId: string): SandboxSession | undefined {
    const s = this.sessions.get(sandboxId);
    if (!s) return undefined;
    // Return without the internal sandbox/ws references
    const { sandbox: _sb, ws: _ws, ...rest } = s;
    return rest;
  }

  /** Get the project working directory for a sandbox */
  getProjectDir(sandboxId: string, projectName?: string): string {
    const session = this.sessions.get(sandboxId);
    if (session?.projectDir) return session.projectDir;
    const localDir = this.localDirs.get(sandboxId);
    if (localDir) return localDir;
    if (projectName) {
      const slug = slugify(projectName);
      return `${HOME_DIR}/${slug}`;
    }
    return HOME_DIR;
  }

  /**
   * Fork a running sandbox: create a Daytona copy-on-write fork, reconnect
   * to the bridge in the forked sandbox, and checkout a new git branch.
   */
  async forkSandbox(
    sourceSandboxId: string,
    branchName: string,
    projectName?: string,
  ): Promise<string> {
    const sourceSandbox = await this.ensureSandbox(sourceSandboxId);

    const forkName = projectName
      ? `${slugify(projectName)}-${slugify(branchName)}`
      : undefined;
    const forkResult = await sourceSandbox.fork(forkName);

    // Reconnect to the forked sandbox's bridge (the fork includes the running process)
    await this.reconnectSandbox(forkResult.id, projectName);

    // Create and checkout the new branch in the forked sandbox.
    // Use shell command instead of SDK git API — `git checkout -b` works even
    // on repos with no commits (orphan branch), whereas the SDK's createBranch
    // requires an existing HEAD reference.
    const gitRoot = await this.findGitRoot(forkResult.id);
    if (gitRoot) {
      const forkedSandbox = await this.ensureSandbox(forkResult.id);
      await forkedSandbox.process.executeCommand(
        `git checkout -b ${branchName}`,
        gitRoot,
      );
    }

    return forkResult.id;
  }

  /**
   * Delete a sandbox. Throws if the Daytona delete call fails (e.g. the
   * sandbox still has fork children), so callers can fall back to
   * {@link stopSandbox}.
   */
  async deleteSandbox(sandboxId: string): Promise<void> {
    this.sandboxCache.delete(sandboxId);
    this.startedAt.delete(sandboxId);
    this.projectNames.delete(sandboxId);
    this.projectIds.delete(sandboxId);
    const session = this.sessions.get(sandboxId);
    if (session) {
      session.ws?.close();
      this.sessions.delete(sandboxId);
      await session.sandbox.delete();
      return;
    }

    if (!this.provider) throw new Error("SandboxManager not initialized");
    const sandbox = await this.provider.get(sandboxId);
    await sandbox.delete();
  }

  /**
   * Stop a sandbox without deleting it (closes the WS session if tracked).
   */
  async stopSandbox(sandboxId: string): Promise<void> {
    this.sandboxCache.delete(sandboxId);
    this.startedAt.delete(sandboxId);
    this.projectNames.delete(sandboxId);
    this.projectIds.delete(sandboxId);
    const session = this.sessions.get(sandboxId);
    if (session) {
      session.ws?.close();
      this.sessions.delete(sandboxId);
      await session.sandbox.stop();
      return;
    }

    if (!this.provider) throw new Error("SandboxManager not initialized");
    const sandbox = await this.provider.get(sandboxId);
    await sandbox.stop();
  }

  /** Stop all sandboxes */
  async cleanup(): Promise<void> {
    for (const [sandboxId] of this.sessions) {
      await this.deleteSandbox(sandboxId);
    }
  }

  // ── Terminal methods ───────────────────────────────

  /** Create a new terminal in the sandbox */
  async createTerminal(
    sandboxId: string,
    terminalId: string,
    cols: number,
    rows: number,
    cwd?: string,
    name?: string,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({
        type: "terminal_create",
        terminalId,
        cols,
        rows,
        cwd,
        name,
      }),
    );
  }

  /** Send input (keystrokes) to a terminal */
  async sendTerminalInput(
    sandboxId: string,
    terminalId: string,
    data: string,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({ type: "terminal_input", terminalId, data }),
    );
  }

  /** Resize a terminal */
  async resizeTerminal(
    sandboxId: string,
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({ type: "terminal_resize", terminalId, cols, rows }),
    );
  }

  /** Close a terminal */
  async closeTerminal(sandboxId: string, terminalId: string): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(JSON.stringify({ type: "terminal_close", terminalId }));
  }

  /** Request list of active terminals (response comes via terminal_list event) */
  async listTerminals(sandboxId: string): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(JSON.stringify({ type: "terminal_list" }));
  }

  /** Forward LSP JSON-RPC data to the bridge for a specific language */
  async sendLspData(
    sandboxId: string,
    language: string,
    jsonrpc: Record<string, unknown>,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({ type: "lsp_data", language, jsonrpc }),
    );
  }

  // ── VS Code (code-server) methods ─────────────────

  /** Get a signed preview URL for the code-server running in the sandbox.
   *  Signed URLs embed the auth token in the URL itself — no headers needed. */
  async getVscodeUrl(
    sandboxId: string,
  ): Promise<{ url: string; token: string }> {
    const sandbox = await this.ensureSandbox(sandboxId);
    if (!sandbox.getSignedPreviewUrl) {
      const info = await sandbox.getPreviewLink(VSCODE_PORT);
      return { url: info.url, token: info.token ?? "" };
    }
    const signedInfo = await sandbox.getSignedPreviewUrl(VSCODE_PORT, 28800);
    return { url: signedInfo.url, token: signedInfo.token ?? "" };
  }

  /** Create an SSH access token for the sandbox (default 24 hours). */
  async createSshAccess(
    sandboxId: string,
    expiresInMinutes = 1440,
  ): Promise<{
    sshUser: string;
    sshHost: string;
    sshPort: number;
    sandboxId: string;
    remotePath: string;
    expiresAt: string;
  }> {
    const sandbox = await this.ensureSandbox(sandboxId);
    if (!sandbox.createSshAccess) {
      throw new Error(
        `SSH access is not supported by the ${this.config.provider} provider`,
      );
    }
    const access = await sandbox.createSshAccess(expiresInMinutes);
    const { user, host, port } = this.parseSshCommand(access.sshCommand);
    const remotePath = this.getProjectDir(sandboxId);
    return {
      sshUser: user,
      sshHost: host,
      sshPort: port,
      sandboxId,
      remotePath,
      expiresAt: new Date(access.expiresAt).toISOString(),
    };
  }

  /** Parse a Daytona sshCommand string into components.
   *  Handles both `ssh USER@HOST -p PORT` and `ssh -p PORT USER@HOST`. */
  private parseSshCommand(cmd: string): {
    user: string;
    host: string;
    port: number;
  } {
    const userHostMatch = cmd.match(/(\S+)@(\S+)/);
    const portMatch = cmd.match(/-p\s+(\d+)/);
    if (!userHostMatch) {
      throw new Error(`Unable to parse SSH command: ${cmd}`);
    }
    return {
      user: userHostMatch[1],
      host: userHostMatch[2],
      port: portMatch ? parseInt(portMatch[1], 10) : 22,
    };
  }

  async getPortPreviewUrl(
    sandboxId: string,
    port: number,
  ): Promise<{ url: string; token: string }> {
    const sandbox = await this.ensureSandbox(sandboxId);
    const previewInfo = await sandbox.getPreviewLink(port);
    return { url: previewInfo.url, token: previewInfo.token ?? "" };
  }

  getLastPorts(sandboxId: string): BridgePortsUpdate | undefined {
    return this.lastPortsBySandbox.get(sandboxId);
  }

  async scanPorts(sandboxId: string): Promise<BridgePortsUpdate> {
    const sandbox = await this.ensureSandbox(sandboxId);
    const result = await sandbox.process.executeCommand(
      `netstat -tlnp 2>/dev/null | grep LISTEN || true`,
    );
    const output = result.result ?? "";
    const ports: PortInfo[] = [];
    const seen = new Set<number>();
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes("LISTEN")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 6) continue;
      const localAddr = parts[3] ?? "";
      if (localAddr.startsWith("127.") || localAddr.startsWith("::1:")) continue;
      const lastColon = localAddr.lastIndexOf(":");
      if (lastColon === -1) continue;
      const portNum = parseInt(localAddr.substring(lastColon + 1), 10);
      if (isNaN(portNum) || seen.has(portNum)) continue;
      if (FILTERED_PORTS.has(portNum)) continue;
      seen.add(portNum);
      let proc = "";
      const pidProg = parts[6] ?? parts[5] ?? "";
      const slash = pidProg.indexOf("/");
      if (slash !== -1) proc = pidProg.substring(slash + 1);
      if (proc === "daytona-daemon" || proc === "daytona") continue;
      ports.push({ port: portNum, protocol: "tcp", process: proc, command: proc });
    }
    ports.sort((a, b) => a.port - b.port);
    const update: BridgePortsUpdate = { type: "ports_update", ports };
    this.lastPortsBySandbox.set(sandboxId, update);
    return update;
  }

  // ── Git methods ──────────────────────────────────

  /**
   * Find the git root directory for a sandbox. Checks the project dir first,
   * then searches one level of subdirectories for a .git folder.
   */
  private async findGitRoot(sandboxId: string): Promise<string | null> {
    const sandbox = await this.ensureSandbox(sandboxId);
    const projectDir = this.getProjectDir(sandboxId);

    // 1) Check if projectDir itself is a git repo (or inside one)
    const toplevel = await sandbox.process.executeCommand(
      'git rev-parse --show-toplevel 2>/dev/null || echo ""',
      projectDir,
    );
    const root = (toplevel.result ?? "").trim();
    if (root) return root;

    // 2) Search immediate subdirectories for a .git folder
    const search = await sandbox.process.executeCommand(
      `find "${projectDir}" -maxdepth 2 -name .git -type d -print -quit 2>/dev/null || echo ""`,
      projectDir,
    );
    const gitDir = (search.result ?? "").trim();
    if (gitDir) {
      // .git dir found → parent is the repo root
      return gitDir.replace(/\/\.git$/, "");
    }

    return null;
  }

  /** Get the current git branch for a sandbox's project directory */
  async getGitBranch(sandboxId: string): Promise<string | null> {
    try {
      const gitRoot = await this.findGitRoot(sandboxId);
      if (!gitRoot) return null;
      const sandbox = await this.ensureSandbox(sandboxId);
      const result = await sandbox.process.executeCommand(
        'git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""',
        gitRoot,
      );
      const branch = (result.result ?? "").trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  /** List all branches sorted by last commit date */
  async listBranches(
    sandboxId: string,
  ): Promise<import("./types.js").GitBranchEntry[]> {
    try {
      const gitRoot = await this.findGitRoot(sandboxId);
      if (!gitRoot) return [];
      const sandbox = await this.ensureSandbox(sandboxId);
      const result = await sandbox.process.executeCommand(
        "git branch -a --sort=-committerdate --format='%(refname:short)|%(committerdate:unix)|%(HEAD)' 2>/dev/null || echo ''",
        gitRoot,
      );
      const output = (result.result ?? "").trim();
      if (!output) return [];

      const seen = new Set<string>();
      const branches: import("./types.js").GitBranchEntry[] = [];

      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [name, tsStr, head] = trimmed.split("|");
        if (!name) continue;

        const cleanName = name.replace(/^'|'$/g, "");
        if (cleanName === "origin/HEAD") continue;
        if (seen.has(cleanName)) continue;
        seen.add(cleanName);

        const isRemote = cleanName.startsWith("origin/");
        const localName = isRemote
          ? cleanName.slice("origin/".length)
          : cleanName;
        if (isRemote && seen.has(localName)) continue;

        branches.push({
          name: cleanName,
          lastUsed: parseInt(tsStr ?? "0", 10) || 0,
          isCurrent: head?.trim() === "*",
          isRemote,
        });

        if (branches.length >= 100) break;
      }
      return branches;
    } catch {
      return [];
    }
  }

  /** Create a new branch and switch to it */
  async gitCreateBranch(
    sandboxId: string,
    name: string,
    startPoint?: string,
  ): Promise<string> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const safeName = name.replace(/[^a-zA-Z0-9/_.-]/g, "");
    const cmd = startPoint
      ? `git checkout -b "${safeName}" "${startPoint}" 2>&1`
      : `git checkout -b "${safeName}" 2>&1`;
    const result = await sandbox.process.executeCommand(cmd, gitRoot);
    return (result.result ?? "").trim();
  }

  /** Checkout a branch or ref (supports detached HEAD) */
  async gitCheckout(sandboxId: string, ref: string): Promise<string> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const safeRef = ref.replace(/[;&|`$]/g, "");
    const result = await sandbox.process.executeCommand(
      `git checkout "${safeRef}" 2>&1`,
      gitRoot,
    );
    return (result.result ?? "").trim();
  }

  /** Get full git status (branch, staged, unstaged, untracked, ahead/behind) */
  async getGitStatus(
    sandboxId: string,
  ): Promise<import("./types.js").GitStatusData> {
    const empty: import("./types.js").GitStatusData = {
      branch: null,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      ahead: 0,
      behind: 0,
    };
    try {
      const gitRoot = await this.findGitRoot(sandboxId);
      if (!gitRoot) return empty;
      const sandbox = await this.ensureSandbox(sandboxId);
      const result = await sandbox.process.executeCommand(
        "git status --porcelain -b -uall 2>&1",
        gitRoot,
      );
      const output = (result.result ?? "").trim();
      if (!output) return empty;

      const lines = output.split("\n");
      let branch: string | null = null;
      let ahead = 0;
      let behind = 0;
      const staged: import("./types.js").GitFileEntry[] = [];
      const unstaged: import("./types.js").GitFileEntry[] = [];
      const untracked: import("./types.js").GitFileEntry[] = [];
      const conflicted: import("./types.js").GitFileEntry[] = [];

      for (const line of lines) {
        if (line.startsWith("## ")) {
          const branchLine = line.slice(3);
          // Handle "No commits yet on <branch>" format
          if (branchLine.startsWith("No commits yet on ")) {
            branch = branchLine
              .slice("No commits yet on ".length)
              .split(" ")[0];
          } else {
            const dotIdx = branchLine.indexOf("...");
            branch =
              dotIdx >= 0
                ? branchLine.slice(0, dotIdx)
                : branchLine.split(" ")[0];
          }
          const aheadMatch = branchLine.match(/ahead (\d+)/);
          const behindMatch = branchLine.match(/behind (\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
          continue;
        }
        if (line.length < 2) continue;

        const x = line[0]; // index status
        const y = line[1]; // working tree status
        const rest = line.slice(3);

        // Merge conflicts
        if (
          x === "U" ||
          y === "U" ||
          (x === "A" && y === "A") ||
          (x === "D" && y === "D")
        ) {
          conflicted.push({ path: rest, status: "conflicted" });
          continue;
        }

        // Untracked
        if (x === "?" && y === "?") {
          untracked.push({ path: rest, status: "untracked" });
          continue;
        }

        // Staged changes (index column)
        if (x === "M") staged.push({ path: rest, status: "modified" });
        else if (x === "A") staged.push({ path: rest, status: "added" });
        else if (x === "D") staged.push({ path: rest, status: "deleted" });
        else if (x === "R") {
          const parts = rest.split(" -> ");
          staged.push({
            path: parts[1] ?? rest,
            status: "renamed",
            oldPath: parts[0],
          });
        }

        // Unstaged changes (working tree column)
        if (y === "M") unstaged.push({ path: rest, status: "modified" });
        else if (y === "D") unstaged.push({ path: rest, status: "deleted" });
      }

      return { branch, staged, unstaged, untracked, conflicted, ahead, behind };
    } catch {
      return empty;
    }
  }

  /** Stage files */
  async gitStage(sandboxId: string, paths: string[]): Promise<void> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const escaped = paths.map((p) => `"${p}"`).join(" ");
    await sandbox.process.executeCommand(`git add ${escaped} 2>&1`, gitRoot);
  }

  /** Unstage files */
  async gitUnstage(sandboxId: string, paths: string[]): Promise<void> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const escaped = paths.map((p) => `"${p}"`).join(" ");
    await sandbox.process.executeCommand(
      `git reset HEAD -- ${escaped} 2>&1`,
      gitRoot,
    );
  }

  /** Discard working tree changes for tracked files, or remove untracked files */
  async gitDiscard(sandboxId: string, paths: string[]): Promise<void> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const escaped = paths.map((p) => `"${p}"`).join(" ");
    await sandbox.process.executeCommand(
      `git checkout -- ${escaped} 2>/dev/null; git clean -fd -- ${escaped} 2>/dev/null; true`,
      gitRoot,
    );
  }

  /** Commit staged changes */
  async gitCommit(sandboxId: string, message: string): Promise<string> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const safe = message.replace(/'/g, "'\\''");
    // Use -c flags to ensure user identity is set even on fresh sandboxes,
    // and redirect stderr so the command never hangs waiting for input.
    const result = await Promise.race([
      sandbox.process.executeCommand(
        `git -c user.name="Apex" -c user.email="user@apex.local" commit -m '${safe}' 2>&1`,
        gitRoot,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("git commit timed out after 30s")),
          30_000,
        ),
      ),
    ]);
    return (result.result ?? "").trim();
  }

  /** Push to remote */
  async gitPush(sandboxId: string): Promise<string> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const result = await sandbox.process.executeCommand(
      "git push 2>&1",
      gitRoot,
    );
    return (result.result ?? "").trim();
  }

  /** Pull from remote */
  async gitPull(sandboxId: string): Promise<string> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const result = await sandbox.process.executeCommand(
      "git pull 2>&1",
      gitRoot,
    );
    return (result.result ?? "").trim();
  }

  /** Get both sides of a diff for a single file */
  async getGitDiff(
    sandboxId: string,
    filePath: string,
    staged: boolean,
  ): Promise<{ original: string; modified: string }> {
    const gitRoot = await this.findGitRoot(sandboxId);
    if (!gitRoot) throw new Error("No git repository found");
    const sandbox = await this.ensureSandbox(sandboxId);
    const safePath = filePath.replace(/[;&|`$]/g, "");

    if (staged) {
      const orig = await sandbox.process.executeCommand(
        `git show HEAD:"${safePath}" 2>/dev/null || true`,
        gitRoot,
      );
      const mod = await sandbox.process.executeCommand(
        `git show :"${safePath}" 2>/dev/null || true`,
        gitRoot,
      );
      return { original: orig.result ?? "", modified: mod.result ?? "" };
    }

    const orig = await sandbox.process.executeCommand(
      `git show :"${safePath}" 2>/dev/null || git show HEAD:"${safePath}" 2>/dev/null || true`,
      gitRoot,
    );
    const mod = await sandbox.process.executeCommand(
      `cat "${safePath}" 2>/dev/null || true`,
      gitRoot,
    );
    return { original: orig.result ?? "", modified: mod.result ?? "" };
  }

  // ── File system methods ─────────────────────────────

  /** List files and directories in a sandbox directory */
  async listFiles(sandboxId: string, dirPath: string): Promise<FileEntry[]> {
    try {
      const sandbox = await this.ensureSandbox(sandboxId);
      const result = await sandbox.process.executeCommand(
        `ls -1pA "${dirPath}" 2>/dev/null || echo ""`,
        dirPath,
      );
      const raw = (result.result ?? "").trim();
      if (!raw) return [];

      const entries: FileEntry[] = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const isDir = line.endsWith("/");
          const name = isDir ? line.slice(0, -1) : line;
          const path = dirPath.endsWith("/")
            ? `${dirPath}${name}`
            : `${dirPath}/${name}`;
          return { name, path, isDirectory: isDir };
        });

      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return entries;
    } catch {
      return [];
    }
  }

  /** Create an empty file in the sandbox */
  async createFile(sandboxId: string, filePath: string): Promise<void> {
    const sandbox = await this.ensureSandbox(sandboxId);
    await sandbox.process.executeCommand(`touch "${filePath}"`);
  }

  /** Create a directory in the sandbox */
  async createFolder(sandboxId: string, dirPath: string): Promise<void> {
    const sandbox = await this.ensureSandbox(sandboxId);
    await sandbox.process.executeCommand(`mkdir -p "${dirPath}"`);
  }

  /** Rename (move) a file or directory in the sandbox */
  async renameFile(
    sandboxId: string,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const sandbox = await this.ensureSandbox(sandboxId);
    await sandbox.process.executeCommand(`mv "${oldPath}" "${newPath}"`);
  }

  /** Delete a file or directory in the sandbox */
  async deleteFile(sandboxId: string, targetPath: string): Promise<void> {
    const sandbox = await this.ensureSandbox(sandboxId);
    await sandbox.process.executeCommand(`rm -rf "${targetPath}"`);
  }

  /** Read the contents of a file in the sandbox */
  async readFile(sandboxId: string, filePath: string): Promise<string> {
    const sandbox = await this.ensureSandbox(sandboxId);
    const buf = await sandbox.fs.downloadFile(filePath);
    return buf.toString("utf-8");
  }

  /** Write content to a file in the sandbox */
  async writeFile(sandboxId: string, filePath: string, content: string): Promise<void> {
    const sandbox = await this.ensureSandbox(sandboxId);
    await sandbox.fs.uploadFile(Buffer.from(content), filePath);
  }

  private static readonly SISYPHUS_PROMPT = [
    "You are Sisyphus, an orchestration agent for complex multi-step tasks.",
    "",
    "Your approach:",
    "1. Analyze the request and break it into concrete sub-tasks",
    "2. Use the `task` tool to delegate each subtask to a worker agent",
    "3. Track progress — when a subtask fails, retry with adjusted context",
    "4. Provide a status update after each sub-task completes",
    "5. Synthesize the results and present a final summary",
    "",
    "For each subtask, call the task tool with:",
    '- subagent_type: "general" (for implementation work)',
    '- subagent_type: "explore" (for codebase investigation)',
    "",
    "When subtasks are independent, dispatch them in parallel by making",
    "multiple task tool calls in the same response.",
  ].join("\n");

  /**
   * Markdown agent file for sisyphus. Placed in .opencode/agents/sisyphus.md
   * so it has higher precedence than any project-level opencode.json config.
   */
  private static buildSisyphusAgentMd(steps: number, maxTokens?: number, reasoningEffort?: string): string {
    const lines = [
      "---",
      "description: Orchestration agent for complex multi-step tasks",
      "mode: primary",
      "model: anthropic/claude-sonnet-4-20250514",
      `steps: ${steps}`,
      ...(maxTokens ? [`maxTokens: ${maxTokens}`] : []),
      ...(reasoningEffort ? [`reasoningEffort: ${reasoningEffort}`] : []),
      "permission:",
      "  edit: allow",
      "  bash: allow",
      "  webfetch: allow",
      "---",
      "",
      ...SandboxManager.SISYPHUS_PROMPT.split("\n"),
    ];
    return lines.join("\n");
  }

  private static readonly VALID_REASONING_EFFORTS = new Set(["low", "medium", "high"]);

  /** Read agent-limit settings from process.env (populated by settings service). */
  private static readAgentLimits() {
    const parseInt_ = (v: string | undefined) => {
      const n = parseInt(v || "", 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const parseEffort = (v: string | undefined) => {
      const s = (v || "").trim().toLowerCase();
      return SandboxManager.VALID_REASONING_EFFORTS.has(s) ? s : undefined;
    };

    return {
      globalMaxTokens: parseInt_(process.env.AGENT_MAX_TOKENS),
      build: {
        maxTokens: parseInt_(process.env.AGENT_BUILD_MAX_TOKENS),
        reasoningEffort: parseEffort(process.env.AGENT_BUILD_REASONING_EFFORT),
      },
      plan: {
        maxTokens: parseInt_(process.env.AGENT_PLAN_MAX_TOKENS),
        reasoningEffort: parseEffort(process.env.AGENT_PLAN_REASONING_EFFORT),
      },
      sisyphus: {
        maxSteps: parseInt_(process.env.AGENT_SISYPHUS_MAX_STEPS) ?? 50,
        maxTokens: parseInt_(process.env.AGENT_SISYPHUS_MAX_TOKENS),
        reasoningEffort: parseEffort(process.env.AGENT_SISYPHUS_REASONING_EFFORT),
      },
    };
  }

  private static agentTokenOpts(maxTokens?: number): Record<string, unknown> {
    return maxTokens ? { maxTokens } : {};
  }

  private static agentReasoningOpts(reasoningEffort?: string): Record<string, unknown> {
    return reasoningEffort ? { reasoningEffort } : {};
  }

  private static buildSandboxInstructions(projectDir: string, isLocal: boolean): string {
    return [
      "# Sandbox Environment",
      "",
      `Your working directory is \`${projectDir}\`. This IS the project root.`,
      "All project files (source code, configs, package.json, etc.) MUST be created",
      "directly in this directory — do NOT create a new subfolder for the app.",
      "When asked to build or create an app, initialize it here in the current directory.",
      "",
      ...(isLocal
        ? [
            "You are running directly on the host machine (local sandbox provider).",
            "localhost/127.0.0.1 URLs are accessible to the user.",
            "",
            "## Preview URLs",
            "",
            "When you start any HTTP server, dev server, web app, or API on any port,",
            "you can share localhost URLs directly with the user (e.g. http://localhost:3000).",
            "You may also use the `get_preview_url` MCP tool which returns localhost URLs.",
          ]
        : [
            "You are running inside a Daytona cloud sandbox. The user CANNOT access localhost URLs.",
            "localhost/127.0.0.1 links will NOT work for the user.",
            "",
            "## IMPORTANT: Preview URLs",
            "",
            "Whenever you start any HTTP server, dev server, web app, or API on any port,",
            "you MUST use the `get_preview_url` MCP tool to get a publicly accessible URL.",
            "",
            "This tool is available in your MCP tools list as `mcp__terminal-server__get_preview_url`.",
            "It is NOT a CLI command — use it through your normal tool-calling interface.",
            "",
            "Call it with the port number, e.g.: get_preview_url({ port: 3000 })",
            "",
            "NEVER share localhost or 127.0.0.1 URLs with the user. ALWAYS call get_preview_url",
            "and share the returned public URL instead.",
          ]),
      "",
      "## Asking the User Questions",
      "",
      "When you need to ask the user a question, present options, or get clarification",
      "before proceeding, you MUST use the `ask_user` MCP tool.",
      "",
      "This tool is available as `mcp__terminal-server__ask_user`.",
      "It blocks until the user responds, so the user sees a clear prompt in the UI.",
      "",
      "Do NOT ask questions as plain text — the UI cannot detect them.",
      "ALWAYS use the `ask_user` tool so the system knows you are waiting for input.",
      "",
    ].join("\n");
  }

  private static readonly DEFAULT_EXCLUDE_DIRS = [
    // Version control
    ".git",
    ".svn",
    ".hg",
    // JS / Node
    "node_modules",
    ".npm",
    ".yarn",
    ".pnp",
    "bower_components",
    // Build output
    "dist",
    "build",
    "out",
    ".output",
    ".next",
    ".nuxt",
    ".svelte-kit",
    // Bundler / cache
    ".cache",
    ".parcel-cache",
    ".turbo",
    ".vite",
    // Python
    "__pycache__",
    ".venv",
    "venv",
    "env",
    ".mypy_cache",
    ".pytest_cache",
    ".tox",
    "*.egg-info",
    // Rust
    "target",
    // Go
    "vendor",
    // Java / JVM
    ".gradle",
    ".m2",
    ".mvn",
    // IDE / editor
    ".idea",
    ".vscode",
    ".vs",
    // OS
    ".DS_Store",
    // Misc
    "coverage",
    ".nyc_output",
    ".terraform",
    "tmp",
    ".tmp",
  ];

  /** Search file contents in the sandbox using grep */
  async searchFiles(
    sandboxId: string,
    query: string,
    searchDir: string,
    options: {
      matchCase?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
      includePattern?: string;
      excludePattern?: string;
    } = {},
  ): Promise<SearchResult[]> {
    if (!query) return [];

    const sandbox = await this.ensureSandbox(sandboxId);

    const flags = ["-rn", "--binary-files=without-match"];
    if (!options.matchCase) flags.push("-i");
    if (options.wholeWord) flags.push("-w");
    if (options.useRegex) flags.push("-E");
    else flags.push("-F");

    if (options.includePattern) {
      for (const pat of options.includePattern
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)) {
        flags.push(`--include=${pat}`);
      }
    }

    // Build the set of directories to exclude:
    // start with defaults, add user excludes, but remove any that appear in includePattern
    const includeParts = (options.includePattern ?? "")
      .split(",")
      .map((p) => p.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const includeSet = new Set(includeParts);

    const excludeDirs = new Set<string>();
    for (const dir of SandboxManager.DEFAULT_EXCLUDE_DIRS) {
      if (!includeSet.has(dir)) excludeDirs.add(dir);
    }
    if (options.excludePattern) {
      for (const pat of options.excludePattern
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)) {
        if (pat.includes(".") && !pat.includes("/")) {
          flags.push(`--exclude=${pat}`);
        } else {
          excludeDirs.add(pat);
        }
      }
    }
    for (const dir of excludeDirs) {
      flags.push(`--exclude-dir=${dir}`);
    }

    const escapedQuery = query.replace(/'/g, "'\\''");
    const cmd = `grep ${flags.join(" ")} -- '${escapedQuery}' . 2>/dev/null | head -2000; exit 0`;

    try {
      const result = await sandbox.process.executeCommand(cmd, searchDir);
      const raw = (result.result ?? "").trim();
      if (!raw) return [];

      const resultsByFile = new Map<string, SearchMatch[]>();

      for (const line of raw.split("\n")) {
        const colonIdx1 = line.indexOf(":");
        if (colonIdx1 <= 0) continue;
        const colonIdx2 = line.indexOf(":", colonIdx1 + 1);
        if (colonIdx2 <= 0) continue;

        const relPath = line.substring(0, colonIdx1);
        const lineNum = parseInt(line.substring(colonIdx1 + 1, colonIdx2), 10);
        const content = line.substring(colonIdx2 + 1);

        if (isNaN(lineNum)) continue;

        const cleanPath = relPath.startsWith("./")
          ? relPath.substring(2)
          : relPath;
        const absPath = searchDir.endsWith("/")
          ? `${searchDir}${cleanPath}`
          : `${searchDir}/${cleanPath}`;

        if (!resultsByFile.has(absPath)) {
          resultsByFile.set(absPath, []);
        }
        resultsByFile.get(absPath)!.push({
          line: lineNum,
          content: content.substring(0, 500),
        });
      }

      const results: SearchResult[] = [];
      for (const [filePath, matches] of resultsByFile) {
        results.push({ filePath, matches });
      }
      return results;
    } catch {
      return [];
    }
  }

  // ── Layout persistence methods ────────────────────

  private getLayoutFile(sandboxId: string): string {
    const localDir = this.localDirs.get(sandboxId);
    if (localDir) return `${localDir}/.apex/.apex-layout.json`;
    return "/home/daytona/.apex-layout.json";
  }

  /** Save layout state to the sandbox filesystem (via Daytona SDK, no bridge needed) */
  async saveLayout(sandboxId: string, data: LayoutData): Promise<void> {
    const sandbox = await this.ensureSandbox(sandboxId);
    const json = JSON.stringify(data, null, 2);
    await sandbox.fs.uploadFile(Buffer.from(json), this.getLayoutFile(sandboxId));
  }

  /** Load layout state from the sandbox filesystem (via Daytona SDK, no bridge needed) */
  async loadLayout(sandboxId: string): Promise<LayoutData | null> {
    try {
      const sandbox = await this.ensureSandbox(sandboxId);
      const layoutFile = this.getLayoutFile(sandboxId);
      const result = await sandbox.process.executeCommand(
        `cat ${layoutFile} 2>/dev/null || echo ""`,
      );
      const raw = (result.result ?? "").trim();
      if (!raw) return null;
      return JSON.parse(raw) as LayoutData;
    } catch {
      return null;
    }
  }

  // ── Private helpers ────────────────────────────────

  /**
   * Poll from inside the sandbox until the bridge HTTP server responds on its port.
   * This avoids depending on the external Daytona proxy and catches bridge crashes early.
   */
  private async waitForBridge(
    sandbox: SandboxInstance,
    sandboxId: string,
    maxAttempts = 20,
    intervalMs = 500,
    bridgeDirOverride?: string,
  ): Promise<void> {
    const bDir = bridgeDirOverride || BRIDGE_DIR;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const check = await sandbox.process.executeCommand(
          `curl -sf http://localhost:${BRIDGE_PORT}/ 2>&1 || echo "BRIDGE_NOT_READY"`,
        );
        const output = (check.result ?? "").trim();
        if (output.includes("bridge-ok")) return;
      } catch (err) {
        if (this.isContainerNotRunning(err)) {
          throw new Error(`Container is not running (sandbox ${sandboxId})`);
        }
      }
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    let diag = "";
    try {
      const diagResult = await sandbox.process.executeCommand(
        `echo "=== process ===" && ps aux | grep bridge | grep -v grep 2>&1; echo "=== port ===" && ss -tlnp 2>/dev/null | grep ${BRIDGE_PORT} || true; echo "=== log ===" && tail -50 ${bDir}/bridge.log 2>/dev/null || echo "no log"`,
      );
      diag = (diagResult.result ?? "").trim();
    } catch {
      diag = "failed to collect diagnostics";
    }

    console.error(`[sandbox:${sandboxId}] Bridge failed to start:\n${diag}`);
    throw new Error(
      `Bridge not listening on port ${BRIDGE_PORT} after ${(maxAttempts * intervalMs) / 1000}s. ` +
        `Diagnostics: ${diag.slice(0, 500)}`,
    );
  }

  async getSandboxState(sandboxId: string): Promise<string> {
    if (!this.provider) throw new Error("SandboxManager not initialized");
    const sandbox = await this.getCachedSandbox(sandboxId);
    try {
      await sandbox.refreshState();
    } catch {
      /* best-effort */
    }
    const state = sandbox.state ?? "unknown";
    if (state === "started") {
      this.startedAt.set(sandboxId, Date.now());
    }
    return state;
  }

  /** Get the Sandbox object (no WS required — used for direct SDK operations).
   *  Starts the sandbox if it is stopped. */
  private async ensureSandbox(sandboxId: string): Promise<SandboxInstance> {
    const session = this.sessions.get(sandboxId);
    const sandbox = session
      ? session.sandbox
      : await this.getCachedSandbox(sandboxId);

    await this.ensureSandboxStarted(sandbox);
    return sandbox;
  }

  /** Ensure we have an active WS connection to the sandbox bridge */
  private async ensureConnected(sandboxId: string): Promise<InternalSession> {
    let session = this.sessions.get(sandboxId);

    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
      // reconnectSandbox handles: fetching sandbox, starting if stopped,
      // restarting bridge, getting preview URL, and connecting with retry.
      // Pass the stored project name so the bridge gets the correct PROJECT_DIR.
      await this.reconnectSandbox(sandboxId, this.projectNames.get(sandboxId));
      session = this.sessions.get(sandboxId);
      if (!session)
        throw new Error(`Failed to reconnect to sandbox: ${sandboxId}`);
    }

    return session;
  }

  /**
   * Connect to the bridge WebSocket. If the bridge isn't running inside the
   * sandbox, restarts it immediately instead of burning time on doomed WS retries.
   */
  private async connectWithRetry(session: InternalSession): Promise<void> {
    const sid = session.sandboxId.slice(0, 8);
    const bridgeAlive = await this.quickBridgeCheck(session.sandbox);
    const isFirstConnect = !session.bridgeSessionId;
    console.log(
      `[bridge:${sid}] alive=${bridgeAlive} firstConnect=${isFirstConnect}`,
    );

    if (!bridgeAlive || isFirstConnect) {
      // Always restart on first connect (after app restart) so the bridge
      // picks up the latest uploaded script. Also restart if bridge is dead.
      console.log(
        `[bridge:${sid}] restarting bridge (${!bridgeAlive ? "dead" : "fresh session"})`,
      );
      await this.restartBridge(session);
      console.log(`[bridge:${sid}] bridge restarted, connecting WS`);
      await this.connectToBridge(session);
      console.log(`[bridge:${sid}] WS connected after restart`);
      return;
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[bridge:${sid}] WS connect attempt ${attempt}`);
        await this.connectToBridge(session);
        console.log(`[bridge:${sid}] WS connected on attempt ${attempt}`);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.log(
          `[bridge:${sid}] WS attempt ${attempt} failed: ${lastError.message}`,
        );
        if (attempt < 2) {
          try {
            const previewInfo =
              await session.sandbox.getPreviewLink(BRIDGE_PORT);
            session.previewUrl = previewInfo.url;
            session.previewToken = previewInfo.token ?? null;
          } catch {
            /* keep existing */
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    try {
      console.log(
        `[bridge:${sid}] WS failed, restarting bridge as last resort`,
      );
      await this.restartBridge(session);
      console.log(`[bridge:${sid}] bridge restarted, final WS connect`);
      await this.connectToBridge(session);
      console.log(`[bridge:${sid}] WS connected after restart`);
      return;
    } catch (err) {
      console.log(`[bridge:${sid}] final connect failed: ${err}`);
    }

    throw lastError || new Error("Failed to connect to bridge");
  }

  /** Quick (non-blocking) check if the bridge HTTP server is responding inside the sandbox */
  private async quickBridgeCheck(sandbox: SandboxInstance): Promise<boolean> {
    try {
      const result = await sandbox.process.executeCommand(
        `curl -sf http://localhost:${BRIDGE_PORT}/ 2>&1 || echo "BRIDGE_NOT_READY"`,
      );
      return (result.result ?? "").includes("bridge-ok");
    } catch {
      return false;
    }
  }

  private isContainerNotRunning(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("container is not running") || msg.includes("is not running");
  }

  /** Restart the bridge process inside the sandbox and refresh preview URL */
  private async restartBridge(session: InternalSession): Promise<void> {
    const { sandbox, projectDir, bridgeDir } = session;
    const sid = session.sandboxId.slice(0, 8);

    try {
      await sandbox.process.executeCommand(
        'pkill -f "node bridge.cjs" 2>/dev/null; pkill -f "node bridge.js" 2>/dev/null; pkill -f "opencode serve" 2>/dev/null; sleep 0.3',
      );
    } catch (err) {
      if (this.isContainerNotRunning(err)) {
        console.log(`[bridge:${sid}] container not running, restarting sandbox`);
        this.startedAt.delete(sandbox.id);
        await this.ensureSandboxStarted(sandbox);
        return;
      }
      throw err;
    }
    if (this.config.provider === "local") {
      await sandbox.process.executeCommand(
        `lsof -ti:${BRIDGE_PORT} | xargs kill -9 2>/dev/null || true`,
      );
    }

    const bridgeCode = getBridgeScript(BRIDGE_PORT, projectDir);
    console.log(
      `[bridge:${sid}] uploading bridge.cjs (${bridgeCode.length} bytes, has startOpenCodeServe: ${bridgeCode.includes("startOpenCodeServe")})`,
    );
    await sandbox.fs.uploadFile(
      Buffer.from(bridgeCode),
      `${bridgeDir}/bridge.cjs`,
    );

    const proxyBase = resolveProxyBaseUrl(this.config.proxyBaseUrl, this.config.provider);
    const useProxy = !!proxyBase;
    const homeDir = this.config.provider === "local" ? os.homedir() : HOME_DIR;

    // Read agent-limit settings from env (set by settings service)
    const agentLimits = SandboxManager.readAgentLimits();

    // Write opencode.json (always overwrite to keep config in sync)
    {
      // GPT-5.2 only supports "medium" for both reasoningEffort and textVerbosity (OpenCode bug #9969)
      const gpt52Opts = { reasoningEffort: "medium", textVerbosity: "medium" };
      const gpt52Variant = { reasoningEffort: "medium", textVerbosity: "medium" };
      const gpt52Fix = {
        options: gpt52Opts,
        variants: {
          none: gpt52Variant, minimal: gpt52Variant, low: gpt52Variant,
          medium: gpt52Variant, high: gpt52Variant, xhigh: gpt52Variant,
        },
      };
      const gpt52ModelOverrides = {
        "gpt-5.2": gpt52Fix,
        "gpt-5.2-chat-latest": gpt52Fix,
      };
    const openCodeConfig: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet-4-20250514",
      default_agent: "build",
      ...(agentLimits.globalMaxTokens ? { maxTokens: agentLimits.globalMaxTokens } : {}),
      provider: {
        ...(useProxy ? {
          anthropic: { options: { baseURL: "{env:ANTHROPIC_BASE_URL}" } },
          openai: {
            options: { baseURL: "{env:OPENAI_BASE_URL}" },
            models: gpt52ModelOverrides,
          },
        } : {
          openai: {
            models: gpt52ModelOverrides,
          },
        }),
      },
      agent: {
        build: {
          description: "Full development agent with all tools enabled",
          mode: "primary",
          prompt: `{file:${homeDir}/AGENTS.md}`,
          tools: { question: false },
          ...SandboxManager.agentTokenOpts(agentLimits.build.maxTokens ?? agentLimits.globalMaxTokens),
          ...SandboxManager.agentReasoningOpts(agentLimits.build.reasoningEffort),
          permission: { "*": { "*": "allow" } },
        },
        plan: {
          description: "Analysis and planning without making changes",
          mode: "primary",
          tools: { write: false, edit: false, bash: false, question: false },
          ...SandboxManager.agentTokenOpts(agentLimits.plan.maxTokens ?? agentLimits.globalMaxTokens),
          ...SandboxManager.agentReasoningOpts(agentLimits.plan.reasoningEffort),
          permission: { "*": { "*": "allow" } },
        },
        sisyphus: {
          description: "Orchestration agent for complex multi-step tasks",
          mode: "primary",
          model: "anthropic/claude-sonnet-4-20250514",
          prompt: SandboxManager.SISYPHUS_PROMPT,
          tools: { question: false },
          steps: agentLimits.sisyphus.maxSteps,
          ...SandboxManager.agentTokenOpts(agentLimits.sisyphus.maxTokens ?? agentLimits.globalMaxTokens),
          ...SandboxManager.agentReasoningOpts(agentLimits.sisyphus.reasoningEffort),
          permission: { "*": { "*": "allow" } },
        },
      },
      tools: { question: false },
      experimental: { mcp_timeout: 300000 },
      mcp: {
        "terminal-server": {
          type: "local",
          command: ["node", `${bridgeDir}/mcp-terminal-server.cjs`],
          timeout: 300000,
        },
        "lsp-server": {
          type: "local",
          command: ["node", `${bridgeDir}/mcp-lsp-server.cjs`],
          timeout: 300000,
        },
      },
    };
    const ocConfigDir = `${homeDir}/.config/opencode`;
      await sandbox.process.executeCommand(`mkdir -p '${ocConfigDir}/agents'`);
      // Upload MCP server scripts alongside config on reconnect
      const mcpLspCodeR = getMcpLspScript(BRIDGE_PORT);
      const mcpTermCodeR = getMcpTerminalScript(BRIDGE_PORT);
      const agentsMd = SandboxManager.buildSandboxInstructions(projectDir, this.config.provider === "local");
      await Promise.all([
        sandbox.fs.uploadFile(
          Buffer.from(JSON.stringify(openCodeConfig)),
          `${ocConfigDir}/opencode.json`,
        ),
        sandbox.fs.uploadFile(
          Buffer.from(SandboxManager.buildSisyphusAgentMd(
            agentLimits.sisyphus.maxSteps,
            agentLimits.sisyphus.maxTokens ?? agentLimits.globalMaxTokens,
            agentLimits.sisyphus.reasoningEffort,
          )),
          `${ocConfigDir}/agents/sisyphus.md`,
        ),
        sandbox.fs.uploadFile(
          Buffer.from(mcpTermCodeR),
          `${bridgeDir}/mcp-terminal-server.cjs`,
        ),
        sandbox.fs.uploadFile(
          Buffer.from(mcpLspCodeR),
          `${bridgeDir}/mcp-lsp-server.cjs`,
        ),
        sandbox.fs.uploadFile(Buffer.from(agentsMd), `${homeDir}/AGENTS.md`).catch(() => {}),
      ]);
      console.log(`[bridge:${sid}] wrote ${ocConfigDir}/opencode.json + agents + MCP scripts`);
    }

    // Ensure CA cert is installed (containers only — local provider uses host certs)
    const secretsProxyUrlR = resolveSecretsProxyUrl(
      this.config.secretsProxyBaseUrl, this.config.provider, this.config.secretsProxyPort,
    );
    const isDaytonaR = this.config.provider === "daytona";
    const secretsProxyAvailableR = isDaytonaR ? useProxy : !!secretsProxyUrlR;
    if (this.config.secretsProxyCaCert && secretsProxyAvailableR && this.config.provider !== "local") {
      try {
        await sandbox.fs.uploadFile(
          Buffer.from(this.config.secretsProxyCaCert),
          CA_CERT_PATH,
        );
        await sandbox.process.executeCommand(
          "sudo update-ca-certificates 2>/dev/null || true",
        );
        console.log(`[bridge:${sid}] CA cert installed`);
      } catch {
        console.log(`[bridge:${sid}] CA cert install failed (non-fatal)`);
      }
    }

    const bridgeSessionId = `bridge-restart-${Date.now()}`;
    session.bridgeSessionId = bridgeSessionId;
    await sandbox.process.createSession(bridgeSessionId);
    const daytonaApiKeyR = process.env["DAYTONA_API_KEY"] || "";
    const daytonaApiUrlR =
      process.env["DAYTONA_API_URL"] || "https://app.daytona.io/api";
    const projectIdForBridge = this.projectIds.get(sandbox.id) || "";
    const apexProxyForBridge = proxyBase || this.config.proxyBaseUrl;
    const placeholderR = this.config.proxyAuthToken || "sk-proxy-placeholder";
    const envParts = [
      ...(useProxy
        ? [
            `ANTHROPIC_API_KEY="${placeholderR}"`,
            `ANTHROPIC_BASE_URL="${proxyBase}/llm-proxy/anthropic/v1"`,
            `OPENAI_API_KEY="${placeholderR}"`,
            `OPENAI_BASE_URL="${proxyBase}/llm-proxy/openai/v1"`,
          ]
        : isDaytonaR
          ? [
              `ANTHROPIC_API_KEY="${placeholderR}"`,
              `OPENAI_API_KEY="${placeholderR}"`,
            ]
          : [
              `ANTHROPIC_API_KEY="${this.config.anthropicApiKey}"`,
              `OPENAI_API_KEY="${this.config.openaiApiKey}"`,
            ]),
      `DAYTONA_API_KEY="${daytonaApiKeyR}"`,
      `DAYTONA_API_URL="${daytonaApiUrlR}"`,
      `DAYTONA_SANDBOX_ID="${sandbox.id}"`,
      `APEX_PROXY_BASE_URL="${apexProxyForBridge}"`,
      `APEX_PROJECT_ID="${projectIdForBridge}"`,
      `OPENCODE_CONFIG="${homeDir}/.config/opencode/opencode.json"`,
      ...(this.config.provider === "local"
        ? []
        : [`HOME="/home/daytona"`, `PATH="/home/daytona/.opencode/bin:$PATH"`]),
      ...(secretsProxyAvailableR
        ? isDaytonaR
          ? [
              // For Daytona: use tunnel client on localhost:9339, pass tunnel URL to bridge
              `HTTPS_PROXY="http://localhost:9339"`,
              `HTTP_PROXY="http://localhost:9339"`,
              `https_proxy="http://localhost:9339"`,
              `http_proxy="http://localhost:9339"`,
              `NO_PROXY="localhost,127.0.0.1,0.0.0.0"`,
              `no_proxy="localhost,127.0.0.1,0.0.0.0"`,
              `NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"`,
              `SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"`,
              `REQUESTS_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
              `CURL_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
              `TUNNEL_ENDPOINT_URL="${proxyBase}/tunnel"`,
            ]
          : [
              // For other providers: use direct proxy URL
              `HTTPS_PROXY="${secretsProxyUrlR}"`,
              `HTTP_PROXY="${secretsProxyUrlR}"`,
              `https_proxy="${secretsProxyUrlR}"`,
              `http_proxy="${secretsProxyUrlR}"`,
              `NO_PROXY="localhost,127.0.0.1,0.0.0.0"`,
              `no_proxy="localhost,127.0.0.1,0.0.0.0"`,
              `NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"`,
              `SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"`,
              `REQUESTS_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
              `CURL_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
            ]
        : []),
    ];
    for (const [name, placeholder] of Object.entries(this.config.secretPlaceholders)) {
      envParts.push(`${name}="${placeholder}"`);
    }
    {
      const checkModules = await sandbox.process.executeCommand(
        `test -d '${bridgeDir}/node_modules/ws' && echo exists || echo missing`,
      );
      if ((checkModules.result ?? "").includes("missing")) {
        console.log(`[bridge:${sid}] bridge deps missing, installing ws + node-pty`);
        const bridgePkg = JSON.stringify({
          name: "apex-bridge",
          private: true,
          dependencies: { ws: "^8.0.0", "node-pty": "0.10.1" },
        });
        await sandbox.fs.uploadFile(Buffer.from(bridgePkg), `${bridgeDir}/package.json`);
        await sandbox.process.executeCommand(`cd '${bridgeDir}' && npm install --no-audit --no-fund 2>&1`);
      }
    }

    // Skip opencode upgrade — recent versions introduce a built-in `question`
    // tool that hangs in serve mode (opencode#16664). The snapshot version works.
    console.log(`[bridge:${sid}] opencode upgrade skipped (question tool bug in newer versions)`);

    await sandbox.process.executeSessionCommand(bridgeSessionId, {
      command: `cd ${bridgeDir} && ${envParts.join(" ")} node bridge.cjs > ${bridgeDir}/bridge.log 2>&1`,
      async: true,
    });

    await this.waitForBridge(sandbox, session.sandboxId, undefined, undefined, bridgeDir);

    const previewInfo = await sandbox.getPreviewLink(BRIDGE_PORT);
    session.previewUrl = previewInfo.url;
    session.previewToken = previewInfo.token ?? null;
  }

  /**
   * Write multiple files inside the sandbox in a single `exec` call.
   * Each file's content is base64-encoded and decoded inline, avoiding
   * one `container exec` round-trip per file.
   */
  private async batchWriteFiles(
    sandbox: SandboxInstance,
    files: { path: string; content: string }[],
  ): Promise<void> {
    if (files.length === 0) return;

    if (this.config.provider === "local") {
      // Local provider: use native fs.uploadFile (fast, no shell arg limits)
      for (const f of files) {
        await sandbox.fs.uploadFile(Buffer.from(f.content), f.path);
      }
      return;
    }

    // Container providers: batch into a single shell exec to reduce round-trips
    const parts: string[] = [];
    const dirs = new Set<string>();
    for (const f of files) {
      const dir = f.path.replace(/\/[^/]+$/, "");
      if (dir && !dirs.has(dir)) {
        dirs.add(dir);
        parts.push(`mkdir -p '${dir}'`);
      }
    }
    for (const f of files) {
      const b64 = Buffer.from(f.content).toString("base64");
      parts.push(`printf '%s' '${b64}' | base64 -d > '${f.path}'`);
    }
    await sandbox.process.executeCommand(parts.join(" && "));
  }

  private async installBridge(
    session: InternalSession,
    gitRepo?: string,
    agentType?: string,
    gitBranch?: string,
    createBranch?: string,
  ): Promise<void> {
    session.status = "starting_bridge";
    this.emit("status", session.sandboxId, "starting_bridge");

    const { sandbox, projectDir, bridgeDir } = session;
    const sid = sandbox.id.slice(0, 8);
    const t0 = Date.now();
    const log = (msg: string) =>
      console.log(`[install:${sid}] ${msg} (+${Date.now() - t0}ms)`);

    // ── Prepare all file contents upfront (CPU only, no I/O) ──
    const proxyBaseUrlForEnv = resolveProxyBaseUrl(this.config.proxyBaseUrl, this.config.provider);
    const useProxyI = !!proxyBaseUrlForEnv;

    const bridgeCode = getBridgeScript(BRIDGE_PORT, projectDir);
    const mcpCode = getMcpTerminalScript(BRIDGE_PORT);
    const mcpLspCode = getMcpLspScript(BRIDGE_PORT);

    const isLocalProvider = this.config.provider === "local";
    const homeDir = isLocalProvider ? os.homedir() : HOME_DIR;

    const sandboxInstructions = SandboxManager.buildSandboxInstructions(projectDir, isLocalProvider);

    // Read agent-limit settings from env (set by settings service)
    const agentLimitsI = SandboxManager.readAgentLimits();

    // GPT-5.2 only supports "medium" for both reasoningEffort and textVerbosity (OpenCode bug #9969)
    const gpt52OptsI = { reasoningEffort: "medium", textVerbosity: "medium" };
    const gpt52VariantI = { reasoningEffort: "medium", textVerbosity: "medium" };
    const gpt52FixI = {
      options: gpt52OptsI,
      variants: {
        none: gpt52VariantI, minimal: gpt52VariantI, low: gpt52VariantI,
        medium: gpt52VariantI, high: gpt52VariantI, xhigh: gpt52VariantI,
      },
    };
    const gpt52ModelOverridesI = {
      "gpt-5.2": gpt52FixI,
      "gpt-5.2-chat-latest": gpt52FixI,
    };
    const openCodeConfig: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet-4-20250514",
      default_agent: "build",
      ...(agentLimitsI.globalMaxTokens ? { maxTokens: agentLimitsI.globalMaxTokens } : {}),
      provider: {
        ...(useProxyI ? {
          anthropic: { options: { baseURL: "{env:ANTHROPIC_BASE_URL}" } },
          openai: {
            options: { baseURL: "{env:OPENAI_BASE_URL}" },
            models: gpt52ModelOverridesI,
          },
        } : {
          openai: {
            models: gpt52ModelOverridesI,
          },
        }),
      },
      agent: {
        build: {
          description: "Full development agent with all tools enabled",
          mode: "primary",
          prompt: `{file:${homeDir}/AGENTS.md}`,
          tools: { question: false },
          ...SandboxManager.agentTokenOpts(agentLimitsI.build.maxTokens ?? agentLimitsI.globalMaxTokens),
          ...SandboxManager.agentReasoningOpts(agentLimitsI.build.reasoningEffort),
          permission: { "*": { "*": "allow" } },
        },
        plan: {
          description: "Analysis and planning without making changes",
          mode: "primary",
          tools: { write: false, edit: false, bash: false, question: false },
          ...SandboxManager.agentTokenOpts(agentLimitsI.plan.maxTokens ?? agentLimitsI.globalMaxTokens),
          ...SandboxManager.agentReasoningOpts(agentLimitsI.plan.reasoningEffort),
          permission: { "*": { "*": "allow" } },
        },
        sisyphus: {
          description: "Orchestration agent for complex multi-step tasks with retry logic",
          mode: "primary",
          model: "anthropic/claude-sonnet-4-20250514",
          prompt: SandboxManager.SISYPHUS_PROMPT,
          tools: { question: false },
          steps: agentLimitsI.sisyphus.maxSteps,
          ...SandboxManager.agentTokenOpts(agentLimitsI.sisyphus.maxTokens ?? agentLimitsI.globalMaxTokens),
          ...SandboxManager.agentReasoningOpts(agentLimitsI.sisyphus.reasoningEffort),
          permission: { "*": { "*": "allow" } },
        },
      },
      tools: { question: false },
      experimental: { mcp_timeout: 300000 },
      mcp: {
        "terminal-server": {
          type: "local",
          command: ["node", `${bridgeDir}/mcp-terminal-server.cjs`],
          timeout: 300000,
        },
        "lsp-server": {
          type: "local",
          command: ["node", `${bridgeDir}/mcp-lsp-server.cjs`],
          timeout: 300000,
        },
      },
    };

    const secretsProxyUrl = resolveSecretsProxyUrl(
      this.config.secretsProxyBaseUrl, this.config.provider, this.config.secretsProxyPort,
    );
    const isDaytonaI = this.config.provider === "daytona";
    const secretsProxyAvailableI = isDaytonaI ? useProxyI : !!secretsProxyUrl;

    // ── Exec 1: Write infra files (bridge, config, agents) ──
    // All config goes under HOME — never write to the project working directory.
    const ocConfigDir = `${homeDir}/.config/opencode`;
    await sandbox.process.executeCommand(
      `mkdir -p '${ocConfigDir}/agents' '${bridgeDir}'`,
    );

    const bridgeFiles: { path: string; content: string }[] = [
      { path: `${bridgeDir}/bridge.cjs`, content: bridgeCode },
    ];
    const mcpFiles: { path: string; content: string }[] = [
      { path: `${bridgeDir}/mcp-terminal-server.cjs`, content: mcpCode },
      { path: `${bridgeDir}/mcp-lsp-server.cjs`, content: mcpLspCode },
    ];
    const configFiles: { path: string; content: string }[] = [
      { path: `${ocConfigDir}/opencode.json`, content: JSON.stringify(openCodeConfig) },
      { path: `${ocConfigDir}/agents/sisyphus.md`, content: SandboxManager.buildSisyphusAgentMd(
        agentLimitsI.sisyphus.maxSteps,
        agentLimitsI.sisyphus.maxTokens ?? agentLimitsI.globalMaxTokens,
        agentLimitsI.sisyphus.reasoningEffort,
      ) },
    ];
    const skipIfExistsFiles: { path: string; content: string }[] = [
      { path: `${homeDir}/AGENTS.md`, content: sandboxInstructions },
    ];
    const existCheck = await sandbox.process.executeCommand(
      skipIfExistsFiles.map(f => `test -f '${f.path}' && echo '${f.path}'`).join("; ") + " || true",
    );
    const existingPaths = new Set(
      (existCheck.result ?? "").split("\n").map(l => l.trim()).filter(Boolean),
    );
    const promptFiles = skipIfExistsFiles.filter(f => !existingPaths.has(f.path));
    if (this.config.secretsProxyCaCert && secretsProxyAvailableI && !isLocalProvider) {
      configFiles.push({ path: CA_CERT_PATH, content: this.config.secretsProxyCaCert });
    }

    const writeInfraTask = Promise.all([
      this.batchWriteFiles(sandbox, bridgeFiles),
      this.batchWriteFiles(sandbox, mcpFiles),
      this.batchWriteFiles(sandbox, [...configFiles, ...promptFiles]),
    ]).then(() => log("infra files written"));

    // ── Exec 2: git clone/init (parallel with infra writes, projectDir must be empty for clone) ──
    const gitTask = (async () => {
      if (gitRepo) {
        this.emit("status", session.sandboxId, "cloning_repo");
        await sandbox.process.executeCommand(`mkdir -p '${projectDir}'`);
        const isCommitSha = gitBranch && /^[0-9a-f]{7,40}$/i.test(gitBranch);
        const branchArg = (gitBranch && !isCommitSha) ? gitBranch : undefined;
        const branchFlag = branchArg ? ` --branch ${branchArg}` : '';
        let cloneUrl = gitRepo;
        if (this.config.githubToken && gitRepo.includes("github.com")) {
          cloneUrl = gitRepo.replace(
            /^https:\/\/github\.com/,
            `https://x-access-token:${this.config.githubToken}@github.com`,
          );
        }
        await sandbox.process.executeCommand(`git clone${branchFlag} ${cloneUrl} .`, projectDir);
        if (isCommitSha) {
          await sandbox.process.executeCommand(`git checkout ${gitBranch}`, projectDir);
        }
        if (createBranch) {
          const safeBranch = createBranch.replace(/[^a-zA-Z0-9/_.-]/g, "");
          await sandbox.process.executeCommand(`git checkout -b "${safeBranch}"`, projectDir);
        }
      } else {
        await sandbox.process.executeCommand(`mkdir -p '${projectDir}' && git init '${projectDir}'`);
      }
      if (this.config.gitUserName && this.config.gitUserEmail) {
        const safeName = this.config.gitUserName.replace(/"/g, '\\"');
        const safeEmail = this.config.gitUserEmail.replace(/"/g, '\\"');
        await sandbox.process.executeCommand(
          `git config --global user.name "${safeName}" && git config --global user.email "${safeEmail}"`,
        );
      }
      log("git done");
    })();

    // ── Exec 3: Update CA certs if needed (parallel, containers only) ──
    const caCertTask = (this.config.secretsProxyCaCert && secretsProxyAvailableI && this.config.provider !== "local")
      ? writeInfraTask.then(() =>
          sandbox.process.executeCommand("sudo update-ca-certificates 2>/dev/null || true"),
        ).then(() => log("CA cert updated"))
      : Promise.resolve();

    await Promise.all([writeInfraTask, gitTask, caCertTask]);
    log("setup complete");

    // ── Exec 4: Start bridge ────────────────────────
    const bridgeSessionId = `bridge-${session.id}`;
    session.bridgeSessionId = bridgeSessionId;
    await sandbox.process.createSession(bridgeSessionId);

    const daytonaApiKey = process.env["DAYTONA_API_KEY"] || "";
    const daytonaApiUrl =
      process.env["DAYTONA_API_URL"] || "https://app.daytona.io/api";
    const projectIdI = this.projectIds.get(sandbox.id) || "";
    const apexProxyForBridgeI = proxyBaseUrlForEnv || this.config.proxyBaseUrl;

    const placeholderI = this.config.proxyAuthToken || "sk-proxy-placeholder";
    const envParts = [
      ...(useProxyI
        ? [
            `ANTHROPIC_API_KEY="${placeholderI}"`,
            `ANTHROPIC_BASE_URL="${proxyBaseUrlForEnv}/llm-proxy/anthropic/v1"`,
            `OPENAI_API_KEY="${placeholderI}"`,
            `OPENAI_BASE_URL="${proxyBaseUrlForEnv}/llm-proxy/openai/v1"`,
          ]
        : isDaytonaI
          ? [
              `ANTHROPIC_API_KEY="${placeholderI}"`,
              `OPENAI_API_KEY="${placeholderI}"`,
            ]
          : [
              `ANTHROPIC_API_KEY="${this.config.anthropicApiKey}"`,
              `OPENAI_API_KEY="${this.config.openaiApiKey}"`,
            ]),
      `DAYTONA_API_KEY="${daytonaApiKey}"`,
      `DAYTONA_API_URL="${daytonaApiUrl}"`,
      `DAYTONA_SANDBOX_ID="${sandbox.id}"`,
      `APEX_PROXY_BASE_URL="${apexProxyForBridgeI}"`,
      `APEX_PROJECT_ID="${projectIdI}"`,
      `OPENCODE_CONFIG="${homeDir}/.config/opencode/opencode.json"`,
      ...(this.config.provider === "local"
        ? []
        : [`HOME="/home/daytona"`, `PATH="/home/daytona/.opencode/bin:$PATH"`]),
      ...(secretsProxyAvailableI
        ? isDaytonaI
          ? [
              // For Daytona: use tunnel client on localhost:9339, pass tunnel URL to bridge
              `HTTPS_PROXY="http://localhost:9339"`,
              `HTTP_PROXY="http://localhost:9339"`,
              `https_proxy="http://localhost:9339"`,
              `http_proxy="http://localhost:9339"`,
              `NO_PROXY="localhost,127.0.0.1,0.0.0.0"`,
              `no_proxy="localhost,127.0.0.1,0.0.0.0"`,
              `NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"`,
              `SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"`,
              `REQUESTS_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
              `CURL_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
              `TUNNEL_ENDPOINT_URL="${proxyBaseUrlForEnv}/tunnel"`,
            ]
          : [
              // For other providers: use direct proxy URL
              `HTTPS_PROXY="${secretsProxyUrl}"`,
              `HTTP_PROXY="${secretsProxyUrl}"`,
              `https_proxy="${secretsProxyUrl}"`,
              `http_proxy="${secretsProxyUrl}"`,
              `NO_PROXY="localhost,127.0.0.1,0.0.0.0"`,
              `no_proxy="localhost,127.0.0.1,0.0.0.0"`,
              `NODE_EXTRA_CA_CERTS="${CA_CERT_PATH}"`,
              `SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"`,
              `REQUESTS_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
              `CURL_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"`,
            ]
        : []),
    ];
    for (const [name, placeholder] of Object.entries(this.config.secretPlaceholders)) {
      envParts.push(`${name}="${placeholder}"`);
    }

    if (isLocalProvider) {
      await sandbox.process.executeCommand(
        `lsof -ti:${BRIDGE_PORT} | xargs kill -9 2>/dev/null || true`,
      );
    }

    // Install bridge dependencies (ws, node-pty) if missing
    {
      const checkModules = await sandbox.process.executeCommand(
        `test -d '${bridgeDir}/node_modules/ws' && echo exists || echo missing`,
      );
      if ((checkModules.result ?? "").includes("missing")) {
        log("installing bridge deps (ws, node-pty)…");
        const bridgePkg = JSON.stringify({
          name: "apex-bridge",
          private: true,
          dependencies: { ws: "^8.0.0", "node-pty": "0.10.1" },
        });
        await sandbox.fs.uploadFile(Buffer.from(bridgePkg), `${bridgeDir}/package.json`);
        await sandbox.process.executeCommand(`cd '${bridgeDir}' && npm install --no-audit --no-fund 2>&1`);
        log("bridge deps installed");
      }
    }

    // Skip opencode upgrade — recent versions introduce a built-in `question`
    // tool that hangs in serve mode (opencode#16664). The snapshot version works.
    log("opencode upgrade skipped (question tool bug in newer versions)");

    await sandbox.process.executeSessionCommand(bridgeSessionId, {
      command: `cd ${bridgeDir} && ${envParts.join(" ")} node bridge.cjs > ${bridgeDir}/bridge.log 2>&1`,
      async: true,
    });

    // ── Exec 5+: waitForBridge (fast polling) + connect ─
    await this.waitForBridge(sandbox, session.sandboxId, undefined, undefined, bridgeDir);
    log("bridge ready");

    const installPreviewInfo = await sandbox.getPreviewLink(BRIDGE_PORT);
    session.previewUrl = installPreviewInfo.url;
    session.previewToken = installPreviewInfo.token ?? null;

    await this.connectWithRetry(session);
    log("connected — install complete");
  }

  private async connectToBridge(session: InternalSession): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!session.previewUrl) {
        reject(new Error("No preview URL"));
        return;
      }

      if (session.ws) {
        try {
          session.ws.close();
        } catch {
          /* ignore */
        }
        session.ws = null;
      }

      const wsUrl = session.previewUrl
        .replace("https://", "wss://")
        .replace("http://", "ws://");

      const headers: Record<string, string> = {
        "X-Daytona-Skip-Preview-Warning": "true",
      };
      if (session.previewToken) {
        headers["x-daytona-preview-token"] = session.previewToken;
      }

      const ws = new WebSocket(wsUrl, { headers, handshakeTimeout: 5000 });
      session.ws = ws;

      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error("Connection timeout (5s)"));
      }, 5000);

      ws.on("open", () => {
        clearTimeout(connectTimeout);
        session.status = "connecting";
        this.emit("status", session.sandboxId, "connecting");
      });

      ws.on("message", (data) => {
        try {
          const msg: BridgeMessage = JSON.parse(data.toString());
          session.messages.push(msg);

          if (msg.type === "bridge_ready") {
            session.status = "running";
            this.emit("status", session.sandboxId, "running");
            resolve();
          } else if (msg.type === "claude_message") {
            this.handleClaudeMessage(session, msg.data);
          } else if (msg.type === "claude_exit") {
            session.status = msg.code === 0 ? "completed" : "error";
            session.endTime = Date.now();
            if (msg.code !== 0) {
              session.error = `Exit code: ${msg.code}`;
            }
            this.emit(
              "status",
              session.sandboxId,
              session.status,
              session.error,
            );
          } else if (msg.type === "terminal_created") {
            this.emit("terminal_created", session.sandboxId, msg);
          } else if (msg.type === "terminal_output") {
            this.emit("terminal_output", session.sandboxId, msg);
          } else if (msg.type === "terminal_exit") {
            this.emit("terminal_exit", session.sandboxId, msg);
          } else if (msg.type === "terminal_error") {
            this.emit("terminal_error", session.sandboxId, msg);
          } else if (msg.type === "terminal_list") {
            this.emit("terminal_list", session.sandboxId, msg);
          } else if (msg.type === "file_changed") {
            this.emit("file_changed", session.sandboxId, msg.dirs);
          } else if (msg.type === "ports_update") {
            this.lastPortsBySandbox.set(session.sandboxId, msg);
            this.emit("ports_update", session.sandboxId, msg);
          } else if (msg.type === "lsp_response") {
            this.emit("lsp_response", session.sandboxId, msg);
          } else if (msg.type === "lsp_status") {
            this.emit("lsp_status", session.sandboxId, msg);
          } else if (msg.type === "ask_user_pending") {
            session.status = "waiting_for_input";
          } else if (msg.type === "ask_user_resolved") {
            session.status = "running";
          } else if (msg.type === "claude_error") {
            session.status = "error";
            session.error = msg.error;
            session.endTime = Date.now();
            this.emit("status", session.sandboxId, "error", msg.error);
          }

          this.emit("message", session.sandboxId, msg);
        } catch {
          // Not JSON
        }
      });

      ws.on("close", (code) => {
        if (session.status !== "completed" && session.status !== "error") {
          session.status = "error";
          session.error = `Disconnected (code: ${code})`;
          session.endTime = Date.now();
          this.emit("status", session.sandboxId, "error", session.error);
        }
      });

      ws.on("error", (err) => {
        clearTimeout(connectTimeout);
        reject(err);
      });

      ws.on("unexpected-response", (_req, res) => {
        clearTimeout(connectTimeout);
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 50)}`));
        });
      });
    });
  }

  private handleClaudeMessage(session: SandboxSession, msg: any) {
    if (msg.type === "assistant") {
      const aMsg = msg as ClaudeAssistantMessage;
      void aMsg;
    } else if (msg.type === "result") {
      const rMsg = msg as ClaudeResultMessage;
      session.result = rMsg.result;
      session.costUsd = rMsg.total_cost_usd;
    }
  }
}
