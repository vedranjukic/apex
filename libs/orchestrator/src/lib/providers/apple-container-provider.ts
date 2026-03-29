/**
 * Apple Container sandbox provider — manages lightweight Linux VMs via
 * Apple's `container` CLI on macOS (Apple silicon).
 *
 * The CLI is invoked through `child_process.execFile`, so no npm dependency
 * is required.  The sandbox container image (e.g. `daytonaio/apex-default`)
 * is OCI-compatible and has the Daytona daemon baked in.
 *
 * File system, process, and git operations are implemented via
 * `container exec`, mirroring the Docker provider's approach.
 */

import { execFile as execFileCb } from "child_process";
import crypto from "crypto";
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
  ExecuteCommandResult,
  SessionCommandOpts,
} from "./types.js";

const DEFAULT_IMAGE = "daytonaio/apex-default:0.2.1-m";
const LABEL_SANDBOX = "apex.sandbox";
const CONTAINER_USER = "daytona";
const CONTAINER_BIN = "container";
const DEFAULT_MEMORY_MB = 3072;

// ── JSON shapes returned by the `container` CLI ──────

interface ContainerNetwork {
  ipv4Address?: string;
  ipv4Gateway?: string;
  macAddress?: string;
  hostname?: string;
  network?: string;
}

interface ContainerInfo {
  status: string;
  networks?: ContainerNetwork[];
  startedDate?: number;
  configuration: {
    id: string;
    labels: Record<string, string>;
    image?: { reference?: string };
    [key: string]: unknown;
  };
}

// ── Helpers ──────────────────────────────────────────

function mapContainerState(status: string): SandboxState {
  switch (status) {
    case "running":
      return "started";
    case "stopped":
    case "created":
      return "stopped";
    case "starting":
      return "starting";
    case "stopping":
      return "stopping";
    default:
      return "unknown";
  }
}

function extractIp(networks?: ContainerNetwork[]): string {
  if (!networks?.length) return "127.0.0.1";
  const addr = networks[0].ipv4Address;
  if (!addr) return "127.0.0.1";
  return addr.split("/")[0];
}

/** Shell out to the `container` CLI and collect output. */
async function runContainerCmd(
  args: string[],
  opts: { maxBuffer?: number; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    execFileCb(
      CONTAINER_BIN,
      args,
      { maxBuffer: opts.maxBuffer ?? 50 * 1024 * 1024, timeout: opts.timeout ?? 60_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code === "string") {
          reject(
            new Error(
              error.code === "ENOENT"
                ? "Apple container CLI not found. Install with: brew install container"
                : `container CLI error: ${error.message}`,
            ),
          );
          return;
        }
        const exitCode = error
          ? (error as unknown as { status?: number }).status ?? 1
          : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      },
    );
  });
}

/** Run a command inside a running container via `container exec`. */
async function execInContainer(
  containerId: string,
  cmd: string[],
  opts: { workingDir?: string; user?: string; detach?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args: string[] = ["exec"];

  if (opts.detach) args.push("--detach");
  if (opts.user) args.push("--user", opts.user);
  else args.push("--user", CONTAINER_USER);
  if (opts.workingDir) args.push("--workdir", opts.workingDir);

  args.push(containerId, ...cmd);

  if (opts.detach) {
    await runContainerCmd(args);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  return runContainerCmd(args);
}

/** Parse the JSON array returned by `container inspect` or `container list --format json`. */
function parseContainerInfoArray(raw: string): ContainerInfo[] {
  try {
    return JSON.parse(raw) as ContainerInfo[];
  } catch {
    throw new Error(`Failed to parse container CLI JSON output: ${raw.slice(0, 200)}`);
  }
}

// ── AppleContainerInstance ───────────────────────────

class AppleContainerInstance implements SandboxInstance {
  readonly id: string;
  state: SandboxState;
  private containerIp: string;

  constructor(info: ContainerInfo) {
    this.id = info.configuration.id;
    this.state = mapContainerState(info.status);
    this.containerIp = extractIp(info.networks);
  }

  // ── Lifecycle ─────────────────────────────────────

  async start(): Promise<void> {
    await runContainerCmd(["start", this.id]);
    this.state = "started";
    await this.refreshIp();
    await this.waitForExec();
  }

  /** Wait until `container exec` works (container init fully booted). */
  private async waitForExec(maxAttempts = 20, intervalMs = 1000): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { exitCode } = await runContainerCmd(
          ["exec", "--user", CONTAINER_USER, this.id, "true"],
          { timeout: 5_000 },
        );
        if (exitCode === 0) return;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    console.warn(`[apple-container] Container ${this.id} exec not ready after ${maxAttempts * intervalMs / 1000}s, proceeding anyway`);
  }

  async stop(): Promise<void> {
    await runContainerCmd(["stop", this.id]);
    this.state = "stopped";
  }

  async delete(): Promise<void> {
    await runContainerCmd(["delete", "--force", this.id]);
    this.state = "stopped";
  }

  async fork(): Promise<{ id: string; name?: string; state?: string }> {
    throw new Error(
      "Fork is not supported by the Apple Container provider. " +
        "Use the Daytona provider for copy-on-write sandbox forking.",
    );
  }

  async refreshState(): Promise<void> {
    const { stdout } = await runContainerCmd(["inspect", this.id]);
    const infos = parseContainerInfoArray(stdout);
    if (infos.length === 0) throw new Error(`Container ${this.id} not found`);
    this.state = mapContainerState(infos[0].status);
    this.containerIp = extractIp(infos[0].networks);
  }

  // ── File system ───────────────────────────────────

  readonly fs: SandboxFileSystem = {
    uploadFile: async (content: Buffer, remotePath: string): Promise<void> => {
      const b64 = content.toString("base64");
      const CHUNK = 65536;
      if (b64.length <= CHUNK) {
        await execInContainer(this.id, [
          "sh", "-c",
          `mkdir -p "$(dirname '${remotePath}')" && echo '${b64}' | base64 -d > '${remotePath}'`,
        ]);
      } else {
        await execInContainer(this.id, [
          "sh", "-c", `mkdir -p "$(dirname '${remotePath}')"`,
        ]);
        for (let i = 0; i < b64.length; i += CHUNK) {
          const chunk = b64.slice(i, i + CHUNK);
          const op = i === 0 ? ">" : ">>";
          await execInContainer(this.id, [
            "sh", "-c", `printf '%s' '${chunk}' ${op} /tmp/_apex_upload.b64`,
          ]);
        }
        await execInContainer(this.id, [
          "sh", "-c", `base64 -d /tmp/_apex_upload.b64 > '${remotePath}' && rm -f /tmp/_apex_upload.b64`,
        ]);
      }
    },

    downloadFile: async (remotePath: string): Promise<Buffer> => {
      const result = await execInContainer(this.id, [
        "sh", "-c", `base64 '${remotePath}'`,
      ]);
      return Buffer.from(result.stdout.trim(), "base64");
    },

    createFolder: async (path: string, mode?: string): Promise<void> => {
      const m = mode ?? "755";
      await execInContainer(this.id, [
        "sh", "-c", `mkdir -p "${path}" && chmod ${m} "${path}"`,
      ]);
    },
  };

  // ── Process ───────────────────────────────────────

  readonly process: SandboxProcess = {
    executeCommand: async (
      command: string,
      cwd?: string,
    ): Promise<ExecuteCommandResult> => {
      const result = await execInContainer(
        this.id,
        ["sh", "-c", command],
        { workingDir: cwd },
      );
      return {
        result: result.stdout + result.stderr,
        exitCode: result.exitCode,
      };
    },

    createSession: async (_sessionId: string): Promise<void> => {
      // Sessions are not tracked in Apple Containers — no-op.
    },

    executeSessionCommand: async (
      _sessionId: string,
      opts: SessionCommandOpts,
    ): Promise<unknown> => {
      if (opts.async) {
        await execInContainer(
          this.id,
          ["sh", "-c", opts.command],
          { detach: true },
        );
        return undefined;
      }
      const result = await execInContainer(this.id, ["sh", "-c", opts.command]);
      return { result: result.stdout + result.stderr, exitCode: result.exitCode };
    },
  };

  // ── Git ───────────────────────────────────────────

  readonly git: SandboxGit = {
    clone: async (
      url: string,
      path: string,
      branch?: string,
      commit?: string,
      username?: string,
      password?: string,
    ): Promise<void> => {
      let cloneUrl = url;
      if (username && password) {
        const parsed = new URL(url);
        parsed.username = username;
        parsed.password = password;
        cloneUrl = parsed.toString();
      }

      const parts = ["git", "clone"];
      if (branch) parts.push("--branch", branch);
      parts.push(cloneUrl, path);

      await execInContainer(this.id, parts);

      if (commit) {
        await execInContainer(
          this.id,
          ["git", "checkout", commit],
          { workingDir: path },
        );
      }
    },
  };

  // ── Networking ────────────────────────────────────

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    if (!this.containerIp || this.containerIp === "127.0.0.1") {
      await this.refreshState();
    }
    return { url: `http://${this.containerIp}:${port}` };
  }

  // ── Private ───────────────────────────────────────

  private async refreshIp(): Promise<void> {
    const { stdout } = await runContainerCmd(["inspect", this.id]);
    const infos = parseContainerInfoArray(stdout);
    if (infos.length > 0) {
      this.containerIp = extractIp(infos[0].networks);
    }
  }
}

// ── AppleContainerProvider ──────────────────────────

export class AppleContainerProvider implements SandboxProvider {
  readonly type = "apple-container" as const;
  private defaultImage: string;

  constructor(config: SandboxProviderConfig = {}) {
    this.defaultImage = config.image || DEFAULT_IMAGE;
  }

  async initialize(): Promise<void> {
    const { exitCode, stderr } = await runContainerCmd(["system", "status"]);
    if (exitCode !== 0) {
      throw new Error(
        `Apple container service is not running: ${stderr.trim() || "unknown error"}. ` +
          "Start it with: container system start",
      );
    }
    console.log("[apple-container] Container service is reachable");
  }

  async create(params: CreateSandboxParams): Promise<SandboxInstance> {
    const image = params.image || this.defaultImage;

    await this.ensureImage(image, params.onStatusChange);

    const shortId = crypto.randomUUID().slice(0, 8);
    const containerName = params.name
      ? `apex-${params.name.replace(/[^a-zA-Z0-9_.-]/g, "-")}-${shortId}`
      : `apex-sandbox-${shortId}`;

    const memoryMB = params.memoryMB ?? DEFAULT_MEMORY_MB;
    const args = [
      "run", "-d",
      "--name", containerName,
      "--init",
      "-m", `${memoryMB}M`,
      "-l", `${LABEL_SANDBOX}=true`,
      "-u", CONTAINER_USER,
    ];

    if (params.cpus) {
      args.push("-c", String(params.cpus));
    }

    for (const [k, v] of Object.entries(params.envVars ?? {})) {
      args.push("-e", `${k}=${v}`);
    }

    for (const [k, v] of Object.entries(params.labels ?? {})) {
      args.push("-l", `${k}=${v}`);
    }

    args.push(image);

    const { stdout, exitCode, stderr } = await runContainerCmd(args, { timeout: 120_000 });
    if (exitCode !== 0) {
      throw new Error(
        `Failed to create Apple container: ${stderr.trim() || stdout.trim()}`,
      );
    }

    const actualName = stdout.trim() || containerName;
    console.log(`[apple-container] Container ${actualName} started`);

    await this.waitForContainer(actualName);

    const { stdout: inspectOut } = await runContainerCmd(["inspect", actualName]);
    const infos = parseContainerInfoArray(inspectOut);
    if (infos.length === 0) {
      throw new Error(`Container ${actualName} not found after creation`);
    }
    return new AppleContainerInstance(infos[0]);
  }

  async get(sandboxId: string): Promise<SandboxInstance> {
    const { stdout, exitCode, stderr } = await runContainerCmd(["inspect", sandboxId]);
    if (exitCode !== 0) {
      throw new Error(`Container ${sandboxId} not found: ${stderr.trim()}`);
    }
    const infos = parseContainerInfoArray(stdout);
    if (infos.length === 0) {
      throw new Error(`Container ${sandboxId} not found`);
    }
    return new AppleContainerInstance(infos[0]);
  }

  async list(): Promise<SandboxInstance[]> {
    const { stdout, exitCode } = await runContainerCmd([
      "list", "--all", "--format", "json",
    ]);
    if (exitCode !== 0) return [];

    const infos = parseContainerInfoArray(stdout);

    return infos
      .filter((c) => c.configuration.labels?.[LABEL_SANDBOX] === "true")
      .map((c) => new AppleContainerInstance(c));
  }

  // ── Private helpers ───────────────────────────────

  private async ensureImage(
    image: string,
    onStatusChange?: (status: string) => void,
  ): Promise<void> {
    const { exitCode } = await runContainerCmd(["image", "inspect", image]);
    if (exitCode === 0) return;

    onStatusChange?.("pulling_image");
    console.log(`[apple-container] Pulling image ${image}...`);
    const { exitCode: pullExit, stderr } = await runContainerCmd([
      "image", "pull", "--progress", "none", image,
    ]);
    if (pullExit !== 0) {
      throw new Error(`Failed to pull image ${image}: ${stderr.trim()}`);
    }
    console.log(`[apple-container] Image ${image} pulled`);
  }

  private async waitForContainer(
    containerId: string,
    maxAttempts = 15,
    intervalMs = 500,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await execInContainer(containerId, ["echo", "ready"]);
        if (result.stdout.includes("ready")) return;
      } catch {
        // Container might not be fully started yet
      }
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(
      `Container ${containerId} not responsive after ${(maxAttempts * intervalMs) / 1000}s`,
    );
  }
}
