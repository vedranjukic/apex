/**
 * SandboxManager – creates / connects / manages Daytona sandboxes
 * and the WebSocket bridge that runs inside each one.
 *
 * Adapted from hack/ws-orchestrator (orchestrator-v2.ts).
 */

import WebSocket from "ws";
import { Daytona, Sandbox } from "@daytonaio/sdk";
import crypto from "crypto";
import { EventEmitter } from "events";
import {
  BridgeMessage,
  BridgeTerminalCreated,
  BridgeTerminalOutput,
  BridgeTerminalExit,
  BridgeTerminalError,
  BridgeTerminalList,
  BridgePortsUpdate,
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

const BRIDGE_PORT = 8080;
const VSCODE_PORT = 9090;
const BRIDGE_DIR = "/home/daytona/bridge";
const HOME_DIR = "/home/daytona";

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
  sandbox: Sandbox;
  ws: WebSocket | null;
  projectDir: string;
};

/** TTL for cached Sandbox objects (avoid redundant daytona.get() calls) */
const SANDBOX_CACHE_TTL = 60_000;
/** How long to trust a "started" state without re-checking */
const STARTED_STATE_TTL = 30_000;

export class SandboxManager extends EventEmitter {
  private config: Required<OrchestratorConfig>;
  private daytona: Daytona | null = null;
  private sessions: Map<string, InternalSession> = new Map();
  private sandboxCache = new Map<
    string,
    { sandbox: Sandbox; cachedAt: number }
  >();
  private startedAt = new Map<string, number>();
  private reconnectPromises = new Map<string, Promise<void>>();
  private projectNames = new Map<string, string>();

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = {
      anthropicApiKey:
        config.anthropicApiKey || process.env["ANTHROPIC_API_KEY"] || "",
      snapshot:
        config.snapshot || process.env["DAYTONA_SNAPSHOT"] || "daytona-apex-2",
      timeoutMs: config.timeoutMs || 600000,
    };
  }

  async initialize(): Promise<void> {
    this.daytona = new Daytona();
  }

  /** Store a sandboxId → projectName mapping so reconnections use the correct project directory. */
  registerProjectName(sandboxId: string, projectName: string): void {
    if (projectName) this.projectNames.set(sandboxId, projectName);
  }

  /** Create a sandbox, install bridge, return the sandboxId. */
  async createSandbox(
    snapshot?: string,
    projectName?: string,
    gitRepo?: string,
  ): Promise<string> {
    if (!this.daytona) throw new Error("SandboxManager not initialized");

    const sandbox = await this.daytona.create({
      snapshot: snapshot || this.config.snapshot,
      autoStopInterval: 0,
    });

    if (projectName) this.projectNames.set(sandbox.id, projectName);

    const projectSlug = projectName ? slugify(projectName) : null;
    const projectDir = projectSlug ? `${HOME_DIR}/${projectSlug}` : HOME_DIR;

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
    };
    this.sessions.set(sandbox.id, session);

    // Upload and start bridge
    await this.installBridge(session, gitRepo);

    return sandbox.id;
  }

  /**
   * Reconnect to an existing sandbox that was created in a previous process.
   * Deduplicates concurrent calls — if a reconnect is already in progress
   * for this sandbox, callers wait for the same promise.
   */
  async reconnectSandbox(
    sandboxId: string,
    projectName?: string,
  ): Promise<void> {
    if (!this.daytona) throw new Error("SandboxManager not initialized");

    if (projectName) this.projectNames.set(sandboxId, projectName);

    const existing = this.sessions.get(sandboxId);
    if (existing?.ws?.readyState === WebSocket.OPEN) return;

    const inflight = this.reconnectPromises.get(sandboxId);
    if (inflight) {
      await inflight;
      return;
    }

    const promise = this.doReconnect(sandboxId, projectName);
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
  ): Promise<void> {
    const t0 = Date.now();
    const log = (msg: string) =>
      console.log(
        `[reconnect:${sandboxId.slice(0, 8)}] ${msg} (+${Date.now() - t0}ms)`,
      );

    // Hard timeout so doReconnect never blocks forever
    const RECONNECT_TIMEOUT = 30_000;

    const work = async () => {
      log("start");
      const sandbox = await this.getCachedSandbox(sandboxId);
      log("got sandbox object");

      const resolvedName = projectName || this.projectNames.get(sandboxId);
      const projectSlug = resolvedName ? slugify(resolvedName) : null;
      const projectDir = projectSlug ? `${HOME_DIR}/${projectSlug}` : HOME_DIR;

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
      };
      if (existing && resolvedName) {
        existing.projectDir = projectDir;
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
            Buffer.from(getBridgeScript(BRIDGE_PORT, session.projectDir)),
            `${BRIDGE_DIR}/bridge.js`,
          )
          .catch(() => {
            /* best-effort */
          }),
      ]);
      session.previewUrl = (previewInfo as any).url;
      session.previewToken = (previewInfo as any).token;
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
  private async getCachedSandbox(sandboxId: string): Promise<Sandbox> {
    const cached = this.sandboxCache.get(sandboxId);
    if (cached && Date.now() - cached.cachedAt < SANDBOX_CACHE_TTL) {
      return cached.sandbox;
    }
    if (!this.daytona) throw new Error("SandboxManager not initialized");
    const sandbox = await this.daytona.get(sandboxId);
    this.sandboxCache.set(sandboxId, { sandbox, cachedAt: Date.now() });
    return sandbox;
  }

  /**
   * Check if the sandbox is running and start it if not.
   * After starting, also restarts the bridge process.
   * Skips the expensive refreshData() API call when we have recent proof the
   * sandbox is running (active WS connection or recently verified state).
   */
  private async ensureSandboxStarted(sandbox: Sandbox): Promise<void> {
    const session = this.sessions.get(sandbox.id);
    if (session?.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    const lastConfirmed = this.startedAt.get(sandbox.id);
    if (lastConfirmed && Date.now() - lastConfirmed < STARTED_STATE_TTL) {
      return;
    }

    if (typeof (sandbox as any).refreshData === "function") {
      try {
        await (sandbox as any).refreshData();
      } catch {
        /* best-effort */
      }
    }

    const state: string = (sandbox as any).state ?? "unknown";
    if (state === "started") {
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
    chatId?: string,
    sessionId?: string | null,
    mode?: string,
    model?: string,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({
        type: "start_claude",
        prompt,
        chatId,
        sessionId: sessionId || undefined,
        mode: mode || undefined,
        model: model || undefined,
      }),
    );
    session.status = "running";
    this.emit("status", sandboxId, "running");
  }

  /** Stop (kill) the Claude process for a chat. Used for testing or manual cancellation. */
  async stopClaude(sandboxId: string, chatId?: string): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({
        type: "stop_claude",
        chatId: chatId || undefined,
      }),
    );
  }

  /** Send a user's answer to an AskUserQuestion back to the running Claude process. */
  async sendUserAnswer(
    sandboxId: string,
    chatId: string,
    toolUseId: string,
    answer: string,
  ): Promise<void> {
    const session = await this.ensureConnected(sandboxId);
    session.ws!.send(
      JSON.stringify({
        type: "claude_user_answer",
        chatId,
        toolUseId,
        answer,
      }),
    );
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
    const session = this.sessions.get(sandboxId);
    if (session) {
      session.ws?.close();
      this.sessions.delete(sandboxId);
      await session.sandbox.delete();
      return;
    }

    if (!this.daytona) throw new Error("SandboxManager not initialized");
    const sandbox = await this.daytona.get(sandboxId);
    await sandbox.delete();
  }

  /**
   * Stop a sandbox without deleting it (closes the WS session if tracked).
   */
  async stopSandbox(sandboxId: string): Promise<void> {
    this.sandboxCache.delete(sandboxId);
    this.startedAt.delete(sandboxId);
    this.projectNames.delete(sandboxId);
    const session = this.sessions.get(sandboxId);
    if (session) {
      session.ws?.close();
      this.sessions.delete(sandboxId);
      await session.sandbox.stop();
      return;
    }

    if (!this.daytona) throw new Error("SandboxManager not initialized");
    const sandbox = await this.daytona.get(sandboxId);
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

  // ── VS Code (code-server) methods ─────────────────

  /** Get a signed preview URL for the code-server running in the sandbox.
   *  Signed URLs embed the auth token in the URL itself — no headers needed. */
  async getVscodeUrl(
    sandboxId: string,
  ): Promise<{ url: string; token: string }> {
    const sandbox = await this.ensureSandbox(sandboxId);
    // Signed URL valid for 8 hours (28800 seconds)
    const signedInfo = await (sandbox as any).getSignedPreviewUrl(
      VSCODE_PORT,
      28800,
    );
    return { url: signedInfo.url, token: signedInfo.token };
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
    return { url: (previewInfo as any).url, token: (previewInfo as any).token };
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

  private static readonly LAYOUT_FILE = "/home/daytona/.apex-layout.json";

  /** Save layout state to the sandbox filesystem (via Daytona SDK, no bridge needed) */
  async saveLayout(sandboxId: string, data: LayoutData): Promise<void> {
    const sandbox = await this.ensureSandbox(sandboxId);
    const json = JSON.stringify(data, null, 2);
    await sandbox.fs.uploadFile(Buffer.from(json), SandboxManager.LAYOUT_FILE);
  }

  /** Load layout state from the sandbox filesystem (via Daytona SDK, no bridge needed) */
  async loadLayout(sandboxId: string): Promise<LayoutData | null> {
    try {
      const sandbox = await this.ensureSandbox(sandboxId);
      const result = await sandbox.process.executeCommand(
        `cat ${SandboxManager.LAYOUT_FILE} 2>/dev/null || echo ""`,
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
    sandbox: Sandbox,
    sandboxId: string,
    maxAttempts = 10,
    intervalMs = 1500,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const check = await sandbox.process.executeCommand(
          `curl -sf http://localhost:${BRIDGE_PORT}/ 2>&1 || echo "BRIDGE_NOT_READY"`,
        );
        const output = (check.result ?? "").trim();
        if (output.includes("bridge-ok")) return;
      } catch {
        // executeCommand itself failed — sandbox might be slow, keep polling
      }
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    // Bridge never started — grab diagnostics
    let diag = "";
    try {
      const diagResult = await sandbox.process.executeCommand(
        `echo "=== process ===" && ps aux | grep bridge | grep -v grep 2>&1; echo "=== port ===" && ss -tlnp 2>/dev/null | grep ${BRIDGE_PORT} || true; echo "=== log ===" && tail -50 ${BRIDGE_DIR}/bridge.log 2>/dev/null || echo "no log"`,
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
    if (!this.daytona) throw new Error("SandboxManager not initialized");
    const sandbox = await this.getCachedSandbox(sandboxId);
    if (typeof (sandbox as any).refreshData === "function") {
      try {
        await (sandbox as any).refreshData();
      } catch {
        /* best-effort */
      }
    }
    const state = (sandbox as any).state ?? "unknown";
    if (state === "started") {
      this.startedAt.set(sandboxId, Date.now());
    }
    return state;
  }

  /** Get the Sandbox object (no WS required — used for direct SDK operations).
   *  Starts the sandbox if it is stopped. */
  private async ensureSandbox(sandboxId: string): Promise<Sandbox> {
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
            session.previewUrl = (previewInfo as any).url;
            session.previewToken = (previewInfo as any).token;
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
  private async quickBridgeCheck(sandbox: Sandbox): Promise<boolean> {
    try {
      const result = await sandbox.process.executeCommand(
        `curl -sf http://localhost:${BRIDGE_PORT}/ 2>&1 || echo "BRIDGE_NOT_READY"`,
      );
      return (result.result ?? "").includes("bridge-ok");
    } catch {
      return false;
    }
  }

  /** Restart the bridge process inside the sandbox and refresh preview URL */
  private async restartBridge(session: InternalSession): Promise<void> {
    const { sandbox, projectDir } = session;

    // Kill any existing bridge process and start a new one
    await sandbox.process.executeCommand(
      'pkill -f "node bridge.js" 2>/dev/null; sleep 0.3',
    );

    // Re-upload the bridge script so reconnected sandboxes get the latest code
    const bridgeCode = getBridgeScript(BRIDGE_PORT, projectDir);
    await sandbox.fs.uploadFile(
      Buffer.from(bridgeCode),
      `${BRIDGE_DIR}/bridge.js`,
    );

    const bridgeSessionId = `bridge-restart-${Date.now()}`;
    session.bridgeSessionId = bridgeSessionId;
    await sandbox.process.createSession(bridgeSessionId);
    const daytonaApiKeyR = process.env["DAYTONA_API_KEY"] || "";
    const daytonaApiUrlR =
      process.env["DAYTONA_API_URL"] || "https://app.daytona.io/api";
    await sandbox.process.executeSessionCommand(bridgeSessionId, {
      command: `cd ${BRIDGE_DIR} && ANTHROPIC_API_KEY="${this.config.anthropicApiKey}" DAYTONA_API_KEY="${daytonaApiKeyR}" DAYTONA_API_URL="${daytonaApiUrlR}" DAYTONA_SANDBOX_ID="${sandbox.id}" node bridge.js > ${BRIDGE_DIR}/bridge.log 2>&1`,
      async: true,
    });

    await this.waitForBridge(sandbox, session.sandboxId);

    // Refresh preview URL
    const previewInfo = await sandbox.getPreviewLink(BRIDGE_PORT);
    session.previewUrl = (previewInfo as any).url;
    session.previewToken = (previewInfo as any).token;
  }

  private async installBridge(
    session: InternalSession,
    gitRepo?: string,
  ): Promise<void> {
    session.status = "starting_bridge";
    this.emit("status", session.sandboxId, "starting_bridge");

    const { sandbox, projectDir } = session;

    await sandbox.fs.createFolder(BRIDGE_DIR, "755");

    if (projectDir && projectDir !== HOME_DIR) {
      await sandbox.fs.createFolder(projectDir, "755");
    }

    if (gitRepo) {
      this.emit("status", session.sandboxId, "cloning_repo");
      await sandbox.process.executeCommand(
        `git clone ${gitRepo} .`,
        projectDir,
      );
    } else {
      await sandbox.process.executeCommand("git init", projectDir);
    }

    const bridgeCode = getBridgeScript(BRIDGE_PORT, projectDir);
    await sandbox.fs.uploadFile(
      Buffer.from(bridgeCode),
      `${BRIDGE_DIR}/bridge.js`,
    );

    const mcpCode = getMcpTerminalScript(BRIDGE_PORT);
    await sandbox.fs.uploadFile(
      Buffer.from(mcpCode),
      `${BRIDGE_DIR}/mcp-terminal-server.js`,
    );

    const mcpConfig = JSON.stringify({
      mcpServers: {
        "terminal-server": {
          type: "stdio",
          command: "node",
          args: [`${BRIDGE_DIR}/mcp-terminal-server.js`],
          env: {},
        },
      },
    });
    await sandbox.fs.createFolder("/home/daytona/.claude", "755");
    await sandbox.fs.uploadFile(
      Buffer.from(mcpConfig),
      `${HOME_DIR}/.claude.json`,
    );

    const claudeMd = [
      "# Sandbox Environment",
      "",
      `Your working directory is \`${projectDir}\`. This IS the project root.`,
      "All project files (source code, configs, package.json, etc.) MUST be created",
      "directly in this directory — do NOT create a new subfolder for the app.",
      "When asked to build or create an app, initialize it here in the current directory.",
      "",
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
      "",
    ].join("\n");
    await sandbox.fs.uploadFile(
      Buffer.from(claudeMd),
      "/home/daytona/.claude/CLAUDE.md",
    );

    await sandbox.process.executeCommand("npm init -y", BRIDGE_DIR);
    const npmResult = await sandbox.process.executeCommand(
      "npm install ws node-pty 2>&1",
      BRIDGE_DIR,
    );
    const npmOutput = (npmResult.result ?? "").trim();
    if (npmOutput.includes("ERR!") || npmOutput.includes("error")) {
      console.error(
        `[sandbox:${sandbox.id}] npm install issues: ${npmOutput.slice(-500)}`,
      );
    }

    await sandbox.process.executeCommand(
      "which inotifywait >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq inotify-tools) 2>/dev/null || true",
    );

    const bridgeSessionId = `bridge-${session.id}`;
    session.bridgeSessionId = bridgeSessionId;
    await sandbox.process.createSession(bridgeSessionId);

    const daytonaApiKey = process.env["DAYTONA_API_KEY"] || "";
    const daytonaApiUrl =
      process.env["DAYTONA_API_URL"] || "https://app.daytona.io/api";

    await sandbox.process.executeSessionCommand(bridgeSessionId, {
      command: `cd ${BRIDGE_DIR} && ANTHROPIC_API_KEY="${this.config.anthropicApiKey}" DAYTONA_API_KEY="${daytonaApiKey}" DAYTONA_API_URL="${daytonaApiUrl}" DAYTONA_SANDBOX_ID="${sandbox.id}" node bridge.js > ${BRIDGE_DIR}/bridge.log 2>&1`,
      async: true,
    });

    const vscodeSessionId = `vscode-${session.id}`;
    try {
      await sandbox.process.createSession(vscodeSessionId);
      await sandbox.process.executeSessionCommand(vscodeSessionId, {
        command: `code-server --bind-addr 0.0.0.0:${VSCODE_PORT} --auth none --disable-telemetry ${projectDir} 2>&1 || true`,
        async: true,
      });
    } catch {
      // code-server not installed in this image – skip silently
    }

    await this.waitForBridge(sandbox, session.sandboxId);

    const installPreviewInfo = await sandbox.getPreviewLink(BRIDGE_PORT);
    session.previewUrl = (installPreviewInfo as any).url;
    session.previewToken = (installPreviewInfo as any).token;

    await this.connectWithRetry(session);
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
            this.emit("ports_update", session.sandboxId, msg);
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
