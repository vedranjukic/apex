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
  currentIndex: number;
  maxIndex: number;
}

export class InteractiveDashboard {
  private db: DB;
  private rl: any;
  private state: DashboardState;
  private terminalSize = { width: 80, height: 24 };

  constructor(db: DB) {
    this.db = db;
    this.state = {
      view: 'projects',
      projects: [],
      threads: [],
      messages: [],
      currentIndex: 0,
      maxIndex: 0,
    };

    // Get terminal size
    if (process.stdout.isTTY) {
      this.terminalSize = { 
        width: process.stdout.columns || 80, 
        height: process.stdout.rows || 24 
      };
    }
  }

  async start(): Promise<void> {
    // Setup readline interface
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Setup keyboard input handling
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    console.clear();
    this.showHeader();

    // Load initial data
    await this.loadProjects();
    this.render();

    // Handle keyboard input
    process.stdin.on('data', async (key: string) => {
      await this.handleInput(key);
    });

    // Handle cleanup on exit
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(0);
    });

    // Handle terminal resize
    process.stdout.on('resize', () => {
      if (process.stdout.isTTY) {
        this.terminalSize = { 
          width: process.stdout.columns || 80, 
          height: process.stdout.rows || 24 
        };
        this.render();
      }
    });
  }

  private async handleInput(key: string): Promise<void> {
    switch (key) {
      case '\u0003': // Ctrl+C
      case 'q':
      case 'Q':
        this.cleanup();
        process.exit(0);
        break;

      case '\u001b[A': // Up arrow
      case 'k':
        this.navigateUp();
        break;

      case '\u001b[B': // Down arrow
      case 'j':
        this.navigateDown();
        break;

      case '\r': // Enter
      case ' ': // Space
        await this.select();
        break;

      case '\u001b': // Escape
      case 'b':
        await this.goBack();
        break;

      case 'r':
        await this.refresh();
        break;

      case 'd':
        await this.deleteSelected();
        break;

      case 'n':
        await this.createNew();
        break;

      case 'f':
        this.toggleFullscreen();
        break;

      case 'h':
      case '?':
        this.showHelp();
        break;

      default:
        // Ignore other keys
        break;
    }
  }

  private navigateUp(): void {
    if (this.state.currentIndex > 0) {
      this.state.currentIndex--;
      this.render();
    }
  }

  private navigateDown(): void {
    if (this.state.currentIndex < this.state.maxIndex) {
      this.state.currentIndex++;
      this.render();
    }
  }

  private async select(): Promise<void> {
    switch (this.state.view) {
      case 'projects':
        if (this.state.projects[this.state.currentIndex]) {
          this.state.selectedProject = this.state.projects[this.state.currentIndex];
          await this.loadThreads(this.state.selectedProject.id);
          this.state.view = 'threads';
          this.state.currentIndex = 0;
          this.render();
        }
        break;

      case 'threads':
        if (this.state.threads[this.state.currentIndex]) {
          this.state.selectedThread = this.state.threads[this.state.currentIndex];
          await this.loadMessages(this.state.selectedThread.id);
          this.state.view = 'messages';
          this.state.currentIndex = 0;
          this.render();
        }
        break;

      case 'messages':
        // In message view, Enter might be used for other actions
        break;
    }
  }

  private async goBack(): Promise<void> {
    switch (this.state.view) {
      case 'threads':
        await this.loadProjects();
        this.state.view = 'projects';
        this.state.selectedProject = undefined;
        this.state.currentIndex = 0;
        this.render();
        break;

      case 'messages':
        if (this.state.selectedProject) {
          await this.loadThreads(this.state.selectedProject.id);
          this.state.view = 'threads';
          this.state.selectedThread = undefined;
          this.state.currentIndex = 0;
          this.render();
        }
        break;

      case 'projects':
        // At top level, quit
        this.cleanup();
        process.exit(0);
        break;
    }
  }

  private async refresh(): Promise<void> {
    switch (this.state.view) {
      case 'projects':
        await this.loadProjects();
        break;
      case 'threads':
        if (this.state.selectedProject) {
          await this.loadThreads(this.state.selectedProject.id);
        }
        break;
      case 'messages':
        if (this.state.selectedThread) {
          await this.loadMessages(this.state.selectedThread.id);
        }
        break;
    }
    this.render();
  }

  private async deleteSelected(): Promise<void> {
    if (this.state.view === 'projects' && this.state.projects[this.state.currentIndex]) {
      const project = this.state.projects[this.state.currentIndex];
      
      // Confirmation
      console.clear();
      console.log(chalk.red.bold('  Delete Project'));
      console.log();
      console.log(`  Are you sure you want to delete "${project.name}"?`);
      console.log(chalk.red('  This action cannot be undone!'));
      console.log();
      console.log(chalk.gray('  y: yes, delete it · N: cancel'));

      const confirmation = await this.waitForKey();
      if (confirmation === 'y' || confirmation === 'Y') {
        try {
          this.db.deleteProject(project.id);
          await this.loadProjects();
          this.state.currentIndex = Math.min(this.state.currentIndex, this.state.maxIndex);
        } catch (error) {
          console.log(chalk.red(`Failed to delete project: ${(error as Error).message}`));
          await this.waitForKey();
        }
      }
      this.render();
    }
  }

  private async createNew(): Promise<void> {
    if (this.state.view === 'projects') {
      console.clear();
      console.log(chalk.cyan.bold('  Create New Project'));
      console.log();
      
      process.stdin.setRawMode(false);
      const name = await this.askQuestion('Project name: ');
      
      if (name.trim()) {
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
          await this.loadProjects();
          
          // Select the new project
          const newIndex = this.state.projects.findIndex(p => p.id === projectId);
          if (newIndex >= 0) {
            this.state.currentIndex = newIndex;
          }
        } catch (error) {
          console.log(chalk.red(`Failed to create project: ${(error as Error).message}`));
          await this.waitForKey();
        }
      }
      
      process.stdin.setRawMode(true);
      this.render();
    } else if (this.state.view === 'threads' && this.state.selectedProject) {
      console.clear();
      console.log(chalk.cyan.bold(`  Create New Thread in ${this.state.selectedProject.name}`));
      console.log();
      
      process.stdin.setRawMode(false);
      const title = await this.askQuestion('Thread title: ');
      
      if (title.trim()) {
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
          await this.loadThreads(this.state.selectedProject.id);
          
          // Select the new thread
          const newIndex = this.state.threads.findIndex(t => t.id === threadId);
          if (newIndex >= 0) {
            this.state.currentIndex = newIndex;
          }
        } catch (error) {
          console.log(chalk.red(`Failed to create thread: ${(error as Error).message}`));
          await this.waitForKey();
        }
      }
      
      process.stdin.setRawMode(true);
      this.render();
    }
  }

  private toggleFullscreen(): void {
    // For now, just refresh to simulate fullscreen toggle
    this.render();
  }

  private showHelp(): void {
    console.clear();
    console.log(chalk.cyan.bold('  Interactive Dashboard Help'));
    console.log();
    console.log(chalk.white.bold('  Navigation:'));
    console.log(chalk.gray('    ↑/k        Move up'));
    console.log(chalk.gray('    ↓/j        Move down'));
    console.log(chalk.gray('    Enter      Select/view item'));
    console.log(chalk.gray('    Escape/b   Go back'));
    console.log();
    console.log(chalk.white.bold('  Actions:'));
    console.log(chalk.gray('    n          Create new project/thread'));
    console.log(chalk.gray('    d          Delete selected item'));
    console.log(chalk.gray('    r          Refresh current view'));
    console.log(chalk.gray('    f          Toggle fullscreen'));
    console.log(chalk.gray('    h/?        Show this help'));
    console.log(chalk.gray('    q/Ctrl+C   Quit'));
    console.log();
    console.log(chalk.yellow('  Press any key to return...'));

    this.waitForKey().then(() => {
      this.render();
    });
  }

  private async askQuestion(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer: string) => {
        resolve(answer);
      });
    });
  }

  private waitForKey(): Promise<string> {
    return new Promise((resolve) => {
      process.stdin.once('data', (key) => {
        resolve(key.toString());
      });
    });
  }

  private async loadProjects(): Promise<void> {
    this.state.projects = this.db.listProjects();
    this.state.maxIndex = Math.max(0, this.state.projects.length - 1);
    this.state.currentIndex = Math.min(this.state.currentIndex, this.state.maxIndex);
  }

  private async loadThreads(projectId: string): Promise<void> {
    this.state.threads = this.db.listThreads(projectId);
    this.state.maxIndex = Math.max(0, this.state.threads.length - 1);
    this.state.currentIndex = Math.min(this.state.currentIndex, this.state.maxIndex);
  }

  private async loadMessages(threadId: string): Promise<void> {
    this.state.messages = this.db.getMessages(threadId);
    this.state.maxIndex = Math.max(0, this.state.messages.length - 1);
    this.state.currentIndex = Math.min(this.state.currentIndex, this.state.maxIndex);
  }

  private render(): void {
    console.clear();
    this.showHeader();

    switch (this.state.view) {
      case 'projects':
        this.renderProjects();
        break;
      case 'threads':
        this.renderThreads();
        break;
      case 'messages':
        this.renderMessages();
        break;
    }

    this.showFooter();
  }

  private showHeader(): void {
    console.log(chalk.cyan.bold('  Apex Interactive Dashboard'));
    console.log(chalk.gray('  Navigate with ↑↓/jk, select with Enter, help with ?'));
    console.log();
  }

  private renderProjects(): void {
    console.log(chalk.white.bold('Projects'));
    console.log();

    if (this.state.projects.length === 0) {
      console.log(chalk.gray('  No projects found.'));
      console.log(chalk.gray('  Press n to create one'));
      return;
    }

    // Header
    const nameWidth = 20;
    const statusWidth = 10;
    const providerWidth = 12;
    console.log(chalk.gray(`  ${''.padEnd(3)}${'NAME'.padEnd(nameWidth)} ${'STATUS'.padEnd(statusWidth)} ${'PROVIDER'.padEnd(providerWidth)} CREATED`));
    console.log(chalk.gray('  ' + '─'.repeat(60)));

    const visibleStart = Math.max(0, this.state.currentIndex - 10);
    const visibleEnd = Math.min(this.state.projects.length, visibleStart + 20);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const project = this.state.projects[i];
      const isSelected = i === this.state.currentIndex;
      const prefix = isSelected ? '▶ ' : '  ';
      const style = isSelected ? chalk.cyan.bold : chalk.white;
      
      const statusColor = this.getStatusColor(project.status);
      const formattedDate = this.formatDate(project.createdAt);
      const threads = this.db.listThreads(project.id);

      console.log(
        prefix +
        style(project.name.slice(0, nameWidth - 3).padEnd(nameWidth)) + ' ' +
        statusColor(project.status.padEnd(statusWidth)) + ' ' +
        chalk.gray(project.provider.padEnd(providerWidth)) + ' ' +
        chalk.gray(formattedDate + ` (${threads.length})`)
      );
    }

    if (this.state.projects.length > 20) {
      console.log(chalk.gray(`  ... (${this.state.projects.length - visibleEnd} more)`));
    }
  }

  private renderThreads(): void {
    if (!this.state.selectedProject) return;

    console.log(chalk.white.bold(`Threads in ${this.state.selectedProject.name}`));
    console.log();

    if (this.state.threads.length === 0) {
      console.log(chalk.gray('  No threads found.'));
      console.log(chalk.gray('  Press n to create one'));
      return;
    }

    // Header
    const titleWidth = 30;
    const statusWidth = 12;
    console.log(chalk.gray(`  ${''.padEnd(3)}${'TITLE'.padEnd(titleWidth)} ${'STATUS'.padEnd(statusWidth)} CREATED`));
    console.log(chalk.gray('  ' + '─'.repeat(55)));

    const visibleStart = Math.max(0, this.state.currentIndex - 10);
    const visibleEnd = Math.min(this.state.threads.length, visibleStart + 20);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const thread = this.state.threads[i];
      const isSelected = i === this.state.currentIndex;
      const prefix = isSelected ? '▶ ' : '  ';
      const style = isSelected ? chalk.cyan.bold : chalk.white;
      
      const title = (thread.title || 'Untitled').slice(0, titleWidth - 3);
      const statusColor = this.getStatusColor(thread.status);
      const formattedDate = this.formatDate(thread.createdAt);
      const messageCount = this.db.getMessages(thread.id).length;

      console.log(
        prefix +
        style(title.padEnd(titleWidth)) + ' ' +
        statusColor(thread.status.padEnd(statusWidth)) + ' ' +
        chalk.gray(formattedDate + ` (${messageCount} msgs)`)
      );
    }

    if (this.state.threads.length > 20) {
      console.log(chalk.gray(`  ... (${this.state.threads.length - visibleEnd} more)`));
    }
  }

  private renderMessages(): void {
    if (!this.state.selectedThread) return;

    const maxHeight = this.terminalSize.height - 8;
    console.log(chalk.white.bold(`${this.state.selectedThread.title || 'Thread'}`));
    console.log(chalk.gray('─'.repeat(this.terminalSize.width - 4)));

    if (this.state.messages.length === 0) {
      console.log(chalk.gray('  No messages in this thread.'));
      return;
    }

    // Show recent messages, scrollable
    const visibleStart = Math.max(0, this.state.messages.length - maxHeight + 2);
    const visibleMessages = this.state.messages.slice(visibleStart);

    for (const message of visibleMessages) {
      const roleColor = message.role === 'user' ? chalk.green : chalk.blue;
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      
      console.log(roleColor(`\n  [${timestamp}] ${message.role.toUpperCase()}:`));
      
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          const lines = this.wrapText(block.text, this.terminalSize.width - 4);
          lines.slice(0, 10).forEach(line => console.log(`  ${line}`));
          if (lines.length > 10) {
            console.log(chalk.gray(`  ... (${lines.length - 10} more lines)`));
          }
        } else if (block.type === 'tool_use') {
          console.log(chalk.cyan(`  [TOOL] ${block.name}`));
        } else if (block.type === 'tool_result') {
          const icon = block.is_error ? '[ERR]' : '[OK]';
          console.log(chalk.gray(`  ${icon} Result`));
        }
      }
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

  private showFooter(): void {
    console.log();
    const navigation = this.state.view === 'projects' 
      ? 'Projects' 
      : this.state.view === 'threads'
      ? `${this.state.selectedProject?.name} › Threads`
      : `${this.state.selectedProject?.name} › ${this.state.selectedThread?.title || 'Messages'}`;
    
    console.log(chalk.gray(`  ${navigation} │ n:new r:refresh d:delete h:help q:quit`));
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

  private formatDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit' 
      });
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
    }
  }

  private cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    if (this.rl) {
      this.rl.close();
    }
    this.db.close();
  }
}

export async function startInteractiveDashboard(db: DB): Promise<void> {
  const dashboard = new InteractiveDashboard(db);
  await dashboard.start();
}