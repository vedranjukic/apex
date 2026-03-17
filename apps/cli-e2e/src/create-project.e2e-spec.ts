/**
 * E2E test: apex create project via CLI.
 *
 * Runs the apex binary with a temp DB. Requires from .env:
 *   - DAYTONA_API_KEY
 *   - ANTHROPIC_API_KEY
 *
 * Skips when keys are not set (e.g. CI without sandbox).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const apexBin = (globalThis as Record<string, string>).__APEX_BIN__;
const hasSandboxKeys =
  !!process.env.DAYTONA_API_KEY && !!process.env.ANTHROPIC_API_KEY;

const describeE2e = hasSandboxKeys ? describe : describe.skip;

describeE2e('CLI create project E2E (real sandbox)', () => {
  const projectName = `e2e-cli-create-${Date.now()}`;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `apex-e2e-${Date.now()}.sqlite`);
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) {
      try {
        spawnSync(apexBin, ['project', 'delete', projectName, '-f', '--db-path', dbPath], {
          encoding: 'utf-8',
          env: { ...process.env, APEX_DB_PATH: dbPath },
        });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it('should create project with --non-interactive', async () => {
    const env = {
      ...process.env,
      APEX_DB_PATH: dbPath,
    };
    const result = spawnSync(
      apexBin,
      ['create', projectName, '--non-interactive'],
      {
        encoding: 'utf-8',
        env,
      }
    );
    const output = result.stdout + result.stderr;
    expect(result.status).toBe(0);
    expect(output).toMatch(/ID:/);
    expect(output).toMatch(/Name:/);
    expect(output).toMatch(/Status:/);
    expect(output).toContain(projectName);
    expect(output).toMatch(/running|creating/);
  }, 6 * 60 * 1000);

  it('should create project with --git-repo and --non-interactive', async () => {
    const projectNameGit = `${projectName}-git`;
    const env = {
      ...process.env,
      APEX_DB_PATH: dbPath,
    };
    const result = spawnSync(
      apexBin,
      [
        'create',
        projectNameGit,
        '--git-repo',
        'https://github.com/daytonaio/daytona.git',
        '--non-interactive',
      ],
      {
        encoding: 'utf-8',
        env,
      }
    );
    const output = result.stdout + result.stderr;
    expect(result.status).toBe(0);
    expect(output).toMatch(/ID:/);
    expect(output).toContain(projectNameGit);

    // Cleanup this project too
    try {
      spawnSync(apexBin, ['project', 'delete', projectNameGit, '-f', '--db-path', dbPath], {
        encoding: 'utf-8',
        env: { ...process.env, APEX_DB_PATH: dbPath },
      });
    } catch {
      // ignore
    }
  }, 6 * 60 * 1000);

  it('should create project, create thread, and execute simple prompt', async () => {
    const env = {
      ...process.env,
      APEX_DB_PATH: dbPath,
    };
    // 1. Create project
    const createResult = spawnSync(
      apexBin,
      ['create', projectName, '--non-interactive'],
      { encoding: 'utf-8', env }
    );
    expect(createResult.status).toBe(0);

    // 2. Create thread and run prompt (apex open -p creates a new thread)
    const promptResult = spawnSync(
      apexBin,
      ['open', projectName, '-p', 'how are you?', '-s'],
      { encoding: 'utf-8', env }
    );
    const output = promptResult.stdout + promptResult.stderr;
    expect(promptResult.status).toBe(0);
    expect(output.length).toBeGreaterThan(100);
    // Claude should respond with something (we can't assert exact text)
    expect(output).toMatch(/\S/);
  }, 4 * 60 * 1000);

  it('should send prompt via apex cmd to new thread', async () => {
    const env = {
      ...process.env,
      APEX_DB_PATH: dbPath,
    };
    // 1. Create project
    const createResult = spawnSync(
      apexBin,
      ['create', projectName, '--non-interactive'],
      { encoding: 'utf-8', env }
    );
    if (createResult.status !== 0) {
      console.error('\n--- apex create FAILED ---');
      console.error('stdout:', createResult.stdout);
      console.error('stderr:', createResult.stderr);
      console.error('----------------------------\n');
    }
    expect(createResult.status).toBe(0);

    // 2. Send prompt via cmd (new = start fresh thread)
    const cmdResult = spawnSync(
      apexBin,
      ['cmd', projectName, 'new', 'how are you?'],
      { encoding: 'utf-8', env }
    );
    const output = cmdResult.stdout + cmdResult.stderr;
    expect(cmdResult.status).toBe(0);
    expect(output.length).toBeGreaterThan(50);
    expect(output).toMatch(/\S/);
  }, 4 * 60 * 1000);

  it('should send prompt via apex cmd to existing thread', async () => {
    const env = {
      ...process.env,
      APEX_DB_PATH: dbPath,
    };
    const Database = require('better-sqlite3');
    // 1. Create project and first thread
    const createResult = spawnSync(
      apexBin,
      ['create', projectName, '--non-interactive'],
      { encoding: 'utf-8', env }
    );
    expect(createResult.status).toBe(0);

    spawnSync(
      apexBin,
      ['open', projectName, '-p', 'say hello', '-s'],
      { encoding: 'utf-8', env }
    );

    const db = new Database(dbPath);
    const row = db
      .prepare(
        'SELECT t.id FROM tasks t JOIN projects p ON t.projectId = p.id WHERE p.name = ? ORDER BY t.createdAt DESC LIMIT 1'
      )
      .get(projectName) as { id: string } | undefined;
    db.close();
    if (!row) throw new Error('No thread found');
    const threadIdPrefix = row.id.slice(0, 8);

    // 2. Send follow-up via cmd to existing thread
    const cmdResult = spawnSync(
      apexBin,
      ['cmd', projectName, threadIdPrefix, 'what did I just ask?'],
      { encoding: 'utf-8', env }
    );
    const output = cmdResult.stdout + cmdResult.stderr;
    expect(cmdResult.status).toBe(0);
    expect(output).toMatch(/\S/);
  }, 5 * 60 * 1000);
});
