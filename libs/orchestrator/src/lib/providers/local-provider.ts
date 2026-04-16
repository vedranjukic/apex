/**
 * Local sandbox provider — runs projects directly on the host machine.
 *
 * No containers or VMs. File operations use native `fs`, process execution
 * uses `child_process`, and preview URLs point to localhost.  Sandbox
 * metadata is persisted in a JSON registry file so that `get()` and
 * `list()` survive process restarts.
 */

import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execSync, spawn, type ChildProcess } from "child_process";
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

const DEFAULT_BASE_DIR = path.join(os.homedir(), ".apex", "sandboxes");
const REGISTRY_FILE = ".local-sandboxes.json";

// ── Registry persistence ─────────────────────────────

interface SandboxEntry {
  id: string;
  name: string;
  workDir: string;
  createdAt: string;
}

async function loadRegistry(baseDir: string): Promise<SandboxEntry[]> {
  const file = path.join(baseDir, REGISTRY_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRegistry(
  baseDir: string,
  entries: SandboxEntry[],
): Promise<void> {
  const file = path.join(baseDir, REGISTRY_FILE);
  await fs.writeFile(file, JSON.stringify(entries, null, 2), "utf-8");
}

// ── Helpers ──────────────────────────────────────────

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "project"
  );
}

function runShell(
  command: string,
  cwd?: string,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

// ── LocalSandboxInstance ─────────────────────────────

class LocalSandboxInstance implements SandboxInstance {
  readonly id: string;
  state: SandboxState;
  private readonly workDir: string;
  private asyncProcesses = new Map<string, ChildProcess>();

  constructor(entry: SandboxEntry) {
    this.id = entry.id;
    this.workDir = entry.workDir;
    this.state = existsSync(entry.workDir) ? "started" : "stopped";
  }

  // ── Lifecycle ─────────────────────────────────────

  async start(): Promise<void> {
    await fs.mkdir(this.workDir, { recursive: true });
    this.state = "started";
  }

  async stop(): Promise<void> {
    for (const proc of this.asyncProcesses.values()) {
      try { proc.kill(); } catch { /* already exited */ }
    }
    this.asyncProcesses.clear();
    this.state = "stopped";
  }

  async delete(): Promise<void> {
    await this.stop();
    try {
      await fs.rm(this.workDir, { recursive: true, force: true });
    } catch { /* may already be gone */ }
    this.state = "stopped";
  }

  async fork(): Promise<{ id: string; name?: string; state?: string }> {
    throw new Error(
      "Fork is not supported by the Local provider. " +
        "Use the Daytona provider for copy-on-write sandbox forking.",
    );
  }

  async refreshState(): Promise<void> {
    this.state = existsSync(this.workDir) ? "started" : "stopped";
  }

  // ── File system ───────────────────────────────────

  readonly fs: SandboxFileSystem = {
    uploadFile: async (content: Buffer, remotePath: string): Promise<void> => {
      await fs.mkdir(path.dirname(remotePath), { recursive: true });
      await fs.writeFile(remotePath, content);
    },

    downloadFile: async (remotePath: string): Promise<Buffer> => {
      return fs.readFile(remotePath);
    },

    createFolder: async (dirPath: string, mode?: string): Promise<void> => {
      await fs.mkdir(dirPath, { recursive: true });
      if (mode) {
        await fs.chmod(dirPath, parseInt(mode, 8));
      }
    },
  };

  // ── Process ───────────────────────────────────────

  readonly process: SandboxProcess = {
    executeCommand: async (
      command: string,
      cwd?: string,
    ): Promise<ExecuteCommandResult> => {
      const result = runShell(command, cwd || this.workDir);
      return {
        result: result.stdout + result.stderr,
        exitCode: result.exitCode,
      };
    },

    createSession: async (_sessionId: string): Promise<void> => {
      // No-op — sessions are not tracked for the local provider.
    },

    executeSessionCommand: async (
      _sessionId: string,
      opts: SessionCommandOpts,
    ): Promise<unknown> => {
      if (opts.async) {
        const child = spawn("sh", ["-c", opts.command], {
          cwd: this.workDir,
          stdio: "ignore",
          detached: true,
        });
        child.unref();
        this.asyncProcesses.set(
          _sessionId + "-" + Date.now(),
          child,
        );
        return undefined;
      }
      const result = runShell(opts.command, this.workDir);
      return {
        result: result.stdout + result.stderr,
        exitCode: result.exitCode,
      };
    },
  };

  // ── Git ───────────────────────────────────────────

  readonly git: SandboxGit = {
    clone: async (
      url: string,
      targetPath: string,
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
      parts.push(cloneUrl, targetPath);

      const result = runShell(parts.join(" "));
      if (result.exitCode !== 0) {
        throw new Error(`git clone failed: ${result.stderr}`);
      }

      if (commit) {
        const checkout = runShell(`git checkout ${commit}`, targetPath);
        if (checkout.exitCode !== 0) {
          throw new Error(`git checkout failed: ${checkout.stderr}`);
        }
      }
    },
  };

  // ── Networking ────────────────────────────────────

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    return { url: `http://localhost:${port}` };
  }
}

// ── LocalSandboxProvider ─────────────────────────────

export class LocalSandboxProvider implements SandboxProvider {
  readonly type = "local" as const;
  readonly remote = false;
  private baseDir: string;
  private registry: SandboxEntry[] = [];

  constructor(config: SandboxProviderConfig = {}) {
    this.baseDir = config.localBaseDir || DEFAULT_BASE_DIR;
  }

  async initialize(): Promise<void> {
    mkdirSync(this.baseDir, { recursive: true });
    this.registry = await loadRegistry(this.baseDir);
    console.log(
      `[local-provider] Initialized — base dir: ${this.baseDir}, ` +
        `${this.registry.length} sandbox(es) registered`,
    );
  }

  async create(params: CreateSandboxParams): Promise<SandboxInstance> {
    const shortId = crypto.randomUUID().slice(0, 8);
    const id = crypto.randomUUID();
    const workDir = params.localDir
      ? path.resolve(params.localDir)
      : path.join(this.baseDir, `${params.name ? slugify(params.name) : "sandbox"}-${shortId}`);

    await fs.mkdir(workDir, { recursive: true });

    const entry: SandboxEntry = {
      id,
      name: params.name || `sandbox-${shortId}`,
      workDir,
      createdAt: new Date().toISOString(),
    };

    this.registry.push(entry);
    await saveRegistry(this.baseDir, this.registry);

    console.log(
      `[local-provider] Created sandbox ${entry.name} (${id.slice(0, 8)}) → ${workDir}`,
    );

    return new LocalSandboxInstance(entry);
  }

  async get(sandboxId: string): Promise<SandboxInstance> {
    const entry = this.registry.find((e) => e.id === sandboxId);
    if (!entry) {
      this.registry = await loadRegistry(this.baseDir);
      const reloaded = this.registry.find((e) => e.id === sandboxId);
      if (!reloaded) {
        throw new Error(`Local sandbox ${sandboxId} not found`);
      }
      return new LocalSandboxInstance(reloaded);
    }
    return new LocalSandboxInstance(entry);
  }

  async list(): Promise<SandboxInstance[]> {
    this.registry = await loadRegistry(this.baseDir);
    return this.registry.map((e) => new LocalSandboxInstance(e));
  }
}
