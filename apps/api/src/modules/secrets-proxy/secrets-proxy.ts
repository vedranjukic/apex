/**
 * MITM Secrets Proxy — Rust binary launcher.
 *
 * Spawns the `apex-proxy` Rust binary as a child process and passes secrets,
 * CA certificate, and GitHub token via environment variables. The binary
 * handles all MITM interception, transparent tunneling, and auth injection.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { secretsService } from '../secrets/secrets.service';
import { settingsService } from '../settings/settings.service';
import { getCACertPem, getCAKeyPem } from './ca-manager';

const DEFAULT_PORT = 9350;

let proxyProcess: ChildProcess | null = null;

function getProxyPort(): number {
  return Number(process.env['SECRETS_PROXY_PORT'] || DEFAULT_PORT);
}

function resolveProxyBinary(): string {
  // Desktop app passes the bundled binary path via env var.
  const envBin = process.env['APEX_PROXY_BIN'];
  if (envBin) {
    try {
      fs.accessSync(envBin, fs.constants.X_OK);
      return envBin;
    } catch {
      // env path not valid, fall through to other candidates
    }
  }

  // __dirname is apps/api/src/modules/secrets-proxy/ — walk up to workspace root
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const candidates = [
    // Development: built by cargo in the workspace
    path.resolve(workspaceRoot, 'apps/proxy/target/release/apex-proxy'),
    path.resolve(workspaceRoot, 'apps/proxy/target/debug/apex-proxy'),
    // Production: alongside the API or in PATH
    path.resolve(process.cwd(), 'apex-proxy'),
    '/usr/local/bin/apex-proxy',
  ];

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // try next
    }
  }

  throw new Error(
    `apex-proxy binary not found. Searched: ${[envBin, ...candidates].filter(Boolean).join(', ')}. ` +
      'Build it with: cd apps/proxy && cargo build --release',
  );
}

/** Start the MITM secrets proxy (Rust binary). */
export async function startSecretsProxy(): Promise<void> {
  const port = getProxyPort();
  const binaryPath = resolveProxyBinary();

  const allSecrets = await secretsService.findAll();
  const secretsJson = JSON.stringify(
    allSecrets.map((s) => ({
      id: s.id,
      name: s.name,
      value: s.value,
      domain: s.domain,
      authType: s.authType || 'bearer',
    })),
  );

  let caCertPem = '';
  let caKeyPem = '';
  try {
    caCertPem = getCACertPem();
    caKeyPem = getCAKeyPem();
  } catch {
    console.warn('[secrets-proxy] CA certificate not available, MITM interception disabled');
  }

  const githubToken = (await settingsService.get('GITHUB_TOKEN')) || '';

  console.log(`[secrets-proxy] Starting Rust proxy: ${binaryPath} on port ${port}`);

  proxyProcess = spawn(binaryPath, [], {
    env: {
      ...process.env,
      MITM_PROXY_PORT: String(port),
      MITM_LISTEN_HOST: '0.0.0.0',
      SECRETS_JSON: secretsJson,
      CA_CERT_PEM: caCertPem,
      CA_KEY_PEM: caKeyPem,
      GITHUB_TOKEN: githubToken,
      // Host-side mode: only MITM proxy, no LLM/tunnel/relay
      PROXY_PORT: '0',
      PORT_RELAY_PORT: '0',
      RUST_LOG: 'apex_proxy=info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proxyProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[secrets-proxy] ${line}`);
  });

  proxyProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error(`[secrets-proxy] ${line}`);
  });

  proxyProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[secrets-proxy] proxy exited with code ${code}`);
    } else if (signal) {
      console.log(`[secrets-proxy] proxy killed by signal ${signal}`);
    }
    proxyProcess = null;
  });

  // Wait briefly for the binary to start and check it didn't crash immediately
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (proxyProcess && !proxyProcess.killed) {
        console.log(`[secrets-proxy] Rust MITM proxy running on 0.0.0.0:${port}`);
        resolve();
      } else {
        reject(new Error('apex-proxy process exited immediately'));
      }
    }, 500);

    proxyProcess!.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start apex-proxy: ${err.message}`));
    });

    proxyProcess!.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`apex-proxy exited with code ${code}`));
      }
    });
  });
}

/** Stop the proxy process (for graceful shutdown). */
export function stopSecretsProxy(): void {
  if (proxyProcess && !proxyProcess.killed) {
    proxyProcess.kill('SIGKILL');
    proxyProcess = null;
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Hot-reload secrets in the running Rust proxy via its internal HTTP endpoint.
 * Debounced: multiple calls within 200ms are collapsed into one reload.
 * No process restart needed — the proxy updates its in-memory secrets atomically.
 */
export function restartSecretsProxy(): Promise<void> {
  if (reloadTimer) clearTimeout(reloadTimer);

  return new Promise<void>((resolve) => {
    reloadTimer = setTimeout(async () => {
      reloadTimer = null;
      await reloadSecrets();
      resolve();
    }, 200);
  });
}

async function reloadSecrets(): Promise<void> {
  if (!proxyProcess || proxyProcess.killed) return;

  try {
    const allSecrets = await secretsService.findAll();
    const githubToken = (await settingsService.get('GITHUB_TOKEN')) || '';
    const payload = JSON.stringify({
      secrets: allSecrets.map((s) => ({
        id: s.id,
        name: s.name,
        value: s.value,
        domain: s.domain,
        authType: s.authType || 'bearer',
      })),
      github_token: githubToken,
    });

    const port = getProxyPort();
    const http = require('http') as typeof import('http');
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'POST',
          path: '/internal/reload-secrets',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    });
    console.log(`[secrets-proxy] secrets reloaded (${allSecrets.length} secrets, github_token: ${githubToken ? 'present' : 'empty'})`);
  } catch (err) {
    console.warn(`[secrets-proxy] reload failed: ${(err as Error).message}`);
  }
}

/** Get the port the proxy is running on. */
export { getProxyPort as getSecretsProxyPort };
