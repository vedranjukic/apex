# Open in IDE (Electron SSH Remote)

> In the Electron desktop app, the "Open in IDE" button detects locally installed Cursor or VS Code, creates a 24-hour SSH access token via the Daytona SDK, writes a managed SSH config, and launches the IDE with a remote SSH connection to the sandbox. Falls back to code-server in the browser when no local IDE is found (or in the web version).

## Overview

The project status bar has an IDE button that behaves differently depending on the environment:

| Environment | IDE found? | Behavior |
|---|---|---|
| Web (browser) | N/A | Opens code-server (web VS Code) in a new browser tab via signed Daytona preview URL |
| Electron | No | Same as web -- opens code-server in the system browser |
| Electron | Cursor detected | Creates SSH access, writes SSH config, launches `cursor --remote ssh-remote+...` |
| Electron | VS Code detected | Creates SSH access, writes SSH config, launches `code --remote ssh-remote+...` |

Preference order when both are installed: **Cursor > VS Code**.

## Architecture

```
User clicks IDE button in status bar
  │
  ├─ Web or no local IDE
  │   → GET /api/projects/:id/vscode-url
  │   → Opens code-server URL in browser
  │
  └─ Electron + local IDE detected
      → POST /api/projects/:id/ssh-access
        → SandboxManager.createSshAccess()
          → Daytona SDK sandbox.createSshAccess(1440)  // 24h
          → Parses sshCommand → { user, host, port }
        ← Returns { sshUser, sshHost, sshPort, sandboxId, remotePath, expiresAt }
      → IPC 'open-in-ide' to Electron main process
        → Writes SSH host entry to ~/.ssh/apex-config
        → Ensures Include in ~/.ssh/config
        → Spawns: cursor --remote ssh-remote+apex-{sandboxId} {remotePath}
```

## File Map

| File | Purpose |
|------|---------|
| `apps/desktop/src/main.ts` | IDE detection (`detectIDEs`), SSH config management (`writeSshHostEntry`, `ensureSshInclude`), `open-in-ide` IPC handler, `get-detected-ides` IPC handler |
| `apps/desktop/src/preload.ts` | Exposes `detectedIDEs` and `openInIDE()` on the `window.apex` bridge |
| `libs/orchestrator/src/lib/sandbox-manager.ts` | `createSshAccess()` method, `parseSshCommand()` helper |
| `apps/api/src/modules/projects/projects.controller.ts` | `POST /api/projects/:id/ssh-access` endpoint |
| `apps/dashboard/src/api/client.ts` | `projectsApi.createSshAccess()` frontend API method |
| `apps/dashboard/src/components/layout/project-status-bar.tsx` | IDE button UI, `openIDE` callback with native/fallback branching |
| `libs/shared/src/lib/dto.ts` | `SshAccessResponse` and `OpenInIDEParams` type definitions |

## IDE Detection (Electron Main Process)

On app startup (`app.whenReady()`), the main process checks whether `cursor` and `code` CLI binaries are on the system PATH:

```typescript
function detectIDEs(): { cursor: boolean; vscode: boolean } {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const check = (cmd: string): boolean => {
    try {
      execSync(`${which} ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch { return false; }
  };
  return { cursor: check('cursor'), vscode: check('code') };
}
```

The result is stored in a module-level variable and exposed to the renderer via a synchronous IPC call (`get-detected-ides`) during preload initialization. This means `window.apex.detectedIDEs` is available immediately when the dashboard loads.

## SSH Config Management

The Electron main process manages SSH config entries needed for VS Code Remote SSH connections. It uses a **separate config file** to avoid conflicts with the user's own SSH config.

### File locations

- `~/.ssh/apex-config` -- Apex-managed SSH host entries (one block per sandbox)
- `~/.ssh/config` -- User's main SSH config (gets an `Include` directive added)

### Include directive

On first use, `ensureSshInclude()` prepends `Include ~/.ssh/apex-config` to the top of `~/.ssh/config` (creating the file if it doesn't exist). Both the `.ssh/` directory (mode 700) and config files (mode 600) are created with correct permissions.

### Host entry format

Each sandbox gets a host entry with alias `apex-{sandboxId}`:

```
# apex-abc123
Host apex-abc123
  HostName win.trydaytona.com
  User 6g6ySpYWRtrGZPdbEbo5qnwQKYt8PxdA
  Port 2222
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

- The `User` field is a Daytona SSH access token (not a traditional username)
- The token expires after 24 hours; clicking the button again creates a fresh token and overwrites the entry
- `writeSshHostEntry()` performs in-place updates: if a block for the same sandboxId already exists, it replaces it rather than appending a duplicate

## SSH Access API

### `SandboxManager.createSshAccess(sandboxId, expiresInMinutes?)`

Calls the Daytona SDK's `sandbox.createSshAccess()` and parses the returned `sshCommand` string to extract connection components:

```typescript
// Daytona returns: "ssh -p 2222 TOKEN@win.trydaytona.com"
// Regex finds USER@HOST anywhere in the string, -p PORT anywhere
private parseSshCommand(cmd: string): { user: string; host: string; port: number } {
  const userHostMatch = cmd.match(/(\S+)@(\S+)/);
  const portMatch = cmd.match(/-p\s+(\d+)/);
  // ...
}
```

The parser handles both `ssh USER@HOST -p PORT` and `ssh -p PORT USER@HOST` formats.

Returns: `{ sshUser, sshHost, sshPort, sandboxId, remotePath, expiresAt }`

### `POST /api/projects/:id/ssh-access`

Validates the project has a running sandbox, calls `sandboxManager.createSshAccess()`, and returns the parsed connection details. The `remotePath` is the sandbox's project directory (e.g. `/home/daytona/my-project`).

## Preload Bridge Extensions

The `window.apex` bridge was extended with two new properties:

```typescript
window.apex = {
  // ... existing properties ...
  detectedIDEs: { cursor: boolean; vscode: boolean },  // populated synchronously
  openInIDE: (params) => Promise<{ ok: boolean; error?: string }>,  // async IPC
};
```

- `detectedIDEs` is populated via `ipcRenderer.sendSync('get-detected-ides')` during preload, so it's available immediately
- `openInIDE` uses `ipcRenderer.invoke('open-in-ide', params)` for async result/error handling

## Frontend Button Logic

The status bar button adapts its label, tooltip, and behavior based on detected IDEs:

| State | Label | Tooltip | Click action |
|---|---|---|---|
| Electron + Cursor | "Cursor" | "Open in Cursor (SSH)" | SSH access → native Cursor |
| Electron + VS Code only | "VS Code" | "Open in VS Code (SSH)" | SSH access → native VS Code |
| Electron + neither | "VS Code" + external icon | "Open VS Code in browser" | code-server URL → browser |
| Web | "VS Code" + external icon | "Open VS Code in browser" | code-server URL → new tab |

## Prerequisites for Native IDE Path

For the native SSH connection to work, the user needs:

1. **Cursor or VS Code** installed with the CLI on PATH (`cursor` or `code` command)
2. **Remote - SSH extension** installed in the IDE (typically bundled with VS Code/Cursor)
3. **SSH client** available on the system (standard on macOS/Linux, OpenSSH on Windows)

If the IDE launches but the Remote SSH extension is missing, VS Code/Cursor will show its own error prompting the user to install it.
