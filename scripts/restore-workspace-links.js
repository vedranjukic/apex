#!/usr/bin/env node

/**
 * Restores workspace symlinks that were replaced by build-desktop.js.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const APEX_MODULES = path.join(ROOT, 'node_modules', '@apex');
const WORKSPACE_LINKS = ['orchestrator', 'shared'];

let restored = 0;
for (const name of WORKSPACE_LINKS) {
  const linkPath = path.join(APEX_MODULES, name);
  const backupPath = linkPath + '.symlink-backup';
  try {
    if (fs.existsSync(backupPath)) {
      const target = fs.readFileSync(backupPath, 'utf-8').trim();
      fs.rmSync(linkPath, { recursive: true, force: true });
      fs.symlinkSync(target, linkPath);
      fs.unlinkSync(backupPath);
      console.log(`Restored @apex/${name} → ${target}`);
      restored++;
    }
  } catch (err) {
    console.warn(`Failed to restore @apex/${name}: ${err.message}`);
  }
}

if (restored === 0) {
  console.log('No symlinks to restore.');
} else {
  console.log(`\n✓ Restored ${restored} workspace symlink(s).\n`);
}
