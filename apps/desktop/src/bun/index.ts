import {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  ContextMenu,
  Utils,
} from 'electrobun/bun';
import Electrobun from 'electrobun/bun';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import type {
  ApexRPCType,
  DetectedIDEs,
  OpenInIDEParams,
  PortRelayConfig,
} from '../shared/rpc-types';
import { PortRelayManager } from './port-relay-manager';

let apiProcess: ReturnType<typeof Bun.spawn> | null = null;
let serverPort = 0;
let portRelayManager: PortRelayManager | null = null;

const allWindows = new Map<number, BrowserWindow>();

// ── IDE Detection ───────────────────────────────────

let detectedIDEs: DetectedIDEs = { cursor: false, vscode: false };

function detectIDEs(): DetectedIDEs {
  const checkApp = (appPaths: string[]): boolean =>
    appPaths.some((p) => fs.existsSync(p));

  const checkCli = (cmd: string): boolean => {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  const cursor =
    checkApp([
      '/Applications/Cursor.app',
      path.join(os.homedir(), 'Applications/Cursor.app'),
    ]) || checkCli('cursor');

  const vscode =
    checkApp([
      '/Applications/Visual Studio Code.app',
      path.join(os.homedir(), 'Applications/Visual Studio Code.app'),
    ]) || checkCli('code');

  return { cursor, vscode };
}

// ── SSH Config Management ───────────────────────────

const SSH_DIR = path.join(os.homedir(), '.ssh');
const APEX_SSH_CONFIG = path.join(SSH_DIR, 'apex-config');
const MAIN_SSH_CONFIG = path.join(SSH_DIR, 'config');
const INCLUDE_LINE = 'Include ~/.ssh/apex-config';

function ensureSshDir(): void {
  if (!fs.existsSync(SSH_DIR)) {
    fs.mkdirSync(SSH_DIR, { mode: 0o700, recursive: true });
  }
}

function ensureSshInclude(): void {
  ensureSshDir();
  if (fs.existsSync(MAIN_SSH_CONFIG)) {
    const content = fs.readFileSync(MAIN_SSH_CONFIG, 'utf-8');
    if (!content.includes(INCLUDE_LINE)) {
      fs.writeFileSync(MAIN_SSH_CONFIG, `${INCLUDE_LINE}\n\n${content}`, {
        mode: 0o600,
      });
    }
  } else {
    fs.writeFileSync(MAIN_SSH_CONFIG, `${INCLUDE_LINE}\n`, { mode: 0o600 });
  }
}

function writeSshHostEntry(params: {
  sandboxId: string;
  sshUser: string;
  sshHost: string;
  sshPort: number;
}): string {
  ensureSshDir();
  ensureSshInclude();

  const alias = `apex-${params.sandboxId}`;
  const block = [
    `# ${alias}`,
    `Host ${alias}`,
    `  HostName ${params.sshHost}`,
    `  User ${params.sshUser}`,
    `  Port ${params.sshPort}`,
    `  StrictHostKeyChecking no`,
    `  UserKnownHostsFile /dev/null`,
    '',
  ].join('\n');

  let content = '';
  if (fs.existsSync(APEX_SSH_CONFIG)) {
    content = fs.readFileSync(APEX_SSH_CONFIG, 'utf-8');
  }

  const blockStart = `# ${alias}`;
  const idx = content.indexOf(blockStart);
  if (idx !== -1) {
    const nextBlock = content.indexOf('\n# apex-', idx + blockStart.length);
    const before = content.substring(0, idx);
    const after = nextBlock !== -1 ? content.substring(nextBlock) : '';
    content = before + block + after;
  } else {
    content = content + block;
  }

  fs.writeFileSync(APEX_SSH_CONFIG, content, { mode: 0o600 });
  return alias;
}

// ── Open in IDE ─────────────────────────────────────

function resolveIDECli(ide: 'cursor' | 'vscode'): string {
  if (ide === 'cursor') {
    const appBin =
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
    const homeBin = path.join(
      os.homedir(),
      'Applications/Cursor.app/Contents/Resources/app/bin/cursor'
    );
    if (fs.existsSync(appBin)) return appBin;
    if (fs.existsSync(homeBin)) return homeBin;
    return 'cursor';
  } else {
    const appBin =
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    const homeBin = path.join(
      os.homedir(),
      'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    );
    if (fs.existsSync(appBin)) return appBin;
    if (fs.existsSync(homeBin)) return homeBin;
    return 'code';
  }
}

function openInIDE(params: OpenInIDEParams): void {
  const alias = writeSshHostEntry(params);
  const cli = resolveIDECli(params.ide);
  const remoteArg = `ssh-remote+${alias}`;

  Bun.spawn([cli, '--remote', remoteArg, params.remotePath], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

// ── Server Utilities ────────────────────────────────

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine port')));
      }
    });
    server.on('error', reject);
  });
}

let apiStderrLog = '';

async function waitForServer(
  port: number,
  timeoutMs = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (apiProcess && apiProcess.exitCode !== null) {
      throw new Error(
        `API process exited with code ${apiProcess.exitCode}\n\n${apiStderrLog || '(no stderr output)'}`
      );
    }
    try {
      const res = await fetch(
        `http://localhost:${port}/api/settings/visible`
      );
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `API server did not start within ${timeoutMs}ms\n\n${apiStderrLog || '(no stderr output)'}`
  );
}

function resolveAppPath(...parts: string[]): string {
  const execDir = path.dirname(process.execPath);

  // macOS: Apex.app/Contents/MacOS/bun → ../Resources/
  const macResources = path.resolve(execDir, '..', 'Resources');
  if (fs.existsSync(path.join(macResources, 'apps'))) {
    return path.join(macResources, ...parts);
  }

  // Linux: Apex-dev/<bun> → Resources/
  const linuxResources = path.resolve(execDir, 'Resources');
  if (fs.existsSync(path.join(linuxResources, 'apps'))) {
    return path.join(linuxResources, ...parts);
  }

  // Dev fallback: project root is 4 levels up from src/bun/index.ts
  const devRoot = path.resolve(__dirname, '../../../..');
  return path.join(devRoot, ...parts);
}

function getUserDataPath(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Apex');
  } else if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData/Roaming/Apex');
  }
  return path.join(os.homedir(), '.config/apex');
}

function isPackaged(): boolean {
  const execDir = path.dirname(process.execPath);
  const macResources = path.resolve(execDir, '..', 'Resources');
  const linuxResources = path.resolve(execDir, 'Resources');
  return (
    fs.existsSync(path.join(macResources, 'apps')) ||
    fs.existsSync(path.join(linuxResources, 'apps'))
  );
}

function loadDotEnv(): Record<string, string> {
  const envPaths = [
    resolveAppPath('.env'),
    path.join(getUserDataPath(), '.env'),
  ];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    const vars: Record<string, string> = {};
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
    console.log(`Loaded ${Object.keys(vars).length} env var(s) from ${envPath}`);
    return vars;
  }
  return {};
}

async function startApi(port: number): Promise<void> {
  const apiMain = resolveAppPath('apps', 'api', 'dist', 'main.js');
  const dashboardDir = resolveAppPath('apps', 'dashboard', 'dist');

  let dbPath: string;
  if (isPackaged()) {
    const userDataDir = getUserDataPath();
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    dbPath = path.join(userDataDir, 'apex.sqlite');
  } else {
    const devDbDir = resolveAppPath('apps', 'api', 'data');
    if (!fs.existsSync(devDbDir)) {
      fs.mkdirSync(devDbDir, { recursive: true });
    }
    dbPath = path.join(devDbDir, 'apex.sqlite');
  }

  console.log(`Starting API: ${apiMain} (exists: ${fs.existsSync(apiMain)})`);
  console.log(`Dashboard dir: ${dashboardDir} (exists: ${fs.existsSync(dashboardDir)})`);
  console.log(`DB path: ${dbPath}`);

  const dotEnvVars = loadDotEnv();

  apiProcess = Bun.spawn([process.execPath, apiMain], {
    env: {
      ...dotEnvVars,
      ...process.env,
      PORT: String(port),
      HOST: '0.0.0.0',
      DB_PATH: dbPath,
      DASHBOARD_DIR: dashboardDir,
      MOBILE_DASHBOARD_DIR: resolveAppPath('apps', 'mobile-dashboard', 'dist'),
      APEX_PROXY_BIN: (() => {
        const bundled = resolveAppPath('bin', 'apex-proxy');
        if (fs.existsSync(bundled)) return bundled;
        const devBuild = resolveAppPath('apps', 'proxy', 'target', 'release', 'apex-proxy');
        if (fs.existsSync(devBuild)) return devBuild;
        return bundled;
      })(),
      APEX_PROXY_LINUX_BIN: (() => {
        const musl = resolveAppPath('apps', 'proxy', 'target', 'x86_64-unknown-linux-musl', 'release', 'apex-proxy');
        if (fs.existsSync(musl)) return musl;
        const gnu = resolveAppPath('apps', 'proxy', 'target', 'x86_64-unknown-linux-gnu', 'release', 'apex-proxy');
        if (fs.existsSync(gnu)) return gnu;
        return musl;
      })(),
      SETTINGS_VISIBLE: 'true',
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Stream API output to console
  (async () => {
    if (apiProcess?.stdout && typeof apiProcess.stdout !== 'number') {
      const reader = apiProcess.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          process.stdout.write(`[api] ${decoder.decode(value)}`);
        }
      } catch {
        // process exited
      }
    }
  })();

  (async () => {
    if (apiProcess?.stderr && typeof apiProcess.stderr !== 'number') {
      const reader = apiProcess.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          apiStderrLog += chunk;
          process.stderr.write(`[api] ${chunk}`);
        }
      } catch {
        // process exited
      }
    }
  })();

  await waitForServer(port);
}

// ── RPC Setup ───────────────────────────────────────

function createRpcHandlers(winRef: { current: BrowserWindow | null }) {
  return BrowserView.defineRPC<ApexRPCType>({
    maxRequestTime: 10000,
    handlers: {
      requests: {
        openInIDE: (params) => {
          try {
            openInIDE(params);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
        showContextMenu: (params) => {
          return new Promise<{ action: string | null }>((resolve) => {
            const menuItems = params.items.map((item) => {
              if (item.type === 'separator') return { type: 'separator' as const };
              return {
                label: item.label ?? '',
                action: item.action ?? '',
                accelerator: item.accelerator,
                enabled: item.enabled ?? true,
              };
            });

            const handler = (e: { data: { action: string } }) => {
              Electrobun.events.off('context-menu-clicked', handler);
              resolve({ action: e.data.action });
            };

            Electrobun.events.on('context-menu-clicked', handler);
            ContextMenu.showContextMenu(menuItems);

            setTimeout(() => {
              Electrobun.events.off('context-menu-clicked', handler);
              resolve({ action: null });
            }, 30000);
          });
        },
        getPortRelayConfig: () => {
          return portRelayManager?.getConfig() || {
            enabled: false,
            autoForwardNewPorts: false,
            portRange: { start: 8000, end: 9000 },
            excludedPorts: []
          };
        },
        setPortRelayConfig: (params) => {
          try {
            if (!portRelayManager) {
              return { ok: false, error: 'Port relay manager not initialized' };
            }
            portRelayManager.setConfig(params);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
        forwardPort: async (params) => {
          try {
            if (!portRelayManager) {
              return { ok: false, error: 'Port relay manager not initialized' };
            }
            
            const previewRes = await fetch(
              `http://localhost:${serverPort}/api/preview/${params.sandboxId}/${params.remotePort}`
            );
            let remoteHost = 'localhost';
            if (previewRes.ok) {
              const preview = await previewRes.json();
              if (preview.url) {
                try { remoteHost = new URL(preview.url).hostname; } catch { /* keep localhost */ }
              }
            }
            
            const localPort = await portRelayManager.forwardPort(
              params.sandboxId, 
              remoteHost, 
              params.remotePort, 
              params.localPort
            );
            
            return { ok: true, localPort };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
        unforwardPort: (params) => {
          try {
            if (!portRelayManager) {
              return { ok: false, error: 'Port relay manager not initialized' };
            }
            
            const success = portRelayManager.unforwardPort(params.sandboxId, params.remotePort);
            return { ok: success };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        },
        getRelayedPorts: (params) => {
          if (!portRelayManager) {
            return { ports: [] };
          }
          
          return { ports: portRelayManager.getRelayedPorts(params.sandboxId) };
        },
      },
      messages: {
        openWindow: ({ urlPath }) => {
          createWindow(urlPath);
        },
        focusOrOpenWindow: ({ urlPath }) => {
          const targetPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
          for (const [, win] of allWindows) {
            // Electrobun doesn't expose the current URL directly,
            // so we track URL paths ourselves
            const winPath = (win as any).__urlPath as string | undefined;
            if (winPath === targetPath) {
              win.focus();
              return;
            }
          }
          createWindow(urlPath);
        },
        openExternal: ({ url }) => {
          Utils.openExternal(url);
        },
        urlChanged: ({ urlPath }) => {
          if (winRef.current) {
            (winRef.current as any).__urlPath = urlPath;
          }
        },
      },
    },
  });
}

// ── Window Management ───────────────────────────────

function createWindow(urlPath = '/'): BrowserWindow {
  const winRef: { current: BrowserWindow | null } = { current: null };
  const rpc = createRpcHandlers(winRef);

  const win = new BrowserWindow({
    title: 'Apex',
    url: `http://127.0.0.1:${serverPort}${urlPath}`,
    frame: {
      width: 1400,
      height: 900,
      x: 100,
      y: 100,
    },
    titleBarStyle: 'hiddenInset',
    preload: 'views://preload/index.js',
    rpc,
  });

  // Track URL path for focus-or-open logic
  (win as any).__urlPath = urlPath;
  winRef.current = win;

  allWindows.set(win.id, win);

  // Send config to the webview after the page loads
  win.webview.on('dom-ready', () => {
    (win.webview.rpc as any)?.send?.setConfig({
      platform: process.platform,
      detectedIDEs,
    });
    
    // Send initial port relay config
    if (portRelayManager) {
      (win.webview.rpc as any)?.send?.portRelayConfigUpdate({
        config: portRelayManager.getConfig()
      });
    }
  });

  win.on('close', () => {
    allWindows.delete(win.id);
  });

  return win;
}

// ── App Menu ────────────────────────────────────────

function getApexVersion(): string {
  try {
    const versionFile = resolveAppPath('VERSION');
    return fs.readFileSync(versionFile, 'utf-8').trim();
  } catch {
    return '0.0.1';
  }
}

function buildAppMenu(): void {
  const apexVersion = getApexVersion();

  ApplicationMenu.setApplicationMenu([
    {
      submenu: [
        { label: `About Apex v${apexVersion}`, action: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleFullScreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'bringAllToFront' },
      ],
    },
  ]);
}

// ── App Lifecycle ───────────────────────────────────

function killApi() {
  if (portRelayManager) {
    portRelayManager.destroy();
    portRelayManager = null;
  }
  
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
}

async function main() {
  buildAppMenu();
  detectedIDEs = detectIDEs();
  console.log('Detected IDEs:', detectedIDEs);

  // Initialize port relay manager
  const userDataPath = getUserDataPath();
  portRelayManager = new PortRelayManager(userDataPath);
  
  // Set up event listeners for port relay
  portRelayManager.addEventListener((event) => {
    if (event.type === 'config-updated') {
      // Notify all windows of config changes
      for (const [, win] of allWindows) {
        (win.webview.rpc as any)?.send?.portRelayConfigUpdate({ config: event.data });
      }
    } else if (event.type === 'ports-updated') {
      // Notify all windows of port status changes
      for (const sandboxId of event.data.sandboxPorts.keys()) {
        const ports = event.data.sandboxPorts.get(sandboxId);
        for (const [, win] of allWindows) {
          (win.webview.rpc as any)?.send?.portRelayStatusUpdate({ sandboxId, ports });
        }
      }
    }
  });

  serverPort = await getFreePort();

  try {
    console.log(`Starting API on port ${serverPort}...`);
    await startApi(serverPort);
    console.log('API ready, opening window...');
    createWindow();
    
  } catch (err) {
    console.error('Failed to start API:', err);
    new BrowserWindow({
      title: 'Apex - Error',
      html: `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f1117;color:#f87171;font-family:system-ui;font-size:13px;padding:40px;text-align:center;white-space:pre-wrap">${String(err)}</body></html>`,
      frame: { width: 500, height: 300, x: 200, y: 200 },
    });
  }
}

Electrobun.events.on('close', () => {
  if (allWindows.size === 0 && process.platform !== 'darwin') {
    killApi();
  }
});

process.on('exit', killApi);
process.on('SIGINT', () => { killApi(); process.exit(0); });
process.on('SIGTERM', () => { killApi(); process.exit(0); });

main();
