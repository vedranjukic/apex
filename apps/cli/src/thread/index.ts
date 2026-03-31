import { createInterface } from 'readline';
import chalk from 'chalk';
import { randomBytes } from 'crypto';
import type { Project, Thread, AgentOutput } from '../types/index.js';
import { DatabaseManager } from '../database/bun-sqlite.js';
import { MockSandboxManager } from '../sandbox/mock.js';

export interface ThreadOptions {
  interactive: boolean;
  oneShot?: boolean;
  initialPrompt?: string;
}

export class ThreadManager {
  private db: DatabaseManager;
  private sandboxManager: MockSandboxManager;
  private rl: any;

  constructor(db: DatabaseManager, sandboxManager: MockSandboxManager) {
    this.db = db;
    this.sandboxManager = sandboxManager;
  }

  public async startThread(project: Project, options: ThreadOptions): Promise<Thread> {
    // Create a new thread
    const threadId = `thread-${randomBytes(8).toString('hex')}`;
    const thread = this.db.createThread({
      id: threadId,
      projectId: project.id,
      title: options.initialPrompt?.slice(0, 50) || 'New Thread',
      status: 'active',
    });

    console.log(chalk.green(`\n📋 Started thread: ${thread.id}`));
    console.log(chalk.gray(`Project: ${project.name} (${project.provider})`));

    // Connect to sandbox if not already connected
    if (project.sandboxId) {
      await this.sandboxManager.connectToSandbox(project.sandboxId);
    }

    // Set up message handling
    this.sandboxManager.setCallbacks({
      onMessage: (output: AgentOutput) => {
        this.handleAgentOutput(thread.id, output);
      },
      onError: (error: Error) => {
        this.db.updateThread(thread.id, { status: 'error' });
        console.error(chalk.red('\nThread failed:'), error.message);
      },
    });

    if (options.oneShot && options.initialPrompt) {
      // One-shot execution
      await this.executePrompt(thread, project, options.initialPrompt);
      this.db.updateThread(thread.id, { status: 'completed' });
    } else if (options.interactive) {
      // Interactive REPL
      await this.startREPL(thread, project, options.initialPrompt);
    }

    return thread;
  }

  private async startREPL(thread: Thread, project: Project, initialPrompt?: string): Promise<void> {
    console.log(chalk.blue('\n🤖 Interactive mode started. Type /help for commands, /exit to quit.\n'));

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.green('apex> '),
    });

    // Execute initial prompt if provided
    if (initialPrompt) {
      console.log(chalk.green('apex> ') + initialPrompt);
      await this.executePrompt(thread, project, initialPrompt);
    }

    this.rl.prompt();

    this.rl.on('line', async (input: string) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      if (trimmed.startsWith('/')) {
        await this.handleCommand(thread, project, trimmed);
      } else {
        await this.executePrompt(thread, project, trimmed);
      }

      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.db.updateThread(thread.id, { status: 'completed' });
      console.log(chalk.yellow('\n👋 Session ended. Thread saved.'));
      process.exit(0);
    });
  }

  private async handleCommand(thread: Thread, project: Project, command: string): Promise<void> {
    const [cmd, ...args] = command.slice(1).split(' ');

    switch (cmd) {
      case 'help':
        this.showHelp();
        break;

      case 'exit':
      case 'quit':
        this.rl.close();
        break;

      case 'history':
        await this.showHistory(thread.id);
        break;

      case 'clear':
        console.clear();
        console.log(chalk.blue('🤖 Screen cleared. Thread continues...\n'));
        break;

      case 'status':
        await this.showStatus(thread, project);
        break;

      case 'save':
        const filename = args[0] || `thread-${thread.id}.md`;
        await this.saveHistory(thread.id, filename);
        console.log(chalk.green(`💾 Thread saved to ${filename}`));
        break;

      default:
        console.log(chalk.red(`Unknown command: ${cmd}. Type /help for available commands.`));
    }
  }

  private showHelp(): void {
    console.log(chalk.blue('\n📚 Available Commands:'));
    console.log(chalk.gray('  /help     - Show this help message'));
    console.log(chalk.gray('  /exit     - Exit the session'));
    console.log(chalk.gray('  /history  - Show conversation history'));
    console.log(chalk.gray('  /clear    - Clear the screen'));
    console.log(chalk.gray('  /status   - Show thread and project status'));
    console.log(chalk.gray('  /save [file] - Save history to markdown file\n'));
  }

  private async showHistory(threadId: string): Promise<void> {
    const messages = this.db.getMessages(threadId);
    
    console.log(chalk.blue('\n📜 Conversation History:'));
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
    
    console.log(chalk.gray('\n' + '─'.repeat(50) + '\n'));
  }

  private async showStatus(thread: Thread, project: Project): Promise<void> {
    console.log(chalk.blue('\n📊 Status:'));
    console.log(chalk.gray(`Thread ID: ${thread.id}`));
    console.log(chalk.gray(`Thread Status: ${thread.status}`));
    console.log(chalk.gray(`Project: ${project.name}`));
    console.log(chalk.gray(`Provider: ${project.provider}`));
    console.log(chalk.gray(`Agent Type: ${project.agentType}`));
    console.log(chalk.gray(`Sandbox ID: ${project.sandboxId || 'None'}`));
    
    if (project.sandboxId) {
      try {
        const sandboxStatus = await this.sandboxManager.getSandboxStatus(project.sandboxId);
        console.log(chalk.gray(`Sandbox Status: ${sandboxStatus}`));
      } catch (error) {
        console.log(chalk.gray(`Sandbox Status: Error - ${(error as Error).message}`));
      }
    }
    
    const messageCount = this.db.getMessages(thread.id).length;
    console.log(chalk.gray(`Messages: ${messageCount}\n`));
  }

  private async saveHistory(threadId: string, filename: string): Promise<void> {
    const messages = this.db.getMessages(threadId);
    const thread = this.db.getThread(threadId);
    
    let markdown = `# Thread: ${thread?.title || threadId}\n\n`;
    markdown += `Created: ${thread?.createdAt}\n\n`;
    
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

  private async executePrompt(thread: Thread, project: Project, prompt: string): Promise<void> {
    // Save user message
    const userMessageId = `msg-${randomBytes(8).toString('hex')}`;
    this.db.createMessage({
      id: userMessageId,
      threadId: thread.id,
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    });

    console.log(); // Add spacing before agent response

    try {
      if (!project.sandboxId) {
        throw new Error('No sandbox ID available');
      }
      await this.sandboxManager.sendPrompt(project.sandboxId, prompt, project.agentType);
      console.log(); // Add spacing after agent response
    } catch (error) {
      console.error(chalk.red('\nError executing prompt:'), (error as Error).message);
    }
  }

  private handleAgentOutput(threadId: string, output: AgentOutput): void {
    // For streaming content, we don't save individual deltas
    // We'll save the complete message when the stream ends
    
    if (output.type === 'content' && output.content) {
      // This is handled by the sandbox manager's rendering
      return;
    }

    // Save tool use and results as separate content blocks
    if (output.type === 'tool_use' || output.type === 'tool_result') {
      // For simplicity, we'll accumulate these and save them as part of the assistant message
      // In a more sophisticated implementation, you might want to buffer these
    }
  }

  public async resumeThread(threadId: string): Promise<void> {
    const thread = this.db.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const project = this.db.getProject(thread.projectId);
    if (!project) {
      throw new Error(`Project ${thread.projectId} not found`);
    }

    console.log(chalk.green(`\n📋 Resuming thread: ${thread.id}`));
    await this.showHistory(threadId);
    
    // Continue in interactive mode
    await this.startREPL(thread, project);
  }

  public cleanup(): void {
    if (this.rl) {
      this.rl.close();
    }
  }
}