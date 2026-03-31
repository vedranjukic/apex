import { Command } from 'commander';
import chalk from 'chalk';
import { randomBytes } from 'crypto';
import { DatabaseManager } from '../database/bun-sqlite.js';
import { MockSandboxManager } from '../sandbox/mock.js';
import { ThreadManager } from '../thread/index.js';
import { configManager } from '../config/index.js';
import type { Project, Thread } from '../types/index.js';

interface CmdOptions {
  verbose?: boolean;
}

export function createCmdCommand(): Command {
  const command = new Command('cmd')
    .description('Run a command or prompt against an existing project and thread')
    .argument('<project>', 'Project ID or name')
    .argument('<thread-id>', 'Thread ID (prefix) or "new" to start a fresh thread')
    .argument('<command-or-prompt>', 'Slash command (like /status, /diff) or prompt text')
    .option('-v, --verbose', 'Show progress (tool calls, cost) on stderr', false)
    .action(async (projectName: string, threadId: string, input: string, options: CmdOptions) => {
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
        // Resolve project
        const project = resolveProject(db, projectName);
        if (!project) {
          console.error(chalk.red(`Project "${projectName}" not found`));
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

        // Check project status
        if (!project.sandboxId) {
          console.error(chalk.red(`Project has no sandbox (status: ${project.status})`));
          process.exit(1);
        }

        if (project.status === 'stopped') {
          console.log(chalk.yellow('⚠️  Sandbox is stopped. Attempting to reconnect...'));
        }

        if (project.status === 'error') {
          console.error(chalk.red('Project sandbox is in error state'));
          process.exit(1);
        }

        // Connect to sandbox
        await sandboxManager.connectToSandbox(project.sandboxId);

        // Configure output
        if (!options.verbose) {
          sandboxManager.setCallbacks({
            onProgress: () => {},
            onStatusChange: () => {},
          });
        }

        // Resolve or create thread
        let thread: Thread;

        if (threadId === 'new') {
          // Create new thread
          const newThreadId = `thread-${randomBytes(8).toString('hex')}`;
          thread = db.createThread({
            id: newThreadId,
            projectId: project.id,
            title: input.slice(0, 50),
            status: 'active',
          });
          console.log(chalk.green(`📋 Created new thread: ${thread.id}`));
        } else {
          // Resolve existing thread
          thread = resolveThread(db, project.id, threadId);
          if (!thread) {
            console.error(chalk.red(`Thread "${threadId}" not found in project "${project.name}"`));
            console.log(chalk.gray('Available threads:'));
            const threads = db.listThreads(project.id);
            if (threads.length === 0) {
              console.log(chalk.gray('  No threads exist. Use "new" to create one.'));
            } else {
              for (const t of threads) {
                const shortId = t.id.length > 8 ? t.id.slice(0, 8) : t.id;
                console.log(chalk.gray(`  ${t.title || 'Untitled'} (${shortId})`));
              }
            }
            process.exit(1);
          }
          console.log(chalk.green(`📋 Using thread: ${thread.id}`));
        }

        // Check if this is a slash command or a regular prompt
        if (input.startsWith('/')) {
          await handleSlashCommand(db, sandboxManager, threadManager, project, thread, input);
        } else {
          // Regular prompt - run one-shot
          await threadManager.startThread(project, {
            interactive: false,
            oneShot: true,
            initialPrompt: input,
          });
        }

      } catch (error) {
        console.error(chalk.red('Command failed:'), (error as Error).message);
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

function resolveThread(db: DatabaseManager, projectId: string, identifier: string): Thread | null {
  // First try exact ID match
  let thread = db.getThread(identifier);
  if (thread && thread.projectId === projectId) return thread;

  // Get all threads for the project
  const threads = db.listThreads(projectId);

  // Prefix match on thread ID
  const matches = threads.filter(t => t.id.startsWith(identifier));

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    console.error(chalk.red(`Ambiguous thread ID "${identifier}", matches:`));
    for (const match of matches) {
      const shortId = match.id.length > 8 ? match.id.slice(0, 8) : match.id;
      console.error(chalk.gray(`  ${match.title || 'Untitled'} (${shortId})`));
    }
    process.exit(1);
  }

  return null;
}

async function handleSlashCommand(
  db: DatabaseManager,
  sandboxManager: MockSandboxManager,
  threadManager: ThreadManager,
  project: Project,
  thread: Thread,
  command: string
): Promise<void> {
  const [cmd, ...args] = command.slice(1).split(' ');

  switch (cmd) {
    case 'status':
      await showThreadStatus(db, sandboxManager, project, thread);
      break;

    case 'history':
      await showThreadHistory(db, thread);
      break;

    case 'diff':
      // This would need to be implemented with actual sandbox communication
      console.log(chalk.yellow('⚠️  /diff command not implemented yet'));
      break;

    case 'cost':
      await showThreadCost(db, thread);
      break;

    case 'save':
      const filename = args[0] || `thread-${thread.id}.md`;
      await saveThreadHistory(db, thread, filename);
      console.log(chalk.green(`💾 Thread saved to ${filename}`));
      break;

    default:
      console.error(chalk.red(`Unknown slash command: /${cmd}`));
      console.log(chalk.gray('Available commands: /status, /history, /diff, /cost, /save'));
      process.exit(1);
  }
}

async function showThreadStatus(
  db: DatabaseManager,
  sandboxManager: MockSandboxManager,
  project: Project,
  thread: Thread
): Promise<void> {
  console.log(chalk.blue('📊 Thread Status:'));
  console.log(chalk.gray(`Thread ID: ${thread.id}`));
  console.log(chalk.gray(`Thread Status: ${thread.status}`));
  console.log(chalk.gray(`Project: ${project.name}`));
  console.log(chalk.gray(`Provider: ${project.provider}`));
  console.log(chalk.gray(`Agent Type: ${project.agentType}`));
  console.log(chalk.gray(`Sandbox ID: ${project.sandboxId || 'None'}`));
  
  if (project.sandboxId) {
    try {
      const sandboxStatus = await sandboxManager.getSandboxStatus(project.sandboxId);
      console.log(chalk.gray(`Sandbox Status: ${sandboxStatus}`));
    } catch (error) {
      console.log(chalk.gray(`Sandbox Status: Error - ${(error as Error).message}`));
    }
  }
  
  const messageCount = db.getMessages(thread.id).length;
  console.log(chalk.gray(`Messages: ${messageCount}`));
}

async function showThreadHistory(db: DatabaseManager, thread: Thread): Promise<void> {
  const messages = db.getMessages(thread.id);
  
  console.log(chalk.blue('📜 Thread History:'));
  console.log(chalk.gray('─'.repeat(50)));

  for (const message of messages) {
    const timestamp = new Date(message.createdAt).toLocaleTimeString();
    const roleColor = message.role === 'user' ? chalk.green : chalk.blue;
    
    console.log(roleColor(`\n[${timestamp}] ${message.role.toUpperCase()}:`));
    
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        console.log(block.text);
      } else if (block.type === 'tool_use') {
        console.log(chalk.cyan(`🔧 Tool: ${block.name}`));
        if (block.input) {
          console.log(chalk.gray(JSON.stringify(block.input, null, 2)));
        }
      } else if (block.type === 'tool_result') {
        const status = block.is_error ? '❌' : '✅';
        console.log(chalk.cyan(`${status} Result:`), block.content);
      }
    }
  }
  
  console.log(chalk.gray('\n' + '─'.repeat(50)));
}

async function showThreadCost(db: DatabaseManager, thread: Thread): Promise<void> {
  const messages = db.getMessages(thread.id);
  const totalTokens = messages.reduce((sum, msg) => sum + (msg.tokenCount || 0), 0);
  
  console.log(chalk.blue('💰 Thread Cost Analysis:'));
  console.log(chalk.gray(`Total Messages: ${messages.length}`));
  console.log(chalk.gray(`Total Tokens: ${totalTokens.toLocaleString()}`));
  
  // Rough cost estimation (these would need to be updated with actual pricing)
  const estimatedCost = totalTokens * 0.000015; // Rough Claude pricing
  console.log(chalk.gray(`Estimated Cost: $${estimatedCost.toFixed(4)}`));
}

async function saveThreadHistory(db: DatabaseManager, thread: Thread, filename: string): Promise<void> {
  const messages = db.getMessages(thread.id);
  
  let markdown = `# Thread: ${thread.title || thread.id}\n\n`;
  markdown += `Created: ${thread.createdAt}\n\n`;
  
  for (const message of messages) {
    const timestamp = new Date(message.createdAt).toISOString();
    markdown += `## ${message.role.charAt(0).toUpperCase() + message.role.slice(1)} - ${timestamp}\n\n`;
    
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        markdown += `${block.text}\n\n`;
      } else if (block.type === 'tool_use') {
        markdown += `### 🔧 Tool: ${block.name}\n\n`;
        if (block.input) {
          markdown += '```json\n' + JSON.stringify(block.input, null, 2) + '\n```\n\n';
        }
      } else if (block.type === 'tool_result') {
        const status = block.is_error ? '❌ Error' : '✅ Result';
        markdown += `### ${status}\n\n`;
        if (typeof block.content === 'string') {
          markdown += `${block.content}\n\n`;
        } else {
          markdown += '```json\n' + JSON.stringify(block.content, null, 2) + '\n```\n\n';
        }
      }
    }
  }

  await Bun.write(filename, markdown);
}