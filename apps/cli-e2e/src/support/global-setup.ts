/* eslint-disable */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function () {
  const root = process.cwd();
  const cliDir = path.join(root, 'apps', 'cli');
  const binPath = path.join(cliDir, 'bin', 'apex');
  try {
    console.log('\nBuilding apex CLI...\n');
    execSync('go build -o bin/apex .', {
      cwd: cliDir,
      stdio: 'inherit',
    });
  } catch {
    if (fs.existsSync(binPath)) {
      console.log('Using existing apex binary (build failed)\n');
    } else {
      throw new Error(
        'apex CLI build failed and no existing binary at apps/cli/bin/apex. Fix the CLI build first.'
      );
    }
  }
  globalThis.__APEX_BIN__ = binPath;
  globalThis.__TEARDOWN_MESSAGE__ = '\nCLI e2e teardown complete.\n';
};
