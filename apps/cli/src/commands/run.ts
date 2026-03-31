import { Command } from 'commander';
import chalk from 'chalk';
import { randomBytes } from 'crypto';
import { DatabaseManager } from '../database/bun-sqlite.js';
import { MockSandboxManager } from '../sandbox/mock.js';
import { ThreadManager } from '../thread/index.js';
import { configManager } from '../config/index.js';
import type { Project } from '../types/index.js';

interface RunOptions {
  verbose?: boolean;
  gitRepo?: string;
}

export function createRunCommand(): Command {
  const command = new Command('run')
    .description('Run a prompt in an ephemeral sandbox (created and destroyed automatically)')
    .argument('<prompt>', 'The prompt to execute')
    .option('-v, --verbose', 'Show progress (tool calls, cost) on stderr', false)
    .option('--git-repo <url>', 'Git repository URL to clone into the sandbox')
    .action(async (prompt: string, options: RunOptions) => {
      const config = configManager.config;
      
      if (!config.anthropicApiKey || !config.daytonaApiKey) {
        console.error(chalk.red('API keys not configured. Run "apex configure" to set them up.'));
        console.error(chalk.gray(`Database: ${config.dbPath}`));
        process.exit(1);
      }

      const db = new DatabaseManager(config.dbPath);
      const sandboxManager = new MockSandboxManager();
      const threadManager = new ThreadManager(db, sandboxManager);

      let project: Project | null = null;
      
      try {
        // Create ephemeral project
        console.log(chalk.cyan('🚀 Creating ephemeral sandbox...'));
        
        const user = db.getDefaultUser();
        const projectId = `ephemeral-${randomBytes(8).toString('hex')}`;
        
        project = db.createProject({
          id: projectId,
          userId: user.id,
          name: 'ephemeral',
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

        // Run the prompt
        console.log(chalk.cyan('📝 Executing prompt...'));
        
        if (!options.verbose) {
          // Disable progress output for clean stdout
          sandboxManager.setCallbacks({
            onProgress: () => {},
            onStatusChange: () => {},
          });
        }

        await threadManager.startThread(project, {
          interactive: false,
          oneShot: true,
          initialPrompt: prompt,
        });

      } catch (error) {
        console.error(chalk.red('Execution failed:'), (error as Error).message);
        process.exit(1);
      } finally {
        // Cleanup ephemeral resources
        if (project) {
          await cleanupEphemeral(db, sandboxManager, project);
        }
        
        threadManager.cleanup();
        sandboxManager.disconnect();
        db.close();
      }
    });

  return command;
}

async function cleanupEphemeral(
  db: DatabaseManager, 
  sandboxManager: MockSandboxManager, 
  project: Project
): Promise<void> {
  try {
    console.log(chalk.cyan('\n🧹 Cleaning up ephemeral sandbox...'));
    
    if (project.sandboxId) {
      await sandboxManager.destroySandbox(project.sandboxId);
    }
    
    // Delete project and all associated data
    db.deleteProject(project.id);
    
    console.log(chalk.green('✓ Ephemeral sandbox destroyed'));
  } catch (error) {
    console.error(chalk.yellow('Warning: Failed to cleanup ephemeral sandbox:'), (error as Error).message);
  }
}