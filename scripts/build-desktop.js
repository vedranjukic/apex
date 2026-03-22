#!/usr/bin/env node

/**
 * Build script for the Apex desktop (Electrobun) app.
 *
 * Runs the Electrobun build for the desktop app.
 * Dependencies are installed via the root `yarn install` (workspace).
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP_DIR = path.join(ROOT, 'apps', 'desktop');

function run(cmd, label, cwd) {
  console.log(`\n→ ${label || cmd}`);
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' });
}

// Build the Electrobun desktop app
run(
  'npx electrobun build',
  'Building Electrobun desktop app...',
  DESKTOP_DIR,
);

console.log('\n✓ Desktop build complete.\n');
