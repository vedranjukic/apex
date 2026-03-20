/**
 * Apple Container sandbox provider — stub.
 *
 * Will use Apple's `container` CLI to manage lightweight Linux VMs on macOS.
 * The Daytona daemon binary is expected to be baked into the container image,
 * so the fs/process/git sub-interfaces talk to the daemon over a mapped port.
 */

import type {
  SandboxProvider,
  SandboxProviderConfig,
  SandboxInstance,
  CreateSandboxParams,
} from "./types.js";

export class AppleContainerProvider implements SandboxProvider {
  readonly type = "apple-container" as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(config: SandboxProviderConfig = {}) {}

  async initialize(): Promise<void> {
    throw new Error(
      "AppleContainerProvider is not yet implemented. " +
        "Set SANDBOX_PROVIDER=daytona to use the Daytona backend.",
    );
  }

  async create(_params: CreateSandboxParams): Promise<SandboxInstance> {
    throw new Error("AppleContainerProvider.create() not implemented");
  }

  async get(_sandboxId: string): Promise<SandboxInstance> {
    throw new Error("AppleContainerProvider.get() not implemented");
  }

  async list(): Promise<SandboxInstance[]> {
    throw new Error("AppleContainerProvider.list() not implemented");
  }
}
