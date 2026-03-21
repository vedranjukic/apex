# Sandbox Providers

## Overview

Sandbox providers are the abstraction layer that lets the orchestrator create, manage, and interact with sandboxes regardless of the underlying infrastructure. Each provider implements the same interfaces so `SandboxManager` (and the rest of the stack) stays provider-agnostic.

The key architectural pattern: every sandbox container image ships with the **Daytona daemon** binary (`/usr/local/bin/daytona-daemon`), which starts at container boot. The daemon isn't used directly by the Docker provider (which uses `docker exec` instead), but it's part of the base image. The **bridge** (`bridge.js`) is uploaded and started by `SandboxManager.installBridge()` at sandbox creation time, which is uniform across all providers.

Default image: `docker.io/daytonaio/apex-default:0.1.0`

---

## Provider Interface

All types are defined in `libs/orchestrator/src/lib/providers/types.ts`.

### `SandboxProvider`

Factory that creates and retrieves sandbox instances.

| Method | Description |
|---|---|
| `type` | Provider identifier: `'daytona'`, `'docker'`, or `'apple-container'` |
| `initialize()` | Connect to the backend, verify connectivity |
| `create(params)` | Create and start a new sandbox, return a `SandboxInstance` |
| `get(sandboxId)` | Retrieve an existing sandbox by ID |
| `list()` | List all sandboxes managed by this provider |

### `SandboxInstance`

Represents a running or stopped sandbox. Wraps lifecycle operations and the daemon API for interacting with sandbox internals.

| Member | Description |
|---|---|
| `id` | Unique sandbox identifier (Daytona UUID or Docker container ID) |
| `state` | Current state: `started`, `stopped`, `starting`, `stopping`, `error`, `archived`, `unknown` |
| `start(timeoutSecs?)` | Start the sandbox |
| `stop()` | Stop the sandbox |
| `delete()` | Delete the sandbox |
| `fork(name?)` | Create a copy-on-write fork (Daytona only) |
| `refreshState()` | Re-fetch state from the backend |
| `fs` | File system operations (`SandboxFileSystem`) |
| `process` | Process execution (`SandboxProcess`) |
| `git` | Git operations (`SandboxGit`) |
| `getPreviewLink(port)` | Get a URL to access a port in the sandbox |
| `getSignedPreviewUrl?(port, ttlSecs)` | Optional: signed URL with embedded auth |
| `createSshAccess?(expiresInMinutes)` | Optional: SSH access credentials |

### Sub-interfaces

**`SandboxFileSystem`**: `uploadFile(content, remotePath)`, `downloadFile(remotePath)`, `createFolder(path, mode?)`

**`SandboxProcess`**: `executeCommand(command, cwd?)`, `createSession(sessionId)`, `executeSessionCommand(sessionId, opts)`

**`SandboxGit`**: `clone(url, path, branch?, commit?, username?, password?)`

### Configuration Types

**`CreateSandboxParams`**: `snapshot?` (Daytona), `image?` (Docker), `autoStopInterval?`, `envVars?`, `labels?`, `name?`

**`SandboxProviderConfig`**: `apiKey?`, `apiUrl?` (Daytona), `dockerHost?`, `image?` (Docker)

---

## Daytona Provider

File: `libs/orchestrator/src/lib/providers/daytona-provider.ts`

Wraps the `@daytonaio/sdk`. Creates sandboxes from **snapshots** (pre-built images hosted on Daytona's platform).

### How it works

- `initialize()`: Instantiates the `Daytona` SDK client (reads `DAYTONA_API_KEY` and `DAYTONA_API_URL` from environment).
- `create()`: Calls `daytona.create({ snapshot, ... })`. The SDK handles image pulling, VM provisioning, and networking.
- `DaytonaSandboxInstance` delegates `fs`, `process`, `git` to the SDK's `Sandbox` object which communicates with the Daytona daemon inside the sandbox via the Daytona cloud API as a proxy.
- `getPreviewLink(port)`: Returns a Daytona preview URL (proxied through the Daytona platform).
- `getSignedPreviewUrl(port, ttlSecs)`: Returns a URL with an embedded auth token.
- `createSshAccess(expiresInMinutes)`: Returns SSH connection details.
- `fork(name)`: Creates a copy-on-write fork of the sandbox.

### Requirements

- `DAYTONA_API_KEY` environment variable
- `DAYTONA_API_URL` (defaults to `https://app.daytona.io/api`)

---

## Docker Provider

File: `libs/orchestrator/src/lib/providers/docker-provider.ts`

Uses `dockerode` to manage containers via the Docker Engine API over `/var/run/docker.sock`.

### How it works

- `initialize()`: Pings the Docker daemon to verify connectivity.
- `create()`: Pulls the image if needed, creates a container with `apex.sandbox=true` label, starts it, and waits for it to be responsive.
- `DockerSandboxInstance` implements all sub-interfaces via `docker exec`:
  - **`fs.uploadFile`**: Exec `sh -c 'mkdir -p $(dirname "$1") && cat > "$1"'` with stdin pipe.
  - **`fs.downloadFile`**: Exec `cat <path>`, collect stdout.
  - **`fs.createFolder`**: Exec `mkdir -p && chmod`.
  - **`process.executeCommand`**: Exec `sh -c '<cmd>'` with working directory, return stdout+stderr and exit code.
  - **`process.createSession`**: No-op (sessions aren't tracked in Docker).
  - **`process.executeSessionCommand`**: Exec with `Detach: true` for async commands (e.g. starting the bridge).
  - **`git.clone`**: Builds and runs a `git clone` command.
- `getPreviewLink(port)`: Returns `http://<container-ip>:<port>` using the container's IP on the Docker bridge network.

### Container IP networking

In Docker-in-Docker (DinD), sandbox containers get IPs on the Docker bridge network. The devcontainer host can reach these IPs directly without port mapping. The `SandboxManager` WebSocket connection handles `http://` → `ws://` conversion automatically, so bridge connectivity works out of the box.

### Limitations

- **No fork**: Docker doesn't support copy-on-write sandbox forking. `fork()` throws.
- **No signed preview URLs**: `getSignedPreviewUrl` is not implemented.
- **No SSH access**: `createSshAccess` is not implemented.
- **DinD required**: The Docker daemon must be available inside the devcontainer.

### Requirements

- Docker daemon accessible at `/var/run/docker.sock` (or custom `dockerHost`)
- The `ghcr.io/devcontainers/features/docker-in-docker:2` devcontainer feature

---

## Per-Project Provider Selection

Each project stores its provider in the `provider` column (default: `'daytona'`). The provider is selected at project creation time via the UI.

### Data model

- **DB schema** (`apps/api/src/database/schema.ts`): `provider: text('provider').notNull().default('daytona')`
- **Shared enum** (`libs/shared/src/lib/enums.ts`): `SandboxProvider { Daytona = 'daytona', Docker = 'docker' }`
- **Shared interface** (`libs/shared/src/lib/interfaces.ts`): `IProject.provider: string`
- **DTO** (`libs/shared/src/lib/dto.ts`): `CreateProjectDto.provider?: string`
- **Frontend** (`apps/dashboard/src/api/client.ts`): `Project.provider: string`

### Backend routing

`ProjectsService` maintains a `Map<string, SandboxManager>` — one manager per provider type. At startup, it attempts to initialize both Daytona (if API keys are set) and Docker (if the daemon is available).

When performing sandbox operations, the service looks up the project's `provider` field and routes to the correct manager:

```
getSandboxManager(provider?: string) → SandboxManager | null
```

The `agent.ws.ts` gateway passes `project.provider` when calling `getSandboxManager()`.

### UI

The `CreateProjectDialog` presents a provider selector with two options: **Daytona (Cloud)** and **Docker (Local)**. The selection is sent with the `POST /api/projects` request.

---

## Factory and Configuration

### Provider factory

`libs/orchestrator/src/lib/providers/index.ts` exports `createSandboxProvider(type, config)`:

```typescript
switch (type) {
  case 'daytona': return new DaytonaSandboxProvider(config);
  case 'docker':  return new DockerSandboxProvider(config);
  case 'apple-container': return new AppleContainerProvider(config);
}
```

### OrchestratorConfig

`libs/orchestrator/src/lib/types.ts`:

| Field | Default | Description |
|---|---|---|
| `provider` | `'daytona'` (or `SANDBOX_PROVIDER` env) | Which provider backend to use |
| `snapshot` | `'daytona-apex-3'` (or `DAYTONA_SNAPSHOT` env) | Daytona snapshot name |
| `image` | `'docker.io/daytonaio/apex-default:0.1.0'` (or `SANDBOX_IMAGE` env) | Docker/Apple Container image |
| `anthropicApiKey` | `ANTHROPIC_API_KEY` env | Passed to bridge for agent CLIs |
| `openaiApiKey` | `OPENAI_API_KEY` env | Passed to bridge for agent CLIs |
| `githubToken` | `GITHUB_TOKEN` env | Used for git credential setup in sandboxes |

---

## File Map

| File | Role |
|---|---|
| `libs/orchestrator/src/lib/providers/types.ts` | All provider interfaces and types |
| `libs/orchestrator/src/lib/providers/index.ts` | Provider factory function |
| `libs/orchestrator/src/lib/providers/daytona-provider.ts` | Daytona provider (wraps `@daytonaio/sdk`) |
| `libs/orchestrator/src/lib/providers/docker-provider.ts` | Docker provider (uses `dockerode`) |
| `libs/orchestrator/src/lib/providers/apple-container-provider.ts` | Apple Container provider (stub) |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | Provider-agnostic sandbox lifecycle, bridge, terminals |
| `libs/orchestrator/src/lib/types.ts` | `OrchestratorConfig` and bridge message types |
| `apps/api/src/modules/projects/projects.service.ts` | Per-project provider routing via manager map |
| `apps/api/src/database/schema.ts` | `provider` column on projects table |
| `libs/shared/src/lib/enums.ts` | `SandboxProvider` enum |
| `apps/dashboard/src/components/projects/create-project-dialog.tsx` | Provider selector UI |

---

## How to Add a New Provider

1. **Create the provider class** in `libs/orchestrator/src/lib/providers/<name>-provider.ts`:
   - Implement `SandboxProvider` (initialize, create, get, list)
   - Implement `SandboxInstance` (lifecycle, fs, process, git, getPreviewLink)

2. **Register in the factory** (`providers/index.ts`):
   - Add the type to the switch statement
   - Export the class

3. **Add to `SandboxProviderType`** in `providers/types.ts`:
   ```typescript
   export type SandboxProviderType = 'daytona' | 'docker' | 'apple-container' | 'new-provider';
   ```

4. **Add to `OrchestratorConfig.provider`** union in `types.ts`

5. **Add to the `SandboxProvider` enum** in `libs/shared/src/lib/enums.ts`

6. **Add initialization logic** in `ProjectsService.initSandboxManagers()` (`apps/api/src/modules/projects/projects.service.ts`)

7. **Add to the UI selector** in `create-project-dialog.tsx` (add entry to `PROVIDERS` array)

8. **Update this workdoc** with the new provider's details
