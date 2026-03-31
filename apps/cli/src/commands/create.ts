import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { DatabaseManager } from '../database/bun-sqlite.js';
import { MockSandboxManager } from '../sandbox/mock.js';
import { ThreadManager } from '../thread/index.js';
import { configManager } from '../config/index.js';
import type { Project } from '../types/index.js';

interface CreateOptions {
  description?: string;
  gitRepo?: string;
  nonInteractive?: boolean;
  provider?: string;
  agentType?: string;
}

export function createCreateCommand(): Command {
  const command = new Command('create')
    .description('Create a new project with a sandbox and start a thread session')
    .argument('[project-name]', 'Name of the project to create')
    .option('--description <desc>', 'Project description')
    .option('--git-repo <url>', 'Git repository URL to clone into the sandbox')
    .option('--non-interactive', 'Create the project and exit without opening a session', false)
    .option('--provider <provider>', 'Sandbox provider (daytona/docker/local/apple-container)')
    .option('--agent-type <type>', 'Agent type (build/plan/sisyphus)')
    .action(async (projectName?: string, options: CreateOptions = {}) => {
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
        let name: string;
        let description: string;
        let gitRepo: string;
        let provider: Project['provider'];
        let agentType: Project['agentType'];

        if (projectName) {
          // Use command line arguments
          name = projectName;
          description = options.description || '';
          gitRepo = options.gitRepo || '';
          provider = (options.provider as Project['provider']) || config.defaultProvider;
          agentType = (options.agentType as Project['agentType']) || config.defaultAgentType;
        } else {
          // Interactive prompts
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          console.log();
          console.log(chalk.cyan.bold('  Create a new project'));
          console.log();

          name = await promptRequired(rl, 'Project name');
          
          description = await promptOptional(rl, 'Description (optional)');
          
          gitRepo = await promptOptional(rl, 'Git repo URL (optional)');
          
          provider = await promptChoice(
            rl,
            'Provider',
            ['daytona', 'docker', 'local', 'apple-container'],
            config.defaultProvider
          ) as Project['provider'];
          
          agentType = await promptChoice(
            rl,
            'Agent type',
            ['build', 'plan', 'sisyphus'],
            config.defaultAgentType
          ) as Project['agentType'];

          rl.close();
          console.log();
        }

        // Validate inputs
        if (!name.trim()) {
          console.error(chalk.red('Project name is required'));
          process.exit(1);
        }

        if (!['daytona', 'docker', 'local', 'apple-container'].includes(provider)) {
          console.error(chalk.red(`Invalid provider: ${provider}`));
          process.exit(1);
        }

        if (!['build', 'plan', 'sisyphus'].includes(agentType)) {
          console.error(chalk.red(`Invalid agent type: ${agentType}`));
          process.exit(1);
        }

        // Check if project name already exists
        const existingProjects = db.listProjects();
        if (existingProjects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
          console.error(chalk.red(`Project "${name}" already exists`));
          process.exit(1);
        }

        // Create project
        console.log(chalk.cyan(`🚀 Creating project "${name}"...`));
        
        const user = db.getDefaultUser();
        const projectId = `proj-${randomBytes(8).toString('hex')}`;
        
        const project = db.createProject({
          id: projectId,
          userId: user.id,
          name: name.trim(),
          description: description.trim() || undefined,
          provider,
          status: 'creating',
          agentType,
          gitRepo: gitRepo.trim() || undefined,
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

        if (options.nonInteractive) {
          // Non-interactive mode - just show project info
          console.log();
          console.log(chalk.green('✓ Project created successfully'));
          console.log();
          console.log(`  ID:      ${project.id}`);
          console.log(`  Name:    ${project.name}`);
          console.log(`  Status:  ${project.status}`);
          console.log(`  Provider: ${project.provider}`);
          console.log(`  Agent:   ${project.agentType}`);
          if (project.description) {
            console.log(`  Description: ${project.description}`);
          }
          if (project.gitRepo) {
            console.log(`  Git repo: ${project.gitRepo}`);
          }
          console.log(`  Created: ${project.createdAt}`);
          console.log();
          console.log(chalk.gray(`  Open with: apex open ${name}`));
          console.log();
        } else {
          // Interactive mode - start thread session
          console.log(chalk.green('✓ Project created successfully'));
          console.log(chalk.cyan('🤖 Starting interactive session...'));
          
          await threadManager.startThread(project, {
            interactive: true,
          });
        }

      } catch (error) {
        console.error(chalk.red('Project creation failed:'), (error as Error).message);
        process.exit(1);
      } finally {
        threadManager.cleanup();
        sandboxManager.disconnect();
        db.close();
      }
    });

  return command;
}

function promptRequired(rl: any, label: string): Promise<string> {
  return new Promise((resolve) => {
    const ask = () => {
      rl.question(`  ${label}: `, (answer: string) => {
        const trimmed = answer.trim();
        if (!trimmed) {
          console.log(chalk.red('  This field is required.'));
          ask();
        } else {
          resolve(trimmed);
        }
      });
    };
    ask();
  });
}

function promptOptional(rl: any, label: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`  ${label}: `, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

function promptChoice(rl: any, label: string, choices: string[], defaultChoice: string): Promise<string> {
  return new Promise((resolve) => {
    const choiceText = choices.join('/');
    rl.question(`  ${label} (${choiceText}) [${defaultChoice}]: `, (answer: string) => {
      const choice = answer.trim() || defaultChoice;
      if (choices.includes(choice)) {
        resolve(choice);
      } else {
        console.log(chalk.red(`  Invalid choice. Please select from: ${choiceText}`));
        resolve(promptChoice(rl, label, choices, defaultChoice));
      }
    });
  });
}