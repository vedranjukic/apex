/**
 * Docker sandbox provider — stub.
 *
 * Will use the Docker Engine API (via dockerode or direct HTTP) to manage
 * containers.  The Daytona daemon binary is expected to be baked into the
 * container image, so the fs/process/git sub-interfaces talk to the daemon
 * over a mapped port.
 */

import type {
  SandboxProvider,
  SandboxProviderConfig,
  SandboxInstance,
  CreateSandboxParams,
} from "./types.js";

export class DockerSandboxProvider implements SandboxProvider {
  readonly type = "docker" as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(config: SandboxProviderConfig = {}) {}

  async initialize(): Promise<void> {
    throw new Error(
      "DockerSandboxProvider is not yet implemented. " +
        "Set SANDBOX_PROVIDER=daytona to use the Daytona backend.",
    );
  }

  async create(_params: CreateSandboxParams): Promise<SandboxInstance> {
    throw new Error("DockerSandboxProvider.create() not implemented");
  }

  async get(_sandboxId: string): Promise<SandboxInstance> {
    throw new Error("DockerSandboxProvider.get() not implemented");
  }

  async list(): Promise<SandboxInstance[]> {
    throw new Error("DockerSandboxProvider.list() not implemented");
  }
}
