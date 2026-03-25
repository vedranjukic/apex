#!/usr/bin/env node

/**
 * Build script for the Apex desktop (Electrobun) app.
 *
 * 1. Runs Electrobun build for the given --env (default: dev)
 * 2. Copies API dist, dashboard dist, and VERSION into the .app bundle
 *    so the production binary can find them via resolveAppPath().
 */

const { execSync } = require('child_process');
const { cpSync, readFileSync, readdirSync, existsSync, lstatSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP_DIR = path.join(ROOT, 'apps', 'desktop');
const BUILD_DIR = path.join(DESKTOP_DIR, 'build');

const env = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : 'dev';

function run(cmd, label, cwd) {
  console.log(`\n→ ${label || cmd}`);
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' });
}

run(
  `npx electrobun build --env ${env}`,
  `Building Electrobun desktop app (${env})...`,
  DESKTOP_DIR,
);

// Find the .app bundle in the build output (Electrobun may not match env in dir name)
let appBundle = null;
for (const envDir of readdirSync(BUILD_DIR)) {
  const envPath = path.join(BUILD_DIR, envDir);
  try {
    const app = readdirSync(envPath).find((f) => f.endsWith('.app'));
    if (app) {
      appBundle = { envPath, appName: app };
      break;
    }
  } catch {}
}
if (!appBundle) {
  console.error(`Could not find .app bundle in ${BUILD_DIR}`);
  process.exit(1);
}

const { envPath, appName } = appBundle;

const resourcesDir = path.join(envPath, appName, 'Contents', 'Resources');

const filesToCopy = [
  { src: path.join(ROOT, 'VERSION'), dest: path.join(resourcesDir, 'VERSION') },
  { src: path.join(ROOT, 'apps', 'api', 'dist'), dest: path.join(resourcesDir, 'apps', 'api', 'dist') },
  { src: path.join(ROOT, 'apps', 'dashboard', 'dist'), dest: path.join(resourcesDir, 'apps', 'dashboard', 'dist') },
];

// Modules externalized from the API bundle — must ship with all transitive deps.
const externalRoots = ['better-sqlite3', 'cpu-features', 'ssh2'];

function collectTransitiveDeps(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const mod = queue.shift();
    if (seen.has(mod)) continue;
    seen.add(mod);
    const pkgPath = path.join(ROOT, 'node_modules', mod, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
      for (const dep of Object.keys(deps)) queue.push(dep);
    } catch {}
    // Also check nested node_modules hoisted inside the module
    const nested = path.join(ROOT, 'node_modules', mod, 'node_modules');
    if (existsSync(nested)) {
      for (const sub of readdirSync(nested).filter(d => !d.startsWith('.'))) {
        queue.push(sub);
      }
    }
  }
  return [...seen].sort();
}

console.log(`\n→ Copying resources into ${appName}...`);
for (const { src, dest } of filesToCopy) {
  if (!existsSync(src)) {
    console.error(`Missing: ${src} — did you build the API and dashboard first?`);
    process.exit(1);
  }
  cpSync(src, dest, { recursive: true });
  console.log(`  ✓ ${path.relative(ROOT, src)} → ${path.relative(envPath, dest)}`);
}

const allModules = collectTransitiveDeps(externalRoots);
const apiNodeModules = path.join(resourcesDir, 'apps', 'api', 'dist', 'node_modules');
const noSymlinks = (s) => {
  try { return !lstatSync(s).isSymbolicLink(); } catch { return false; }
};
console.log(`\n→ Copying ${allModules.length} modules (external + transitive deps)...`);
for (const mod of allModules) {
  const src = path.join(ROOT, 'node_modules', mod);
  if (!existsSync(src)) {
    console.warn(`  ⚠ ${mod} not found, skipping`);
    continue;
  }
  cpSync(src, path.join(apiNodeModules, mod), { recursive: true, filter: noSymlinks });
  console.log(`  ✓ ${mod}`);
}

const appPath = path.join(envPath, appName);
run(
  `codesign --force --deep --sign - "${appPath}"`,
  'Ad-hoc signing bundle (seals resources + icon)...',
);

console.log(`\n✓ Desktop build complete: ${appPath}\n`);
