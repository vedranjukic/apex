/* eslint-disable */

module.exports = async function () {
  const port = process.env.PORT ? Number(process.env.PORT) : 6000;
  console.log(`\nTearing down (killing port ${port})...`);
  try {
    // Use process.kill directly on PIDs found by net inspection
    const { execSync } = require('child_process');
    const pids = execSync(`lsof -ti:${port} 2>/dev/null || true`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (pids) {
      for (const pid of pids.split('\n')) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    }
  } catch {
    // ignore — port may already be free
  }
  // Force exit after 2s regardless
  setTimeout(() => process.exit(0), 2000).unref();
};
