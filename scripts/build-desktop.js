#!/usr/bin/env node

/**
 * Build script for the Apex desktop (Electron) app.
 *
 * 1. Compiles apps/desktop/src/*.ts → apps/desktop/dist/
 * 2. Rebuilds native modules (better-sqlite3) for Electron's Node.js
 * 3. Resolves workspace symlinks so electron-builder can package them
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, label) {
  console.log(`\n→ ${label || cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// Compile TypeScript for the desktop app
run(
  'npx tsc --project apps/desktop/tsconfig.json',
  'Compiling desktop TypeScript...',
);

// Rebuild native modules for Electron
run(
  'npx @electron/rebuild -f -w better-sqlite3',
  'Rebuilding better-sqlite3 for Electron...',
);

// Replace workspace symlinks with real copies so electron-builder can package them.
// npm workspaces create symlinks in node_modules/@apex/ → ../../libs/* and ../../apps/*
// These symlinks break in the packaged app. We replace them with actual directory copies
// and restore the symlinks after packaging.
const APEX_MODULES = path.join(ROOT, 'node_modules', '@apex');
const WORKSPACE_LINKS = ['orchestrator', 'shared'];
const backups = [];

console.log('\n→ Resolving workspace symlinks for packaging...');
for (const name of WORKSPACE_LINKS) {
  const linkPath = path.join(APEX_MODULES, name);
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(linkPath);
      const backupPath = linkPath + '.symlink-backup';
      // Save symlink target for restoration
      fs.writeFileSync(backupPath, fs.readlinkSync(linkPath));
      // Remove symlink, copy actual directory
      fs.unlinkSync(linkPath);
      fs.cpSync(target, linkPath, { recursive: true });
      backups.push({ linkPath, backupPath });
      console.log(`  Resolved @apex/${name} → ${target}`);
    }
  } catch (err) {
    console.warn(`  Skipping @apex/${name}: ${err.message}`);
  }
}

console.log('\n✓ Desktop build complete. Workspace symlinks resolved.\n');
console.log('NOTE: Run "npm run desktop:restore-links" after packaging to restore symlinks.\n');
