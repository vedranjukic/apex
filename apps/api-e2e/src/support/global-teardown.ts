/**
 * Global teardown for E2E tests.
 *
 * Kills the API server process and removes the temp database that were
 * created in global-setup. Uses both globalThis and a state file fallback.
 */
import { readFileSync, unlinkSync, rmSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = resolve(__dirname, '../../.api-e2e-state.json');

function killTree(pid: number): void {
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

  // Method 2: state file fallback (PID + temp DB path)
  let tmpDir = (globalThis as any).__E2E_TMP_DIR__;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    if (state.pid > 0) killTree(state.pid);
    tmpDir = tmpDir || state.tmpDir;
    unlinkSync(STATE_FILE);
  } catch {}

  // Remove temp database directory
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      console.log(`Removed temp DB: ${tmpDir}`);
    } catch {}
  }

  console.log('Teardown complete.\n');
};
