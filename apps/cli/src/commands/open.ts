import { Command } from 'commander';
import chalk from 'chalk';
import { randomBytes } from 'crypto';
import { DatabaseManager } from '../database/bun-sqlite.js';
import { MockSandboxManager } from '../sandbox/mock.js';
import { ThreadManager } from '../thread/index.js';
import { configManager } from '../config/index.js';
import type { Project } from '../types/index.js';

interface OpenOptions {
  prompt?: string;
  stream?: boolean;
  gitRepo?: string;
}

export function createOpenCommand(): Command {
  const command = new Command('open')
    .description('Open a project — interactive or one-shot (-p)')
    .argument('<project-id-or-name>', 'Project ID or name to open')
    .option('-p, --prompt <prompt>', 'Send a prompt, run the agent, and exit')
    .option('-s, --stream', 'Stream task progress to stderr; keeps stdout clean for result output', false)
    .option('--git-repo <url>', 'Git repository URL to clone (used when creating a new project)')
    .action(async (identifier: string, options: OpenOptions) => {
      const config = configManager.config;
      
      if (!config.anthropicApiKey || !config.daytonaApiKey) {
        console.error(chalk.red('API keys not configured. Run "apex configure" to set them up.'));
        console.error(chalk.gray(`Database: ${config.dbPath}`));
        process.exit(1);
      }

      const db = new DatabaseManager(config.dbPath);
      const sandboxManager = new MockSandboxManager();
      const threadManager = new ThreadManager(db, sandboxManager);

      try {
        let project = resolveProject(db, identifier);
        let created = false;

        if (!project) {
          // Project doesn't exist
          if (!options.prompt) {
            console.error(chalk.red(`Project "${identifier}" not found`));
            console.log(chalk.gray('Available projects:'));
            const projects = db.listProjects();
            if (projects.length === 0) {
              console.log(chalk.gray('  No projects exist. Create one with: apex create <name>'));
            } else {
              for (const p of projects) {
                const shortId = p.id.length > 8 ? p.id.slice(0, 8) : p.id;
                console.log(chalk.gray(`  ${p.name} (${shortId})`));
              }
            }
            process.exit(1);
          }

          // Create project on-the-fly for one-shot execution
          console.log(chalk.cyan(`🚀 Creating project "${identifier}" on-the-fly...`));
          
          const user = db.getDefaultUser();
          const projectId = `proj-${randomBytes(8).toString('hex')}`;
          
          project = db.createProject({
            id: projectId,
            userId: user.id,
            name: identifier,
            provider: config.defaultProvider,
            status: 'creating',
            agentType: config.defaultAgentType,
            gitRepo: options.gitRepo,
            agentConfig: {},
          });

          // Create sandbox
          const sandboxId = await sandboxManager.createSandbox(project);
          
          // Update project with sandbox ID
          db.updateProject(project.id, { 
            sandboxId, 
            status: 'running' 
          });
          project.sandboxId = sandboxId;
          project.status = 'running';
          created = true;
        }

        if (!created) {
          // Check project status and connect to existing sandbox
          await waitForSandbox(db, project, sandboxManager);
          
          if (project.status === 'error') {
            console.error(chalk.red(`Project sandbox is in error state`));
            process.exit(1);
          }

          if (!project.sandboxId) {
            console.error(chalk.red(`Project has no sandbox (status: ${project.status})`));
            process.exit(1);
          }

          if (project.status === 'stopped') {
            console.log(chalk.yellow('⚠️  Sandbox is stopped. Attempting to reconnect...'));
          }

          await sandboxManager.connectToSandbox(project.sandboxId);
        }

        // Configure output for streaming or clean stdout
        if (options.stream && !options.prompt) {
          // Stream progress to stderr for interactive mode
          sandboxManager.setCallbacks({
            onProgress: (msg) => console.error(chalk.gray(msg)),
            onStatusChange: (status) => console.error(chalk.gray(`Status: ${status}`)),
          });
        } else if (options.prompt && !options.stream) {
          // Disable progress output for clean stdout in one-shot mode
          sandboxManager.setCallbacks({
            onProgress: () => {},
            onStatusChange: () => {},
          });
        }

        if (options.prompt) {
          // One-shot execution
          await threadManager.startThread(project, {
            interactive: false,
            oneShot: true,
            initialPrompt: options.prompt,
          });
        } else {
          // Interactive session
          console.log(chalk.green(`✓ Connected to project "${project.name}"`));
          await threadManager.startThread(project, {
            interactive: true,
          });
        }

      } catch (error) {
        console.error(chalk.red('Operation failed:'), (error as Error).message);
        process.exit(1);
      } finally {
        threadManager.cleanup();
        sandboxManager.disconnect();
        db.close();
      }
    });

  return command;
}

function resolveProject(db: DatabaseManager, identifier: string): Project | null {
  // First try exact ID match
  let project = db.getProject(identifier);
  if (project) return project;

  // Then try name match
  const projects = db.listProjects();
  
  // Exact name match
  project = projects.find(p => p.name.toLowerCase() === identifier.toLowerCase()) || null;
  if (project) return project;

  // Prefix matches
  const lowerIdentifier = identifier.toLowerCase();
  const matches = projects.filter(p => 
    p.name.toLowerCase().startsWith(lowerIdentifier) ||
    p.id.startsWith(identifier)
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    console.error(chalk.red(`Ambiguous project name "${identifier}", matches:`));
    for (const match of matches) {
      const shortId = match.id.length > 8 ? match.id.slice(0, 8) : match.id;
      console.error(chalk.gray(`  ${match.name} (${shortId})`));
    }
    process.exit(1);
  }

  return null;
}

async function waitForSandbox(
  db: DatabaseManager,
  project: Project,
  sandboxManager: MockSandboxManager
): Promise<void> {
  if (project.status !== 'creating' && project.status !== 'stopped') {
    return;
  }

  console.log(chalk.cyan('⏳ Waiting for sandbox...'));
  
  // Simple polling - in a real implementation you might want exponential backoff
  let attempts = 0;
  const maxAttempts = 60; // 3 minutes at 3 second intervals
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const updated = db.getProject(project.id);
    if (!updated) {
      throw new Error('Project was deleted while waiting');
    }
    
    if (updated.status === 'running') {
      Object.assign(project, updated);
      console.log(chalk.green('✓ Sandbox is ready'));
      return;
    }
    
    if (updated.status === 'error') {
      throw new Error('Sandbox failed to start');
    }
    
    attempts++;
  }
  
  throw new Error('Timeout waiting for sandbox to be ready');
}