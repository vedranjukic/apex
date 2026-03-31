import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { DatabaseManager } from '../database/bun-sqlite.js';
import { MockSandboxManager } from '../sandbox/mock.js';
import { configManager } from '../config/index.js';
import type { Project } from '../types/index.js';

export function createProjectCommand(): Command {
  const project = new Command('project')
    .description('Manage projects')
    .addCommand(createProjectListCommand())
    .addCommand(createProjectDeleteCommand())
    .addCommand(createProjectCreateCommand());

  return project;
}

function createProjectListCommand(): Command {
  return new Command('list')
    .description('List all projects')
    .alias('ls')
    .action(async () => {
      const config = configManager.config;
      const db = new DatabaseManager(config.dbPath);

      try {
        const projects = db.listProjects();

        if (projects.length === 0) {
          console.log(chalk.gray('No projects yet. Create one with: apex project create --name <name>'));
          return;
        }

        // Header
        console.log();
        console.log(chalk.gray(`  ${'ID'.padEnd(10)} ${'NAME'.padEnd(24)} ${'STATUS'.padEnd(12)} ${'CREATED'.padEnd(12)} PROVIDER`));
        console.log(chalk.gray('  ' + '─'.repeat(75)));

        // Projects
        for (const project of projects) {
          const shortId = project.id.length > 8 ? project.id.slice(0, 8) : project.id;
          const formattedDate = formatDate(project.createdAt);
          
          const statusColor = getStatusColor(project.status);
          
          console.log(
            `  ${shortId.padEnd(10)} ` +
            `${project.name.padEnd(24)} ` +
            `${statusColor(project.status.padEnd(12))} ` +
            `${formattedDate.padEnd(12)} ` +
            `${project.provider}`
          );
        }
        console.log();

      } catch (error) {
        console.error(chalk.red('Failed to list projects:'), (error as Error).message);
        process.exit(1);
      } finally {
        db.close();
      }
    });
}

function createProjectDeleteCommand(): Command {
  return new Command('delete')
    .description('Delete a project and its sandbox')
    .argument('<project-id-or-name>', 'Project ID or name to delete')
    .option('-f, --force', 'Skip confirmation prompt', false)
    .action(async (identifier: string, options: { force?: boolean }) => {
      const config = configManager.config;
      
      if (!config.daytonaApiKey) {
        console.error(chalk.red('Daytona API key not configured. Run "apex configure" to set it up.'));
        process.exit(1);
      }

      const db = new DatabaseManager(config.dbPath);

      try {
        // Resolve project
        const project = resolveProject(db, identifier);
        if (!project) {
          console.error(chalk.red(`Project "${identifier}" not found`));
          process.exit(1);
        }

        // Confirmation
        if (!options.force) {
          const confirmed = await confirmDeletion(project);
          if (!confirmed) {
            console.log(chalk.yellow('Deletion cancelled'));
            return;
          }
        }

        console.log(chalk.cyan(`🗑️  Deleting project "${project.name}"...`));

        // Delete sandbox if it exists
        if (project.sandboxId) {
          const sandboxManager = new MockSandboxManager();
          try {
            await sandboxManager.destroySandbox(project.sandboxId);
            console.log(chalk.green('✓ Sandbox destroyed'));
          } catch (error) {
            console.log(chalk.yellow(`⚠️  Warning: Failed to destroy sandbox: ${(error as Error).message}`));
          }
          sandboxManager.disconnect();
        }

        // Delete project from database (cascades to threads and messages)
        db.deleteProject(project.id);
        
        console.log(chalk.green(`✓ Project "${project.name}" deleted successfully`));

      } catch (error) {
        console.error(chalk.red('Failed to delete project:'), (error as Error).message);
        process.exit(1);
      } finally {
        db.close();
      }
    });
}

function createProjectCreateCommand(): Command {
  return new Command('create')
    .description('Create a new project')
    .option('--name <name>', 'Project name')
    .option('--description <desc>', 'Project description')
    .option('--git-repo <url>', 'Git repository URL to clone')
    .option('--provider <provider>', 'Sandbox provider (daytona/docker/local/apple-container)')
    .option('--agent-type <type>', 'Agent type (build/plan/sisyphus)')
    .option('--no-sandbox', 'Create project without provisioning a sandbox', false)
    .action(async (options: {
      name?: string;
      description?: string;
      gitRepo?: string;
      provider?: string;
      agentType?: string;
      sandbox?: boolean;
    }) => {
      const config = configManager.config;
      
      if (options.sandbox !== false && !config.daytonaApiKey) {
        console.error(chalk.red('Daytona API key not configured. Run "apex configure" or use --no-sandbox.'));
        process.exit(1);
      }

      const db = new DatabaseManager(config.dbPath);

      try {
        let name: string;
        let description: string;
        let gitRepo: string;
        let provider: Project['provider'];
        let agentType: Project['agentType'];

        if (options.name) {
          // Use CLI options
          name = options.name;
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
          
          if (options.sandbox !== false) {
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
          } else {
            provider = config.defaultProvider;
            agentType = config.defaultAgentType;
          }

          rl.close();
          console.log();
        }

        // Validate inputs
        if (!name.trim()) {
          console.error(chalk.red('Project name is required'));
          process.exit(1);
        }

        // Check if project name already exists
        const existingProjects = db.listProjects();
        if (existingProjects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
          console.error(chalk.red(`Project "${name}" already exists`));
          process.exit(1);
        }

        // Create project
        const user = db.getDefaultUser();
        const projectId = `proj-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        
        const project = db.createProject({
          id: projectId,
          userId: user.id,
          name: name.trim(),
          description: description.trim() || undefined,
          provider,
          status: options.sandbox === false ? 'running' : 'creating',
          agentType,
          gitRepo: gitRepo.trim() || undefined,
          agentConfig: {},
        });

        // Create sandbox if requested
        let sandboxId: string | undefined;
        if (options.sandbox !== false) {
          console.log(chalk.cyan(`🚀 Creating ${provider} sandbox...`));
          
          const sandboxManager = new MockSandboxManager();
          try {
            sandboxId = await sandboxManager.createSandbox(project);
            db.updateProject(project.id, { 
              sandboxId, 
              status: 'running' 
            });
            console.log(chalk.green('✓ Sandbox created successfully'));
          } catch (error) {
            db.updateProject(project.id, { status: 'error' });
            throw error;
          } finally {
            sandboxManager.disconnect();
          }
        }

        // Show project info
        console.log();
        console.log(chalk.green('✓ Project created successfully'));
        console.log();
        console.log(`  ID:      ${project.id}`);
        console.log(`  Name:    ${project.name}`);
        console.log(`  Status:  ${options.sandbox === false ? 'running' : 'running'}`);
        console.log(`  Provider: ${project.provider}`);
        console.log(`  Agent:   ${project.agentType}`);
        if (project.description) {
          console.log(`  Description: ${project.description}`);
        }
        if (project.gitRepo) {
          console.log(`  Git repo: ${project.gitRepo}`);
        }
        if (sandboxId) {
          console.log(`  Sandbox: ${sandboxId}`);
        }
        console.log(`  Created: ${project.createdAt}`);
        console.log();
        console.log(chalk.gray(`  Open with: apex open ${name}`));
        console.log();

      } catch (error) {
        console.error(chalk.red('Project creation failed:'), (error as Error).message);
        process.exit(1);
      } finally {
        db.close();
      }
    });
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

function getStatusColor(status: string) {
  switch (status) {
    case 'running':
      return chalk.green;
    case 'creating':
    case 'starting':
      return chalk.yellow;
    case 'stopped':
      return chalk.gray;
    case 'error':
      return chalk.red;
    default:
      return chalk.white;
  }
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: '2-digit'
  });
}

async function confirmDeletion(project: Project): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log();
  console.log(chalk.yellow('⚠️  This will permanently delete:'));
  console.log(chalk.gray(`   • Project: ${project.name}`));
  console.log(chalk.gray(`   • All threads and messages`));
  if (project.sandboxId) {
    console.log(chalk.gray(`   • Sandbox: ${project.sandboxId}`));
  }
  console.log();

  const answer = await new Promise<string>((resolve) => {
    rl.question('Type "yes" to confirm deletion: ', resolve);
  });

  rl.close();
  return answer.toLowerCase() === 'yes';
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