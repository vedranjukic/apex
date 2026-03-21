/**
 * Docker sandbox provider — manages containers via the Docker Engine API.
 *
 * Uses `dockerode` to communicate with the Docker daemon over
 * `/var/run/docker.sock` (or a custom host).  The sandbox container image
 * (e.g. `daytonaio/apex-default`) has the Daytona daemon baked in.
 *
 * File system, process, and git operations are implemented via
 * `docker exec` rather than the daemon HTTP API, keeping the
 * implementation self-contained.
 */

import Docker from "dockerode";
import crypto from "crypto";
import { PassThrough } from "stream";
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

const DEFAULT_IMAGE = "docker.io/daytonaio/apex-default:0.1.0";
const LABEL_SANDBOX = "apex.sandbox";
const CONTAINER_USER = "daytona";

// ── Helpers ──────────────────────────────────────────

function mapDockerState(dockerState: Docker.ContainerInspectInfo["State"]): SandboxState {
  if (dockerState.Running) return "started";
  if (dockerState.Paused) return "stopped";
  if (dockerState.Restarting) return "starting";
  if (dockerState.Dead || dockerState.OOMKilled) return "error";
  return "stopped";
}

/** Run an exec inside a container, collect stdout+stderr, return result + exit code. */
async function execCommand(
  container: Docker.Container,
  cmd: string[],
  opts: { workingDir?: string; user?: string; detach?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: opts.workingDir || undefined,
    User: opts.user || CONTAINER_USER,
  });

  if (opts.detach) {
    await exec.start({ Detach: true });
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const stream = await exec.start({});

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    stderrStream.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const inspectResult = await exec.inspect();

  return {
    stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
    stderr: Buffer.concat(stderrChunks).toString("utf-8"),
    exitCode: inspectResult.ExitCode ?? 0,
  };
}

/** Get the container's IP on the first available Docker network. */
function getContainerIp(info: Docker.ContainerInspectInfo): string {
  const networks = info.NetworkSettings?.Networks ?? {};
  for (const net of Object.values(networks)) {
    if (net.IPAddress) return net.IPAddress;
  }
  return "127.0.0.1";
}

// ── DockerSandboxInstance ────────────────────────────

class DockerSandboxInstance implements SandboxInstance {
  readonly id: string;
  state: SandboxState;
  private containerIp: string;

  constructor(
    private readonly container: Docker.Container,
    info: Docker.ContainerInspectInfo,
  ) {
    this.id = info.Id;
    this.state = mapDockerState(info.State);
    this.containerIp = getContainerIp(info);
  }

  // ── Lifecycle ─────────────────────────────────────

  async start(): Promise<void> {
    await this.container.start();
    this.state = "started";
    const info = await this.container.inspect();
    this.containerIp = getContainerIp(info);
  }

  async stop(): Promise<void> {
    await this.container.stop();
    this.state = "stopped";
  }

  async delete(): Promise<void> {
    await this.container.remove({ force: true });
    this.state = "stopped";
  }

  async fork(): Promise<{ id: string; name?: string; state?: string }> {
    throw new Error(
      "Fork is not supported by the Docker provider. " +
        "Use the Daytona provider for copy-on-write sandbox forking.",
    );
  }

  async refreshState(): Promise<void> {
    const info = await this.container.inspect();
    this.state = mapDockerState(info.State);
    this.containerIp = getContainerIp(info);
  }

  // ── File system ───────────────────────────────────

  readonly fs: SandboxFileSystem = {
    uploadFile: async (content: Buffer, remotePath: string): Promise<void> => {
      const b64 = content.toString("base64");
      // Split into chunks to avoid argument-too-long errors on very large files
      const CHUNK = 65536;
      if (b64.length <= CHUNK) {
        await execCommand(this.container, [
          "sh", "-c",
          `mkdir -p "$(dirname '${remotePath}')" && echo '${b64}' | base64 -d > '${remotePath}'`,
        ]);
      } else {
        await execCommand(this.container, [
          "sh", "-c", `mkdir -p "$(dirname '${remotePath}')"`,
        ]);
        // Write in chunks: first chunk creates the file, rest append
        for (let i = 0; i < b64.length; i += CHUNK) {
          const chunk = b64.slice(i, i + CHUNK);
          const op = i === 0 ? ">" : ">>";
          await execCommand(this.container, [
            "sh", "-c", `printf '%s' '${chunk}' ${op} /tmp/_apex_upload.b64`,
          ]);
        }
        await execCommand(this.container, [
          "sh", "-c", `base64 -d /tmp/_apex_upload.b64 > '${remotePath}' && rm -f /tmp/_apex_upload.b64`,
        ]);
      }
    },

    downloadFile: async (remotePath: string): Promise<Buffer> => {
      const result = await execCommand(this.container, [
        "sh", "-c", `base64 '${remotePath}'`,
      ]);
      return Buffer.from(result.stdout.trim(), "base64");
    },

    createFolder: async (path: string, mode?: string): Promise<void> => {
      const m = mode ?? "755";
      await execCommand(this.container, [
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
      const result = await execCommand(
        this.container,
        ["sh", "-c", command],
        { workingDir: cwd },
      );
      return {
        result: result.stdout + result.stderr,
        exitCode: result.exitCode,
      };
    },

    createSession: async (_sessionId: string): Promise<void> => {
      // Sessions are not tracked in Docker -- createSession is a no-op.
      // The SandboxManager calls this before executeSessionCommand.
    },

    executeSessionCommand: async (
      _sessionId: string,
      opts: SessionCommandOpts,
    ): Promise<unknown> => {
      if (opts.async) {
        await execCommand(
          this.container,
          ["sh", "-c", opts.command],
          { detach: true },
        );
        return undefined;
      }
      const result = await execCommand(
        this.container,
        ["sh", "-c", opts.command],
      );
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

      await execCommand(this.container, parts);

      if (commit) {
        await execCommand(
          this.container,
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
}

// ── DockerSandboxProvider ────────────────────────────

export class DockerSandboxProvider implements SandboxProvider {
  readonly type = "docker" as const;
  private docker: Docker;
  private defaultImage: string;

  constructor(config: SandboxProviderConfig = {}) {
    const socketPath = config.dockerHost || "/var/run/docker.sock";
    this.docker = new Docker({ socketPath });
    this.defaultImage = config.image || DEFAULT_IMAGE;
  }

  async initialize(): Promise<void> {
    await this.docker.ping();
    console.log("[docker-provider] Docker daemon is reachable");
  }

  async create(params: CreateSandboxParams): Promise<SandboxInstance> {
    const image = params.image || this.defaultImage;

    await this.ensureImage(image);

    const shortId = crypto.randomUUID().slice(0, 8);
    const containerName = params.name
      ? `apex-${params.name.replace(/[^a-zA-Z0-9_.-]/g, "-")}-${shortId}`
      : `apex-sandbox-${shortId}`;

    const envList = Object.entries(params.envVars ?? {}).map(
      ([k, v]) => `${k}=${v}`,
    );

    const container = await this.docker.createContainer({
      Image: image,
      name: containerName,
      Labels: {
        [LABEL_SANDBOX]: "true",
        ...(params.labels ?? {}),
      },
      Env: envList,
      User: CONTAINER_USER,
      HostConfig: {
        Init: true,
      },
    });

    await container.start();
    console.log(`[docker-provider] Container ${containerName} started (${container.id.slice(0, 12)})`);

    await this.waitForContainer(container);

    const info = await container.inspect();
    return new DockerSandboxInstance(container, info);
  }

  async get(sandboxId: string): Promise<SandboxInstance> {
    const container = this.docker.getContainer(sandboxId);
    const info = await container.inspect();
    return new DockerSandboxInstance(container, info);
  }

  async list(): Promise<SandboxInstance[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${LABEL_SANDBOX}=true`] },
    });

    const instances: SandboxInstance[] = [];
    for (const c of containers) {
      const container = this.docker.getContainer(c.Id);
      const info = await container.inspect();
      instances.push(new DockerSandboxInstance(container, info));
    }
    return instances;
  }

  // ── Private helpers ───────────────────────────────

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch {
      // Image not found locally — pull it
    }

    console.log(`[docker-provider] Pulling image ${image}...`);
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
    console.log(`[docker-provider] Image ${image} pulled`);
  }

  /** Wait until the container is responsive (can exec a command). */
  private async waitForContainer(
    container: Docker.Container,
    maxAttempts = 10,
    intervalMs = 1000,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await execCommand(container, ["echo", "ready"]);
        if (result.stdout.includes("ready")) return;
      } catch {
        // Container might not be fully started yet
      }
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(
      `Container ${container.id.slice(0, 12)} not responsive after ${maxAttempts * intervalMs / 1000}s`,
    );
  }
}
