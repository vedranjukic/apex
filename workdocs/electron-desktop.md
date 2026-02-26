# Electron Desktop App

## Overview

The Electron wrapper (`apps/desktop`) packages the Apex web app as a standalone macOS desktop application. It forks the NestJS API as a child process and loads the React dashboard in a BrowserWindow. All web features work identically -- the desktop app is the same codebase with native window management on top.

## Architecture

```
Electron Main Process (apps/desktop/src/main.ts)
├── Forks NestJS API as child process on a dynamic port
├── API serves dashboard static build via ServeStaticModule
├── Opens BrowserWindow → http://127.0.0.1:<port>
└── Manages window lifecycle, IPC, external URL handling

NestJS API (child process)
├── ServeStaticModule serves apps/dashboard/dist (SPA fallback)
├── SettingsModule stores API keys in SQLite
├── All /api/* and /ws/* routes work as normal
└── SQLite DB stored in ~/Library/Application Support/Apex/
```

## Key Files

| File | Purpose |
|---|---|
| `apps/desktop/src/main.ts` | Electron main process -- forks API, creates windows, handles IPC |
| `apps/desktop/src/preload.ts` | Preload script -- exposes `window.apex` bridge to renderer |
| `apps/desktop/package.json` | App metadata for electron-builder |
| `apps/desktop/tsconfig.json` | TypeScript config (CommonJS target for Electron) |
| `apps/desktop/electron-builder.yml` | Packaging config (macOS DMG, universal arch) |
| `scripts/build-desktop.js` | Build helper -- compiles desktop TS + rebuilds native modules |

## Preload Bridge (`window.apex`)

The preload script exposes a `window.apex` object to the renderer via `contextBridge`:

```typescript
window.apex = {
  platform: string;       // e.g. 'darwin'
  isElectron: true;       // used by dashboard to detect Electron mode
  openWindow: (urlPath: string) => void;  // IPC call to open a new BrowserWindow
  detectedIDEs: { cursor: boolean; vscode: boolean };  // populated synchronously at load
  openInIDE: (params: OpenInIDEParams) => Promise<{ ok: boolean; error?: string }>;  // SSH remote open
}
```

Dashboard code checks `window.apex?.isElectron` to switch behavior:

| Feature | Web (browser) | Electron |
|---|---|---|
| Open project from list | `window.open()` (new tab) | `navigate()` (same window) |
| Open fork | `window.open()` (named tab) | `apex.openWindow()` (new window via IPC) |
| External URLs (ports) | `window.open()` (new tab) | `shell.openExternal()` (system browser) |
| Open in IDE | code-server in new tab | Native Cursor/VS Code via SSH if detected, else code-server in browser |
| Projects button in activity bar | Hidden | Shown (navigates to `/`) |
| Window dragging | N/A | Top bar has `-webkit-app-region: drag` |

See `workdocs/open-in-ide.md` for full details on the IDE detection and SSH remote connection flow.

## Window Management

- **Main window**: Created on app launch, loads `/` (project list)
- **Project windows**: Created via IPC `open-window` when opening forks. Each gets its own BrowserWindow with the preload script
- **`window.open()` interception**: The `setWindowOpenHandler` on each window intercepts `window.open()` calls. Internal URLs (same origin) spawn a new BrowserWindow. External URLs open in the system browser
- **macOS behavior**: `window-all-closed` does not quit the app (standard macOS). `activate` (dock click) re-creates the main window if all windows are closed

## Settings System

API keys are configured from the dashboard Settings page (`/settings`) instead of `.env` files:

- **Backend**: `SettingsModule` stores key-value pairs in the `settings` SQLite table. On startup, `SettingsService.onModuleInit()` loads values into `process.env`. On save, `ProjectsService.reinitSandboxManager()` is called to pick up new keys
- **Frontend**: `SettingsPage` at `/settings` with form fields for `ANTHROPIC_API_KEY`, `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_SNAPSHOT`
- **Visibility**: `GET /api/settings/visible` checks `SETTINGS_VISIBLE` env var (defaults to `true`). Set `SETTINGS_VISIBLE=false` to hide settings in hosted deployments
- **Masked values**: `GET /api/settings` returns masked API keys (`sk-a••••xxxx`). `PUT /api/settings` skips values containing `••••` so unchanged fields aren't overwritten

## Static File Serving

`@nestjs/serve-static` is added to `AppModule`:

```typescript
ServeStaticModule.forRoot({
  rootPath: process.env.DASHBOARD_DIR || join(__dirname, '../../dashboard/dist'),
  exclude: ['/api/{*path}', '/ws/{*path}'],
})
```

- In Electron, `DASHBOARD_DIR` is set by the main process to the built dashboard location
- In web dev mode (Vite on :4200), the directory doesn't exist; Vite handles everything
- Excludes `/api/*` and `/ws/*` so API routes and Socket.io are not intercepted
- Handles SPA fallback (returns `index.html` for unmatched routes) so `BrowserRouter` works

## Sandbox Lifecycle on Project Open

When a project window opens (`subscribe_project` socket event), the gateway:

1. **Reconciles** DB status with actual Daytona sandbox state via `reconcileSandboxStatus()` -- queries the Daytona API and corrects any mismatch (e.g. DB says `stopped` but sandbox is actually `started`)
2. **Starts** stopped sandboxes via `startOrProvisionSandbox()` -- calls `reconnectSandbox()` which starts the Daytona sandbox and reconnects the bridge
3. **Provisions** missing sandboxes -- if the project has no `sandboxId` (sandbox was never created), provisions a new one

The dashboard project page polls the project status every 3s while in `stopped`, `starting`, or `creating` state, showing an overlay with progress messages.

## Native Module Handling

`better-sqlite3` is a native C++ addon that must be compiled against Electron's Node.js ABI version (different from system Node.js). The `@electron/rebuild` tool handles this:

- **For Electron**: `npx @electron/rebuild -f -w better-sqlite3` (runs as part of `desktop:build` and `desktop:dev`)
- **To restore for web dev**: `npm run postdesktop` (runs `npm rebuild better-sqlite3` for system Node.js)
- **`node-pty`** is NOT used in the API/dashboard -- it's installed inside Daytona sandboxes at runtime, so no rebuild needed

## Build & Run Commands

```bash
# Development: build API + dashboard, rebuild native modules, launch Electron
npm run desktop:dev

# After desktop:dev, restore native modules for web development
npm run postdesktop

# Production build: same as dev but runs through build-desktop.js
npm run desktop:build

# Package as macOS DMG
npm run desktop:package

# Normal web dev mode (unaffected by Electron changes)
npm run serve
```

## Packaging (electron-builder)

Config: `apps/desktop/electron-builder.yml`

- **Target**: macOS DMG (universal architecture -- both Intel and Apple Silicon)
- **App ID**: `com.apex.desktop`
- **Bundled files**: `apps/api/dist`, `apps/dashboard/dist`, `apps/desktop/dist`, `node_modules` (devDependencies auto-pruned)
- **Entry point**: `apps/desktop/dist/main.js`
- **Output**: `dist-electron/` (gitignored)
- **Excluded from bundle**: `@nx`, `@swc`, `typescript`, `@playwright`, `vite`, `@vitejs`, `tailwindcss` (build-time only)

## Data Storage

| Item | Location |
|---|---|
| SQLite database | `~/Library/Application Support/Apex/apex.sqlite` |
| Electron logs | stdout/stderr of the Electron process |
| API logs | Prefixed with `[api]` in the same terminal |
