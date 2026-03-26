# Electrobun Desktop App

## Overview

The desktop wrapper (`apps/desktop`) packages the Apex web app as a standalone macOS/Windows/Linux desktop application using [Electrobun](https://github.com/blackboardsh/electrobun). It spawns the Elysia API as a Bun subprocess, opens a native BrowserWindow pointing at the local API, and bridges native features to the React dashboard via typed RPC.

**Why Electrobun over Electron?**
- ~12MB app bundle (vs ~150MB+ for Electron) — uses system WebKit instead of bundling Chromium
- Bun as the runtime — same runtime as the API, no Node.js/Electron ABI mismatch
- Ultra-small updates via bsdiff (~14KB patches)
- Native bindings written in Zig/C++/ObjC for better performance

## Architecture

```
Electrobun Main Process (apps/desktop/src/bun/index.ts)
├── Spawns Elysia API as Bun subprocess on a dynamic port
├── API serves dashboard static build via @elysiajs/static
├── Opens BrowserWindow → http://127.0.0.1:<port>
├── RPC bridge exposes window.apex to the webview
└── Manages window lifecycle, menus, external URL handling

Elysia API (subprocess)
├── Serves apps/dashboard/dist (SPA fallback)
├── SettingsModule stores API keys in SQLite
├── All /api/* and WebSocket routes work as normal
└── SQLite DB stored in ~/Library/Application Support/Apex/
```

## Key Files

| File | Purpose |
|---|---|
| `apps/desktop/src/bun/index.ts` | Main process — spawns API, creates windows, handles RPC |
| `apps/desktop/src/preload/index.ts` | Preload view — exposes `window.apex` bridge via Electrobun RPC |
| `apps/desktop/src/shared/rpc-types.ts` | Shared TypeScript RPC type definitions |
| `apps/desktop/electrobun.config.ts` | Electrobun build configuration |
| `apps/desktop/package.json` | Desktop app metadata and scripts |
| `apps/desktop/tsconfig.json` | TypeScript config (ESM target for Bun) |
| `scripts/build-desktop.js` | Build helper — runs Electrobun build |

## RPC Bridge (`window.apex`)

The preload view (`src/preload/index.ts`) creates a typed RPC connection via Electrobun's `Electroview` class and exposes `window.apex` to the renderer:

```typescript
window.apex = {
  platform: string;       // e.g. 'darwin' — set via RPC message on dom-ready
  isElectron: true;       // used by dashboard to detect desktop mode
  openWindow: (urlPath: string) => void;    // RPC message to open a new window
  focusOrOpenWindow: (urlPath: string) => void;  // RPC message to focus/open window
  detectedIDEs: { cursor: boolean; vscode: boolean };  // set via RPC on dom-ready
  openInIDE: (params: OpenInIDEParams) => Promise<{ ok: boolean; error?: string }>;
}
```

The RPC type (`ApexRPCType`) defines:
- **Bun requests**: `openInIDE` — async request with response
- **Bun messages**: `openWindow`, `focusOrOpenWindow`, `openExternal` — fire-and-forget
- **Webview messages**: `setConfig` — main process sends platform/IDE info after page load

Dashboard code checks `window.apex?.isElectron` to switch behavior:

| Feature | Web (browser) | Desktop (Electrobun) |
|---|---|---|
| Open project from list | `window.open()` (new tab) | `apex.focusOrOpenWindow()` (RPC) |
| Open fork | `window.open()` (named tab) | `apex.openWindow()` (RPC, new window) |
| External URLs (ports) | `window.open()` (new tab) | Preload intercepts → `Utils.openExternal()` |
| Open in IDE | code-server in new tab | Native Cursor/VS Code via SSH if detected |
| Window dragging | N/A | Top bar has `-webkit-app-region: drag` |

## Window Management

- **Main window**: Created on app launch, loads `/` (project list)
- **Project windows**: Created via RPC `openWindow` message when opening forks
- **`window.open()` interception**: The preload overrides `window.open()` — internal URLs (same origin) create a new BrowserWindow via RPC, external URLs open in the system browser via `Utils.openExternal()`
- **macOS behavior**: `exitOnLastWindowClosed: false` in config, app stays running when all windows close

## Settings System

Same as web mode — API keys are configured from the dashboard Settings page (`/settings`):

- **Backend**: `SettingsModule` stores key-value pairs in the `settings` SQLite table
- **Frontend**: `SettingsPage` at `/settings` with form fields grouped by context (Agent API Keys, GitHub, Sandbox). The GitHub section includes token, git user name, and git user email — name/email auto-detected from the GitHub API when a token is set, with manual override support
- **Visibility**: `SETTINGS_VISIBLE=true` passed as env to the API subprocess

## Static File Serving

`@elysiajs/static` serves the dashboard from `DASHBOARD_DIR`:

```typescript
if (existsSync(dashboardDir)) {
  app.use(staticPlugin({
    assets: dashboardDir,
    prefix: '/',
    noCache: true,
    alwaysStatic: false,
  }));
}
```

- In desktop mode, `DASHBOARD_DIR` is set by the main process to the built dashboard location
- Handles SPA fallback so `BrowserRouter` works

## Build & Run Commands

```bash
# Development: build API + dashboard, run Electrobun dev mode
yarn desktop:dev

# Production build: build all, run Electrobun build
yarn desktop:build

# Package for distribution (stable build)
yarn desktop:package

# Normal web dev mode (unaffected by desktop changes)
yarn serve
```

## Packaging (Electrobun CLI)

Config: `apps/desktop/electrobun.config.ts`

- **Self-extracting bundle**: ~12MB compressed (mostly the Bun runtime)
- **DMG**: Auto-generated by Electrobun for macOS
- **Code signing & notarization**: Configured via `electrobun.config.ts` `mac.codesign` / `mac.notarize`
- **Updates**: Built-in bsdiff updater — patches as small as 14KB

## Data Storage

| Item | Location |
|---|---|
| SQLite database | `~/Library/Application Support/Apex/apex.sqlite` |
| Electrobun logs | stdout/stderr of the main process |
| API logs | Prefixed with `[api]` in the same terminal |

## Key Differences from Electron

| Aspect | Electron (old) | Electrobun (current) |
|---|---|---|
| Runtime | Node.js + Chromium | Bun + System WebKit |
| Bundle size | ~150MB+ | ~12MB |
| IPC | `ipcMain`/`ipcRenderer`/`contextBridge` | Typed RPC via `Electroview` |
| API subprocess | `child_process.fork()` | `Bun.spawn()` |
| Native modules | `@electron/rebuild` needed | Bun-native, no rebuild |
| Window management | `BrowserWindow` (Electron) | `BrowserWindow` (Electrobun) |
| External URLs | `shell.openExternal()` | `Utils.openExternal()` |
| Menus | `Menu.buildFromTemplate()` | `ApplicationMenu.setApplicationMenu()` |
| Packaging | `electron-builder` | `electrobun build` |
