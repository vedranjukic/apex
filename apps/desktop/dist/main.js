"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const net = __importStar(require("net"));
electron_1.app.name = 'Apex';
let apiProcess = null;
let serverPort = 0;
let detectedIDEs = { cursor: false, vscode: false };
function detectIDEs() {
    const checkApp = (appPaths) => appPaths.some((p) => fs.existsSync(p));
    const checkCli = (cmd) => {
        try {
            (0, child_process_1.execSync)(`which ${cmd}`, { stdio: 'ignore' });
            return true;
        }
        catch {
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
function ensureSshDir() {
    if (!fs.existsSync(SSH_DIR)) {
        fs.mkdirSync(SSH_DIR, { mode: 0o700, recursive: true });
    }
}
function ensureSshInclude() {
    ensureSshDir();
    if (fs.existsSync(MAIN_SSH_CONFIG)) {
        const content = fs.readFileSync(MAIN_SSH_CONFIG, 'utf-8');
        if (!content.includes(INCLUDE_LINE)) {
            fs.writeFileSync(MAIN_SSH_CONFIG, `${INCLUDE_LINE}\n\n${content}`, {
                mode: 0o600,
            });
        }
    }
    else {
        fs.writeFileSync(MAIN_SSH_CONFIG, `${INCLUDE_LINE}\n`, { mode: 0o600 });
    }
}
function writeSshHostEntry(params) {
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
    }
    else {
        content = content + block;
    }
    fs.writeFileSync(APEX_SSH_CONFIG, content, { mode: 0o600 });
    return alias;
}
function resolveIDECli(ide) {
    if (ide === 'cursor') {
        const appBin = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
        const homeBin = path.join(os.homedir(), 'Applications/Cursor.app/Contents/Resources/app/bin/cursor');
        if (fs.existsSync(appBin))
            return appBin;
        if (fs.existsSync(homeBin))
            return homeBin;
        return 'cursor';
    }
    else {
        const appBin = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
        const homeBin = path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
        if (fs.existsSync(appBin))
            return appBin;
        if (fs.existsSync(homeBin))
            return homeBin;
        return 'code';
    }
}
function openInIDE(params) {
    const alias = writeSshHostEntry(params);
    const cli = resolveIDECli(params.ide);
    const remoteArg = `ssh-remote+${alias}`;
    (0, child_process_1.spawn)(cli, ['--remote', remoteArg, params.remotePath], {
        detached: true,
        stdio: 'ignore',
    }).unref();
}
// ── Server Utilities ────────────────────────────────
function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                const port = addr.port;
                server.close(() => resolve(port));
            }
            else {
                server.close(() => reject(new Error('Could not determine port')));
            }
        });
        server.on('error', reject);
    });
}
async function waitForServer(port, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`http://localhost:${port}/api/settings/visible`);
            if (res.ok)
                return;
        }
        catch {
            // server not ready yet
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`API server did not start within ${timeoutMs}ms`);
}
function resolveAppPath(...parts) {
    if (electron_1.app.isPackaged) {
        return path.join(process.resourcesPath, 'app', ...parts);
    }
    return path.join(__dirname, '../../..', ...parts);
}
async function startApi(port) {
    const apiMain = resolveAppPath('apps', 'api', 'dist', 'main.js');
    const dashboardDir = resolveAppPath('apps', 'dashboard', 'dist');
    const dbPath = path.join(electron_1.app.getPath('userData'), 'apex.sqlite');
    apiProcess = (0, child_process_1.fork)(apiMain, [], {
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
    apiProcess.stdout?.on('data', (data) => {
        process.stdout.write(`[api] ${data}`);
    });
    apiProcess.stderr?.on('data', (data) => {
        process.stderr.write(`[api] ${data}`);
    });
    apiProcess.on('exit', (code) => {
        console.log(`API process exited with code ${code}`);
        apiProcess = null;
    });
    await waitForServer(port);
}
function createWindow(urlPath = '/') {
    const win = new electron_1.BrowserWindow({
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
        }
        catch {
            // malformed URL
        }
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    return win;
}
// ── IPC Handlers ────────────────────────────────────
electron_1.ipcMain.on('open-window', (_event, urlPath) => {
    createWindow(urlPath);
});
electron_1.ipcMain.on('focus-or-open-window', (_event, urlPath) => {
    const targetPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        try {
            const winPath = new URL(win.webContents.getURL()).pathname;
            if (winPath === targetPath) {
                if (win.isMinimized())
                    win.restore();
                win.focus();
                return;
            }
        }
        catch {
            // ignore malformed URLs
        }
    }
    createWindow(urlPath);
});
electron_1.ipcMain.on('get-detected-ides', (event) => {
    event.returnValue = detectedIDEs;
});
electron_1.ipcMain.handle('open-in-ide', (_event, params) => {
    try {
        openInIDE(params);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: String(err) };
    }
});
// ── App Menu ────────────────────────────────────────
function getApexVersion() {
    try {
        const versionFile = electron_1.app.isPackaged
            ? path.join(process.resourcesPath, 'app', 'VERSION')
            : path.join(__dirname, '../../..', 'VERSION');
        return fs.readFileSync(versionFile, 'utf-8').trim();
    }
    catch {
        return '0.0.1';
    }
}
function buildAppMenu() {
    const apexVersion = getApexVersion();
    const template = [
        {
            label: electron_1.app.name,
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
    electron_1.app.setAboutPanelOptions({
        applicationName: 'Daytona Apex IDE',
        applicationVersion: apexVersion,
        version: '',
        copyright: '© Daytona Platforms Inc.',
    });
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
// ── App Lifecycle ───────────────────────────────────
electron_1.app.whenReady().then(async () => {
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
    }
    catch (err) {
        console.error('Failed to start API:', err);
        const errWin = new electron_1.BrowserWindow({ width: 500, height: 300, center: true });
        errWin.loadURL(`data:text/html,<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f1117;color:#f87171;font-family:system-ui;font-size:13px;padding:40px;text-align:center;white-space:pre-wrap">${String(err)}</body></html>`);
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0 && apiProcess) {
        createWindow();
    }
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        killApi();
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    killApi();
});
function killApi() {
    if (apiProcess) {
        apiProcess.kill();
        apiProcess = null;
    }
}
//# sourceMappingURL=main.js.map