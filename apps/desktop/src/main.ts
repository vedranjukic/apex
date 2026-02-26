import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron';
import { execSync, fork, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';

app.name = 'Apex';

let apiProcess: ChildProcess | null = null;
let serverPort = 0;

// ── IDE Detection ───────────────────────────────────

interface DetectedIDEs {
  cursor: boolean;
  vscode: boolean;
}

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

  const cursor = checkApp([
    '/Applications/Cursor.app',
    path.join(os.homedir(), 'Applications/Cursor.app'),
  ]) || checkCli('cursor');

  const vscode = checkApp([
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

// ── Open in IDE IPC Handler ─────────────────────────

interface OpenInIDEParams {
  ide: 'cursor' | 'vscode';
  sshUser: string;
  sshHost: string;
  sshPort: number;
  sandboxId: string;
  remotePath: string;
}

function resolveIDECli(ide: 'cursor' | 'vscode'): string {
  if (ide === 'cursor') {
    const appBin = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
    const homeBin = path.join(os.homedir(), 'Applications/Cursor.app/Contents/Resources/app/bin/cursor');
    if (fs.existsSync(appBin)) return appBin;
    if (fs.existsSync(homeBin)) return homeBin;
    return 'cursor';
  } else {
    const appBin = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    const homeBin = path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
    if (fs.existsSync(appBin)) return appBin;
    if (fs.existsSync(homeBin)) return homeBin;
    return 'code';
  }
}

function openInIDE(params: OpenInIDEParams): void {
  const alias = writeSshHostEntry(params);
  const cli = resolveIDECli(params.ide);
  const remoteArg = `ssh-remote+${alias}`;

  spawn(cli, ['--remote', remoteArg, params.remotePath], {
    detached: true,
    stdio: 'ignore',
  }).unref();
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

async function waitForServer(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/settings/visible`);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`API server did not start within ${timeoutMs}ms`);
}

function resolveAppPath(...parts: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', ...parts);
  }
  return path.join(__dirname, '../../..', ...parts);
}

async function startApi(port: number): Promise<void> {
  const apiMain = resolveAppPath('apps', 'api', 'dist', 'main.js');
  const dashboardDir = resolveAppPath('apps', 'dashboard', 'dist');
  const dbPath = path.join(app.getPath('userData'), 'apex.sqlite');

  apiProcess = fork(apiMain, [], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      DASHBOARD_DIR: dashboardDir,
      SETTINGS_VISIBLE: 'true',
    },
    stdio: 'pipe',
  });

  apiProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[api] ${data}`);
  });
  apiProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[api] ${data}`);
  });

  apiProcess.on('exit', (code) => {
    console.log(`API process exited with code ${code}`);
    apiProcess = null;
  });

  await waitForServer(port);
}

function createWindow(urlPath = '/'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(`http://127.0.0.1:${serverPort}${urlPath}`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const origin = `http://127.0.0.1:${serverPort}`;
      if (parsed.origin === origin) {
        createWindow(parsed.pathname);
        return { action: 'deny' };
      }
    } catch {
      // malformed URL
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ── IPC Handlers ────────────────────────────────────

ipcMain.on('open-window', (_event, urlPath: string) => {
  createWindow(urlPath);
});

ipcMain.on('focus-or-open-window', (_event, urlPath: string) => {
  const origin = `http://127.0.0.1:${serverPort}`;
  const targetUrl = `${origin}${urlPath}`;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.getURL().startsWith(targetUrl)) {
      if (win.isMinimized()) win.restore();
      win.focus();
      return;
    }
  }
  createWindow(urlPath);
});

ipcMain.on('get-detected-ides', (event) => {
  event.returnValue = detectedIDEs;
});

ipcMain.handle('open-in-ide', (_event, params: OpenInIDEParams) => {
  try {
    openInIDE(params);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ── App Menu ────────────────────────────────────────

function getApexVersion(): string {
  try {
    const versionFile = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'VERSION')
      : path.join(__dirname, '../../..', 'VERSION');
    return fs.readFileSync(versionFile, 'utf-8').trim();
  } catch {
    return '0.0.1';
  }
}

function buildAppMenu(): void {
  const apexVersion = getApexVersion();

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'About Apex',
          role: 'about',
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  app.setAboutPanelOptions({
    applicationName: 'Daytona Apex IDE',
    applicationVersion: apexVersion,
    version: '',
    copyright: '© Daytona Platforms Inc.',
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App Lifecycle ───────────────────────────────────

app.whenReady().then(async () => {
  buildAppMenu();
  detectedIDEs = detectIDEs();
  console.log('Detected IDEs:', detectedIDEs);

  serverPort = await getFreePort();

  try {
    console.log(`Starting API on port ${serverPort}...`);
    const apiMain = resolveAppPath('apps', 'api', 'dist', 'main.js');
    console.log(`API entry: ${apiMain}`);
    await startApi(serverPort);
    console.log('API ready, opening window...');
    createWindow();
  } catch (err) {
    console.error('Failed to start API:', err);
    const errWin = new BrowserWindow({ width: 500, height: 300, center: true });
    errWin.loadURL(`data:text/html,<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f1117;color:#f87171;font-family:system-ui;font-size:13px;padding:40px;text-align:center;white-space:pre-wrap">${String(err)}</body></html>`);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && apiProcess) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    killApi();
    app.quit();
  }
});

app.on('before-quit', () => {
  killApi();
});

function killApi() {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
}
