/**
 * Global setup for E2E tests.
 *
 * Starts the API server with an isolated temp database, waits for it
 * to be ready, and stores the PID + DB path for teardown. Cleans up
 * stale processes from previous runs to avoid port conflicts.
 */
import { spawn, execSync, type ChildProcess } from 'child_process';
import { resolve, join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { config as loadDotenv } from 'dotenv';
import * as http from 'http';
import * as os from 'os';

const WORKSPACE_ROOT = resolve(__dirname, '../../../..');

// Load .env so E2E-specific keys (DAYTONA_API_KEY_E2E, etc.) are available
loadDotenv({ path: resolve(WORKSPACE_ROOT, '.env') });

// Map *_E2E keys to their base names so the API server and tests see them
if (process.env.DAYTONA_API_KEY_E2E && !process.env.DAYTONA_API_KEY) {
  process.env.DAYTONA_API_KEY = process.env.DAYTONA_API_KEY_E2E;
}
if (process.env.ANTHROPIC_API_KEY_E2E && !process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY_E2E;
}
if (process.env.GITHUB_TOKEN_E2E && !process.env.GITHUB_TOKEN) {
  process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN_E2E;
}

const HOST = process.env.HOST ?? 'localhost';
const PORT = process.env.PORT ? Number(process.env.PORT) : 6000;
const PROXY_PORT = 9350;
const STATE_FILE = resolve(__dirname, '../../.api-e2e-state.json');

function killProcessOnPort(port: number): void {
  try {
    const output = execSync(
      `lsof -ti :${port} 2>/dev/null`,
      { encoding: 'utf-8' },
    ).trim();
    if (output) {
      for (const pid of output.split('\n')) {
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch {}
      }
    }
  } catch {}
}

function waitForReady(
  host: string,
  port: number,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`API server not ready after ${timeoutMs}ms on ${host}:${port}`));
        return;
      }
      const req = http.get(`http://${host}:${port}/api/projects`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          res.resume();
          setTimeout(attempt, 500);
        }
      });
      req.on('error', () => setTimeout(attempt, 500));
      req.setTimeout(3000, () => {
        req.destroy();
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

module.exports = async function () {
  console.log('\nSetting up E2E tests...');

  killProcessOnPort(PORT);
  killProcessOnPort(PROXY_PORT);
  await new Promise((r) => setTimeout(r, 1000));

  // Create an isolated temp database so tests never pollute the dev DB
  const tmpDir = join(os.tmpdir(), `apex-e2e-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const dbPath = join(tmpDir, 'apex-e2e.sqlite');
  console.log(`Using temp DB: ${dbPath}`);

  const bunBin = resolve(WORKSPACE_ROOT, 'node_modules/.bin/bun');
  const apiEntry = resolve(WORKSPACE_ROOT, 'apps/api/src/main.ts');

  console.log(`Starting API server: ${bunBin} run ${apiEntry} (port ${PORT})`);

  const child = spawn(bunBin, ['run', apiEntry], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: HOST,
      APEX_E2E_TEST: '1',
      DB_PATH: dbPath,
    },
    // stdin must be 'pipe' and kept open — the API exits on stdin EOF
    // (desktop parent-death detection). 'ignore' would cause immediate shutdown.
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  // Persist PID + DB path so teardown can clean up even if globalThis isn't shared
  writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid, dbPath, tmpDir }));

  let serverOutput = '';
  let startupComplete = false;

  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    serverOutput += text;
    if (process.env.E2E_VERBOSE) {
      process.stdout.write(`[api] ${text}`);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    serverOutput += text;
    if (process.env.E2E_VERBOSE) {
      process.stderr.write(`[api:err] ${text}`);
    }
  });

  const earlyExit = new Promise<never>((_, reject) => {
    const onExit = (code: number | null, signal: string | null) => {
      if (!startupComplete) {
        reject(
          new Error(
            `API server exited during startup (code=${code}, signal=${signal}).\n` +
              `Output:\n${serverOutput.slice(-2000)}`,
          ),
        );
      }
    };
    child.on('exit', onExit);
    (child as any).__earlyExitListener = onExit;
  });

  console.log(`Waiting for API on ${HOST}:${PORT}...`);

  try {
    await Promise.race([
      waitForReady(HOST, PORT, 90_000),
      earlyExit,
    ]);
  } catch (err) {
    try { child.kill('SIGKILL'); } catch {}
    throw err;
  }

  startupComplete = true;
  child.removeListener('exit', (child as any).__earlyExitListener);
  earlyExit.catch(() => {});

  // Monitor for unexpected exits during test run
  child.on('exit', (code, signal) => {
    console.error(`\n[global-setup] API server exited unexpectedly! code=${code} signal=${signal}`);
    console.error(`[global-setup] Last output:\n${serverOutput.slice(-1000)}`);
  });

  console.log('API server is ready.\n');

  (globalThis as any).__E2E_API_PROCESS__ = child;
  (globalThis as any).__E2E_TMP_DIR__ = tmpDir;
};
