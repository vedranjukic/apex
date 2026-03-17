/**
 * Standalone script to create a Daytona sandbox using the SDK.
 *
 * Usage:
 *   npx tsx hack/create-sandbox.ts [--snapshot <name>] [--name <name>] [--env KEY=VAL ...]
 *
 * Environment variables (or set in .env at repo root):
 *   DAYTONA_API_KEY   – Daytona API key
 *   DAYTONA_API_URL   – Daytona API URL (default: https://app.daytona.io/api)
 *   DAYTONA_TARGET    – Target region (e.g. "us")
 *   DAYTONA_SNAPSHOT  – Default snapshot name
 */

import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';

interface CliArgs {
  snapshot?: string;
  name?: string;
  envVars: Record<string, string>;
  autoStop: number;
  timeout: number;
  keepAlive: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    envVars: {},
    autoStop: 0,
    timeout: 120,
    keepAlive: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--snapshot':
      case '-s':
        result.snapshot = args[++i];
        break;
      case '--name':
      case '-n':
        result.name = args[++i];
        break;
      case '--env':
      case '-e': {
        const pair = args[++i];
        const eq = pair.indexOf('=');
        if (eq > 0) {
          result.envVars[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
        break;
      }
      case '--auto-stop':
        result.autoStop = parseInt(args[++i], 10);
        break;
      case '--timeout':
        result.timeout = parseInt(args[++i], 10);
        break;
      case '--keep-alive':
        result.keepAlive = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  return result;
}

function printUsage() {
  console.log(`
Usage: npx tsx hack/create-sandbox.ts [options]

Options:
  -s, --snapshot <name>   Snapshot to use (default: DAYTONA_SNAPSHOT env var)
  -n, --name <name>       Sandbox name
  -e, --env KEY=VAL       Set environment variable (repeatable)
      --auto-stop <min>   Auto-stop after N minutes of inactivity (0 = disabled, default: 0)
      --timeout <sec>     Creation timeout in seconds (default: 120)
      --keep-alive        Don't delete the sandbox on exit (default: delete on Ctrl+C)
  -h, --help              Show this help

Environment variables:npx tsx hack/create-sandbox.ts
  DAYTONA_API_KEY         Daytona API key (required)
  DAYTONA_API_URL         Daytona API URL
  DAYTONA_TARGET          Target region (e.g. "us")
  DAYTONA_SNAPSHOT        Default snapshot name
`);
}

async function main() {
  const args = parseArgs();

  const snapshot = args.snapshot || process.env['DAYTONA_SNAPSHOT'] || '';
  if (!snapshot) {
    console.error('Error: No snapshot specified. Use --snapshot or set DAYTONA_SNAPSHOT.');
    process.exit(1);
  }

  if (!process.env['DAYTONA_API_KEY']) {
    console.error('Error: DAYTONA_API_KEY is not set.');
    process.exit(1);
  }

  console.log('\n=== Daytona Sandbox Creator ===\n');
  console.log(`  API URL:   ${process.env['DAYTONA_API_URL'] || 'https://app.daytona.io/api'}`);
  console.log(`  Target:    ${process.env['DAYTONA_TARGET'] || '(default)'}`);
  console.log(`  Snapshot:  ${snapshot}`);
  if (args.name) console.log(`  Name:      ${args.name}`);
  if (Object.keys(args.envVars).length > 0) {
    console.log(`  Env vars:  ${Object.keys(args.envVars).join(', ')}`);
  }
  console.log(`  Auto-stop: ${args.autoStop === 0 ? 'disabled' : `${args.autoStop} min`}`);
  console.log(`  Timeout:   ${args.timeout}s`);
  console.log();

  const daytona = new Daytona();

  console.log('Creating sandbox...');
  const startTime = Date.now();

  const sandbox = await daytona.create(
    {
      snapshot,
      ...(args.name && { name: args.name }),
      autoStopInterval: args.autoStop,
      ...(Object.keys(args.envVars).length > 0 && { envVars: args.envVars }),
    },
    { timeout: args.timeout },
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Sandbox created in ${elapsed}s\n`);

  console.log('=== Sandbox Info ===\n');
  console.log(`  ID:        ${sandbox.id}`);
  console.log(`  Name:      ${sandbox.name || '(none)'}`);
  console.log(`  State:     ${sandbox.state}`);
  console.log(`  Snapshot:  ${sandbox.snapshot || snapshot}`);
  console.log(`  Target:    ${sandbox.target}`);
  console.log(`  CPU:       ${sandbox.cpu} cores`);
  console.log(`  Memory:    ${sandbox.memory} GB`);
  console.log(`  Disk:      ${sandbox.disk} GB`);

  const previewLink = await sandbox.getPreviewLink(8080);
  console.log(`  Preview:   ${previewLink.url}`);
  console.log();

  const whoami = await sandbox.process.executeCommand('whoami');
  console.log(`  User:      ${whoami.result?.trim()}`);

  const uname = await sandbox.process.executeCommand('uname -a');
  console.log(`  Kernel:    ${uname.result?.trim()}`);
  console.log();

  if (args.keepAlive) {
    console.log(`Sandbox ${sandbox.id} is running. It will NOT be auto-deleted.`);
    console.log('Use the Daytona dashboard or SDK to manage it.\n');
  } else {
    console.log(`Sandbox ${sandbox.id} is running. Press Ctrl+C to stop and delete it.\n`);

    await new Promise<void>((resolve) => {
      const cleanup = async () => {
        console.log('\nStopping and removing sandbox...');
        try {
          await daytona.remove(sandbox, 60);
          console.log('Sandbox removed.\n');
        } catch (err) {
          console.error(`Failed to remove sandbox: ${err}`);
        }
        resolve();
      };

      process.on('SIGINT', () => void cleanup());
      process.on('SIGTERM', () => void cleanup());
    });
  }
}

main().catch((err) => {
  console.error(`\nFatal error: ${err}\n`);
  process.exit(1);
});
