export { SandboxManager } from './lib/sandbox-manager.js';
export type {
  SandboxManagerEvents,
} from './lib/sandbox-manager.js';
export * from './lib/types.js';
export { getBridgeScript } from './lib/bridge-script.js';
export { getMcpTerminalScript } from './lib/mcp-terminal-script.js';
export { getMcpLspScript } from './lib/mcp-lsp-script.js';
export { getLlmProxyServiceScript } from './lib/llm-proxy-service-script.js';

// Sandbox provider abstraction
export { createSandboxProvider } from './lib/providers/index.js';
export { DaytonaSandboxProvider } from './lib/providers/daytona-provider.js';
export { DockerSandboxProvider } from './lib/providers/docker-provider.js';
export { AppleContainerProvider } from './lib/providers/apple-container-provider.js';
export { LocalSandboxProvider } from './lib/providers/local-provider.js';
export type {
  SandboxProviderType,
  SandboxState,
  CreateSandboxParams,
  SandboxFileSystem,
  SandboxProcess,
  SandboxGit,
  PreviewInfo,
  SshAccessInfo,
  SandboxInstance,
  SandboxProviderConfig,
  SandboxProvider,
} from './lib/providers/types.js';
