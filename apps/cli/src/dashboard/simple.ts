import { createInterface } from 'readline';
import chalk from 'chalk';
import type { DatabaseManager } from '../database/bun-sqlite.js';
import type { MockDatabaseManager } from '../database/mock.js';
import type { Project, Thread, Message } from '../types/index.js';
import { configManager } from '../config/index.js';

type DB = DatabaseManager | MockDatabaseManager;

interface DashboardState {
  view: 'projects' | 'threads' | 'messages';
  selectedProject?: Project;
  selectedThread?: Thread;
  projects: Project[];
  threads: Thread[];
  messages: Message[];
}

export class SimpleDashboard {
  private db: DB;
  private rl: any;
  private state: DashboardState;

  constructor(db: DB) {
    this.db = db;
    this.state = {
      view: 'projects',
      projects: [],
      threads: [],
      messages: [],
    };
  }

  async start(): Promise<void> {
    // Setup readline interface
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> '),
    });

    console.clear();
    await this.loadProjects();
    this.showMainMenu();

    this.rl.on('line', async (input: string) => {
      await this.handleInput(input.trim());
    });

    this.rl.on('close', () => {
      this.cleanup();
      process.exit(0);
    });

    // Handle cleanup on exit
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(0);
    });
  }

  private async handleInput(input: string): Promise<void> {
    const command = input.toLowerCase();

    switch (this.state.view) {
      case 'projects':
        await this.handleProjectsInput(command);
        break;
      case 'threads':
        await this.handleThreadsInput(command);
        break;
      case 'messages':
        await this.handleMessagesInput(command);
        break;
    }
  }

  private async handleProjectsInput(command: string): Promise<void> {
    if (command === 'quit' || command === 'q' || command === 'exit') {
      this.cleanup();
      process.exit(0);
    } else if (command === 'help' || command === 'h') {
      this.showProjectsHelp();
    } else if (command === 'list' || command === 'l' || command === '') {
      await this.loadProjects();
      this.showProjects();
    } else if (command === 'refresh' || command === 'r') {
      await this.loadProjects();
      this.showProjects();
    } else if (command.startsWith('select ') || command.startsWith('s ')) {
      const parts = command.split(' ');
      const index = parseInt(parts[1]) - 1;
      if (index >= 0 && index < this.state.projects.length) {
        this.state.selectedProject = this.state.projects[index];
        await this.loadThreads(this.state.selectedProject.id);
        this.state.view = 'threads';
        this.showThreads();
      } else {
        console.log(chalk.red('Invalid project number'));
        this.showProjects();
      }
    } else if (command.startsWith('delete ') || command.startsWith('d ')) {
      const parts = command.split(' ');
      const index = parseInt(parts[1]) - 1;
      if (index >= 0 && index < this.state.projects.length) {
        const project = this.state.projects[index];
        console.log(chalk.red(`Are you sure you want to delete "${project.name}"? (y/N)`));
        this.rl.question('', (answer: string) => {
          if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            try {
              this.db.deleteProject(project.id);
              console.log(chalk.green(`Deleted project "${project.name}"`));
              this.loadProjects().then(() => this.showProjects());
            } catch (error) {
              console.log(chalk.red(`Failed to delete project: ${(error as Error).message}`));
              this.showProjects();
            }
          } else {
            this.showProjects();
          }
        });
        return;
      } else {
        console.log(chalk.red('Invalid project number'));
        this.showProjects();
      }
    } else if (command.startsWith('create ') || command.startsWith('new ')) {
      const parts = command.split(' ');
      const name = parts.slice(1).join(' ');
      if (name) {
        await this.createProject(name);
      } else {
        console.log(chalk.red('Please provide a project name'));
        this.showProjects();
      }
    } else {
      console.log(chalk.red('Unknown command. Type "help" for available commands.'));
      this.showProjects();
    }
  }

  private async handleThreadsInput(command: string): Promise<void> {
    if (command === 'back' || command === 'b') {
      this.state.view = 'projects';
      this.state.selectedProject = undefined;
      this.showProjects();
    } else if (command === 'help' || command === 'h') {
      this.showThreadsHelp();
    } else if (command === 'list' || command === 'l' || command === '') {
      this.showThreads();
    } else if (command === 'refresh' || command === 'r') {
      if (this.state.selectedProject) {
        await this.loadThreads(this.state.selectedProject.id);
        this.showThreads();
      }
    } else if (command.startsWith('select ') || command.startsWith('s ')) {
      const parts = command.split(' ');
      const index = parseInt(parts[1]) - 1;
      if (index >= 0 && index < this.state.threads.length) {
        this.state.selectedThread = this.state.threads[index];
        await this.loadMessages(this.state.selectedThread.id);
        this.state.view = 'messages';
        this.showMessages();
      } else {
        console.log(chalk.red('Invalid thread number'));
        this.showThreads();
      }
    } else if (command.startsWith('create ') || command.startsWith('new ')) {
      const parts = command.split(' ');
      const title = parts.slice(1).join(' ');
      if (title && this.state.selectedProject) {
        await this.createThread(title);
      } else {
        console.log(chalk.red('Please provide a thread title'));
        this.showThreads();
      }
    } else {
      console.log(chalk.red('Unknown command. Type "help" for available commands.'));
      this.showThreads();
    }
  }

  private async handleMessagesInput(command: string): Promise<void> {
    if (command === 'back' || command === 'b') {
      this.state.view = 'threads';
      this.state.selectedThread = undefined;
      this.showThreads();
    } else if (command === 'help' || command === 'h') {
      this.showMessagesHelp();
    } else if (command === 'list' || command === 'l' || command === '') {
      this.showMessages();
    } else if (command === 'refresh' || command === 'r') {
      if (this.state.selectedThread) {
        await this.loadMessages(this.state.selectedThread.id);
        this.showMessages();
      }
    } else {
      console.log(chalk.red('Unknown command. Type "help" for available commands.'));
      this.showMessages();
    }
  }

  private showMainMenu(): void {
    console.log(chalk.cyan.bold('  Apex Interactive Dashboard'));
    console.log(chalk.gray('  Type commands at the prompt. Use "help" for available commands.'));
    console.log();
    this.showProjects();
  }

  private showProjectsHelp(): void {
    console.log(chalk.cyan.bold('\n  Projects Commands:'));
    console.log(chalk.gray('    list, l, <enter>     Show projects list'));
    console.log(chalk.gray('    select <num>, s <num> Select project by number'));
    console.log(chalk.gray('    create <name>        Create new project'));
    console.log(chalk.gray('    delete <num>, d <num> Delete project by number'));
    console.log(chalk.gray('    refresh, r           Refresh projects list'));
    console.log(chalk.gray('    help, h              Show this help'));
    console.log(chalk.gray('    quit, q              Exit dashboard'));
    console.log();
    this.rl.prompt();
  }

  private showThreadsHelp(): void {
    console.log(chalk.cyan.bold('\n  Threads Commands:'));
    console.log(chalk.gray('    list, l, <enter>     Show threads list'));
    console.log(chalk.gray('    select <num>, s <num> Select thread by number'));
    console.log(chalk.gray('    create <title>       Create new thread'));
    console.log(chalk.gray('    refresh, r           Refresh threads list'));
    console.log(chalk.gray('    back, b              Go back to projects'));
    console.log(chalk.gray('    help, h              Show this help'));
    console.log(chalk.gray('    quit, q              Exit dashboard'));
    console.log();
    this.rl.prompt();
  }

  private showMessagesHelp(): void {
    console.log(chalk.cyan.bold('\n  Messages Commands:'));
    console.log(chalk.gray('    list, l, <enter>     Show messages'));
    console.log(chalk.gray('    refresh, r           Refresh messages'));
    console.log(chalk.gray('    back, b              Go back to threads'));
    console.log(chalk.gray('    help, h              Show this help'));
    console.log(chalk.gray('    quit, q              Exit dashboard'));
    console.log();
    this.rl.prompt();
  }

  private async loadProjects(): Promise<void> {
    this.state.projects = this.db.listProjects();
  }

  private async loadThreads(projectId: string): Promise<void> {
    this.state.threads = this.db.listThreads(projectId);
  }

  private async loadMessages(threadId: string): Promise<void> {
    this.state.messages = this.db.getMessages(threadId);
  }

  private showProjects(): void {
    console.log(chalk.white.bold('\nProjects'));
    console.log();

    if (this.state.projects.length === 0) {
      console.log(chalk.gray('  No projects found.'));
      console.log(chalk.gray('  Use "create <name>" to create one'));
      console.log();
      this.rl.prompt();
      return;
    }

    // Header
    console.log(chalk.gray(`  ${'#'.padEnd(3)} ${'NAME'.padEnd(20)} ${'STATUS'.padEnd(10)} ${'PROVIDER'.padEnd(12)} THREADS`));
    console.log(chalk.gray('  ' + '─'.repeat(55)));

    this.state.projects.forEach((project, index) => {
      const statusColor = this.getStatusColor(project.status);
      const threadCount = this.db.listThreads(project.id).length;
      
      console.log(
        chalk.gray(`  ${(index + 1).toString().padEnd(3)} `) +
        chalk.white(project.name.slice(0, 18).padEnd(20)) + ' ' +
        statusColor(project.status.padEnd(10)) + ' ' +
        chalk.gray(project.provider.padEnd(12)) + ' ' +
        chalk.gray(threadCount.toString())
      );
    });

    console.log();
    console.log(chalk.gray('  Commands: select <num>, create <name>, delete <num>, help, quit'));
    this.rl.prompt();
  }

  private showThreads(): void {
    if (!this.state.selectedProject) return;

    console.log(chalk.white.bold(`\nThreads in ${this.state.selectedProject.name}`));
    console.log();

    if (this.state.threads.length === 0) {
      console.log(chalk.gray('  No threads found.'));
      console.log(chalk.gray('  Use "create <title>" to create one'));
      console.log();
      this.rl.prompt();
      return;
    }

    // Header
    console.log(chalk.gray(`  ${'#'.padEnd(3)} ${'TITLE'.padEnd(30)} ${'STATUS'.padEnd(12)} MESSAGES`));
    console.log(chalk.gray('  ' + '─'.repeat(55)));

    this.state.threads.forEach((thread, index) => {
      const statusColor = this.getStatusColor(thread.status);
      const messageCount = this.db.getMessages(thread.id).length;
      const title = (thread.title || 'Untitled').slice(0, 28);
      
      console.log(
        chalk.gray(`  ${(index + 1).toString().padEnd(3)} `) +
        chalk.white(title.padEnd(30)) + ' ' +
        statusColor(thread.status.padEnd(12)) + ' ' +
        chalk.gray(messageCount.toString())
      );
    });

    console.log();
    console.log(chalk.gray('  Commands: select <num>, create <title>, back, help, quit'));
    this.rl.prompt();
  }

  private showMessages(): void {
    if (!this.state.selectedThread) return;

    console.log(chalk.white.bold(`\nMessages in ${this.state.selectedThread.title || 'Thread'}`));
    console.log();

    if (this.state.messages.length === 0) {
      console.log(chalk.gray('  No messages in this thread.'));
      console.log();
      this.rl.prompt();
      return;
    }

    this.state.messages.forEach((message, index) => {
      const roleColor = message.role === 'user' ? chalk.green : chalk.blue;
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      
      console.log(roleColor(`  [${timestamp}] ${message.role.toUpperCase()}:`));
      
      message.content.forEach(block => {
        if (block.type === 'text' && block.text) {
          const lines = this.wrapText(block.text, 70);
          lines.slice(0, 5).forEach(line => console.log(`    ${line}`));
          if (lines.length > 5) {
            console.log(chalk.gray(`    ... (${lines.length - 5} more lines)`));
          }
        } else if (block.type === 'tool_use') {
          console.log(chalk.cyan(`    [TOOL] ${block.name}`));
        } else if (block.type === 'tool_result') {
          const icon = block.is_error ? '[ERR]' : '[OK]';
          console.log(chalk.gray(`    ${icon} Tool result`));
        }
      });
      
      console.log();
    });

    console.log(chalk.gray('  Commands: refresh, back, help, quit'));
    this.rl.prompt();
  }

  private async createProject(name: string): Promise<void> {
    try {
      const user = this.db.getDefaultUser();
      const projectId = `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const config = configManager.config;
      
      const newProject: Omit<Project, 'createdAt' | 'updatedAt'> = {
        id: projectId,
        userId: user.id,
        name: name.trim(),
        description: '',
        sandboxId: undefined,
        provider: config.defaultProvider,
        status: 'stopped',
        agentType: config.defaultAgentType,
        gitRepo: undefined,
        agentConfig: {},
        localDir: undefined,
      };

      this.db.createProject(newProject);
      console.log(chalk.green(`✓ Created project "${name}"`));
      await this.loadProjects();
      this.showProjects();
    } catch (error) {
      console.log(chalk.red(`Failed to create project: ${(error as Error).message}`));
      this.showProjects();
    }
  }

  private async createThread(title: string): Promise<void> {
    if (!this.state.selectedProject) return;

    try {
      const threadId = `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newThread: Omit<Thread, 'createdAt' | 'updatedAt'> = {
        id: threadId,
        projectId: this.state.selectedProject.id,
        title: title.trim(),
        status: 'active',
        sessionId: undefined,
      };

      this.db.createThread(newThread);
      console.log(chalk.green(`✓ Created thread "${title}"`));
      await this.loadThreads(this.state.selectedProject.id);
      this.showThreads();
    } catch (error) {
      console.log(chalk.red(`Failed to create thread: ${(error as Error).message}`));
      this.showThreads();
    }
  }

  private wrapText(text: string, width: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= width) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  private getStatusColor(status: string) {
    switch (status) {
      case 'running':
      case 'active':
        return chalk.green;
      case 'creating':
      case 'starting':
        return chalk.yellow;
      case 'completed':
        return chalk.blue;
      case 'stopped':
        return chalk.gray;
      case 'error':
        return chalk.red;
      default:
        return chalk.white;
    }
  }

  private cleanup(): void {
    if (this.rl) {
      this.rl.close();
    }
    this.db.close();
  }
}

export async function startSimpleDashboard(db: DB): Promise<void> {
  const dashboard = new SimpleDashboard(db);
  await dashboard.start();
}