export type {
  SandboxProviderType,
  SandboxState,
  CreateSandboxParams,
  SandboxFileSystem,
  SandboxProcess,
  SandboxGit,
  ExecuteCommandResult,
  SessionCommandOpts,
  PreviewInfo,
  SshAccessInfo,
  SandboxInstance,
  SandboxProviderConfig,
  SandboxProvider,
} from "./types.js";

export { DaytonaSandboxProvider } from "./daytona-provider.js";
export { DockerSandboxProvider } from "./docker-provider.js";
export { AppleContainerProvider } from "./apple-container-provider.js";
export { LocalSandboxProvider } from "./local-provider.js";

import type { SandboxProvider, SandboxProviderConfig, SandboxProviderType } from "./types.js";
import { DaytonaSandboxProvider } from "./daytona-provider.js";
import { DockerSandboxProvider } from "./docker-provider.js";
import { AppleContainerProvider } from "./apple-container-provider.js";
import { LocalSandboxProvider } from "./local-provider.js";

/**
 * Factory — create a provider instance by type string.
 * Defaults to `"daytona"` when type is omitted.
 */
export function createSandboxProvider(
  type: SandboxProviderType = "daytona",
  config: SandboxProviderConfig = {},
): SandboxProvider {
  switch (type) {
    case "daytona":
      return new DaytonaSandboxProvider(config);
    case "docker":
      return new DockerSandboxProvider(config);
    case "apple-container":
      return new AppleContainerProvider(config);
    case "local":
      return new LocalSandboxProvider(config);
    default:
      throw new Error(`Unknown sandbox provider type: ${type}`);
  }
}
