import {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
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
} from '../shared/rpc-types';

let apiProcess: ReturnType<typeof Bun.spawn> | null = null;
let serverPort = 0;

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

async function waitForServer(
  port: number,
  timeoutMs = 15000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
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
  throw new Error(`API server did not start within ${timeoutMs}ms`);
}

function resolveAppPath(...parts: string[]): string {
  // In dev mode, paths are relative to the project root
  // In production (bundled), paths are relative to the app bundle resources
  const devRoot = path.join(__dirname, '../../../..');
  const prodRoot = path.join(__dirname, '../../..');

  if (fs.existsSync(path.join(devRoot, 'apps'))) {
    return path.join(devRoot, ...parts);
  }
  return path.join(prodRoot, ...parts);
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

async function startApi(port: number): Promise<void> {
  const apiMain = resolveAppPath('apps', 'api', 'dist', 'main.js');
  const dashboardDir = resolveAppPath('apps', 'dashboard', 'dist');
  const userDataDir = getUserDataPath();

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const dbPath = path.join(userDataDir, 'apex.sqlite');

  console.log(`Starting API: ${apiMain}`);
  console.log(`Dashboard dir: ${dashboardDir}`);
  console.log(`DB path: ${dbPath}`);

  apiProcess = Bun.spawn([process.execPath, apiMain], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '0.0.0.0',
      DB_PATH: dbPath,
      DASHBOARD_DIR: dashboardDir,
      SETTINGS_VISIBLE: 'true',
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Stream API output to console
  (async () => {
    if (apiProcess?.stdout) {
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
    if (apiProcess?.stderr) {
      const reader = apiProcess.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          process.stderr.write(`[api] ${decoder.decode(value)}`);
        }
      } catch {
        // process exited
      }
    }
  })();

  await waitForServer(port);
}

// ── RPC Setup ───────────────────────────────────────

function createRpcHandlers() {
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
      },
    },
  });
}

// ── Window Management ───────────────────────────────

function createWindow(urlPath = '/'): BrowserWindow {
  const rpc = createRpcHandlers();

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

  allWindows.set(win.id, win);

  // Send config to the webview after the page loads
  win.webview.on('dom-ready', () => {
    win.webview.rpc.send.setConfig({
      platform: process.platform,
      detectedIDEs,
    });
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
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
}

async function main() {
  buildAppMenu();
  detectedIDEs = detectIDEs();
  console.log('Detected IDEs:', detectedIDEs);

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
