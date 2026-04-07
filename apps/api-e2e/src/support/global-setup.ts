/**
 * Global setup for E2E tests.
 *
 * Starts the API server as a child process, waits for it to be ready,
 * and stores the PID for teardown. Cleans up stale processes from
 * previous runs to avoid port conflicts.
 */
import { spawn, execSync, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import * as http from 'http';

const HOST = process.env.HOST ?? 'localhost';
const PORT = process.env.PORT ? Number(process.env.PORT) : 6000;
const PROXY_PORT = 9350;
const WORKSPACE_ROOT = resolve(__dirname, '../../../..');
const PID_FILE = resolve(__dirname, '../../.api-e2e-pid');

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
    },
    // stdin must be 'pipe' and kept open — the API exits on stdin EOF
    // (desktop parent-death detection). 'ignore' would cause immediate shutdown.
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  writeFileSync(PID_FILE, String(child.pid));

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

  // Detect crashes during startup only. Once startup is complete,
  // the exit listener is removed to avoid unhandled rejections during teardown.
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
    // Store for cleanup
    (child as any).__earlyExitListener = onExit;
  });

  console.log(`Waiting for API on ${HOST}:${PORT}...`);

  try {
    await Promise.race([
      waitForReady(HOST, PORT, 30_000),
      earlyExit,
    ]);
  } catch (err) {
    try { child.kill('SIGKILL'); } catch {}
    throw err;
  }

  // Startup succeeded — remove the exit listener so teardown kill doesn't
  // trigger an unhandled rejection
  startupComplete = true;
  child.removeListener('exit', (child as any).__earlyExitListener);

  // Suppress any unhandled rejections from the now-orphaned earlyExit promise
  earlyExit.catch(() => {});

  console.log('API server is ready.\n');

  (globalThis as any).__E2E_API_PROCESS__ = child;
};
