/**
 * Global teardown for E2E tests.
 *
 * Kills the API server process that was started in global-setup.
 * Uses both globalThis handle and a PID file fallback.
 */
import { readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';

const PID_FILE = resolve(__dirname, '../../.api-e2e-pid');

function killTree(pid: number): void {
  // Kill the process and its children (apex-proxy spawned by the API)
  try { process.kill(-pid, 'SIGKILL'); } catch {}
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

module.exports = async function () {
  console.log('\nTearing down E2E tests...');

  // Method 1: use the in-memory process handle
  const child = (globalThis as any).__E2E_API_PROCESS__;
  if (child && !child.killed) {
    console.log(`Stopping API server (pid=${child.pid})...`);
    killTree(child.pid);
  }

  // Method 2: PID file fallback
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf-8').trim());
    if (pid > 0) killTree(pid);
    unlinkSync(PID_FILE);
  } catch {}

  console.log('Teardown complete.\n');
};
