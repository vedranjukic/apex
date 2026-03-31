import { createInterface } from 'readline';
import chalk from 'chalk';
import type { DatabaseManager } from '../database/bun-sqlite.js';
import type { MockDatabaseManager } from '../database/mock.js';
import type { Project, Thread, Message } from '../types/index.js';
import { configManager } from '../config/index.js';

type DB = DatabaseManager | MockDatabaseManager;

interface ExpandedProjects {
  [projectId: string]: boolean;
}

interface DashboardState {
  activePanel: 'projects' | 'context';
  selectedProjectIndex: number;
  selectedThreadIndex: number;
  selectedProject?: Project;
  selectedThread?: Thread;
  projects: Project[];
  expandedProjects: ExpandedProjects;
  contextScrollOffset: number;
  contextContent: string[];
}

interface TerminalSize {
  width: number;
  height: number;
}

export class FullScreenTUI {
  private db: DB;
  private rl: any;
  private state: DashboardState;
  private terminalSize: TerminalSize;
  private projectsCache: Map<string, Thread[]> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();

  constructor(db: DB) {
    this.db = db;
    this.state = {
      activePanel: 'projects',
      selectedProjectIndex: 0,
      selectedThreadIndex: 0,
      projects: [],
      expandedProjects: {},
      contextScrollOffset: 0,
      contextContent: [],
    };

    this.terminalSize = this.getTerminalSize();
  }

  private getTerminalSize(): TerminalSize {
    return {
      width: process.stdout.columns || 120,
      height: process.stdout.rows || 30,
    };
  }

  async start(): Promise<void> {
    // Setup readline interface
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Setup raw mode for keyboard input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    // Load initial data
    await this.loadData();
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
      this.terminalSize = this.getTerminalSize();
      this.render();
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

      case '\t': // Tab
        this.switchPanel();
        break;

      case '\u001b[A': // Up arrow
      case 'k':
        this.navigateUp();
        break;

      case '\u001b[B': // Down arrow
      case 'j':
        this.navigateDown();
        break;

      case '\u001b[C': // Right arrow
      case 'l':
        if (this.state.activePanel === 'projects') {
          this.expandCurrentProject();
        } else {
          this.contextScrollRight();
        }
        break;

      case '\u001b[D': // Left arrow
      case 'h':
        if (this.state.activePanel === 'projects') {
          this.collapseCurrentProject();
        } else {
          this.contextScrollLeft();
        }
        break;

      case '\r': // Enter
      case ' ': // Space
        await this.selectItem();
        break;

      case 'x':
        this.toggleProjectExpansion();
        break;

      case 'r':
        await this.refresh();
        break;

      case 'n':
        await this.createNew();
        break;

      case 'd':
        await this.deleteSelected();
        break;

      case 'f':
        this.toggleFullscreen();
        break;

      case '?':
      case 'H':
        this.showHelp();
        break;

      // Context panel scrolling
      case 'J': // Shift+J
        if (this.state.activePanel === 'context') {
          this.contextScrollDown();
        }
        break;

      case 'K': // Shift+K
        if (this.state.activePanel === 'context') {
          this.contextScrollUp();
        }
        break;

      default:
        // Ignore other keys
        break;
    }
  }

  private switchPanel(): void {
    this.state.activePanel = this.state.activePanel === 'projects' ? 'context' : 'projects';
    this.render();
  }

  private navigateUp(): void {
    if (this.state.activePanel === 'projects') {
      this.navigateProjectsUp();
    } else {
      this.contextScrollUp();
    }
  }

  private navigateDown(): void {
    if (this.state.activePanel === 'projects') {
      this.navigateProjectsDown();
    } else {
      this.contextScrollDown();
    }
  }

  private navigateProjectsUp(): void {
    const flatItems = this.getFlatProjectItems();
    const currentIndex = this.getCurrentItemIndex(flatItems);
    
    if (currentIndex > 0) {
      const newItem = flatItems[currentIndex - 1];
      this.selectFlatItem(newItem);
    }
  }

  private navigateProjectsDown(): void {
    const flatItems = this.getFlatProjectItems();
    const currentIndex = this.getCurrentItemIndex(flatItems);
    
    if (currentIndex < flatItems.length - 1) {
      const newItem = flatItems[currentIndex + 1];
      this.selectFlatItem(newItem);
    }
  }

  private getFlatProjectItems(): Array<{ type: 'project' | 'thread'; projectIndex: number; threadIndex?: number }> {
    const items: Array<{ type: 'project' | 'thread'; projectIndex: number; threadIndex?: number }> = [];

    this.state.projects.forEach((project, projectIndex) => {
      items.push({ type: 'project', projectIndex });

      if (this.state.expandedProjects[project.id]) {
        const threads = this.projectsCache.get(project.id) || [];
        threads.forEach((_, threadIndex) => {
          items.push({ type: 'thread', projectIndex, threadIndex });
        });
      }
    });

    return items;
  }

  private getCurrentItemIndex(flatItems: Array<{ type: 'project' | 'thread'; projectIndex: number; threadIndex?: number }>): number {
    return flatItems.findIndex(item => {
      if (item.type === 'project') {
        return item.projectIndex === this.state.selectedProjectIndex && this.state.selectedThreadIndex === -1;
      } else {
        return item.projectIndex === this.state.selectedProjectIndex && item.threadIndex === this.state.selectedThreadIndex;
      }
    });
  }

  private selectFlatItem(item: { type: 'project' | 'thread'; projectIndex: number; threadIndex?: number }): void {
    this.state.selectedProjectIndex = item.projectIndex;
    
    if (item.type === 'project') {
      this.state.selectedThreadIndex = -1;
      this.state.selectedProject = this.state.projects[item.projectIndex];
      this.state.selectedThread = undefined;
      this.updateContextForProject();
    } else {
      this.state.selectedThreadIndex = item.threadIndex!;
      this.state.selectedProject = this.state.projects[item.projectIndex];
      const threads = this.projectsCache.get(this.state.selectedProject.id) || [];
      this.state.selectedThread = threads[item.threadIndex!];
      this.updateContextForThread();
    }
    this.render();
  }

  private expandCurrentProject(): void {
    const project = this.state.projects[this.state.selectedProjectIndex];
    if (project && !this.state.expandedProjects[project.id]) {
      this.state.expandedProjects[project.id] = true;
      this.loadProjectThreads(project.id);
      this.render();
    }
  }

  private collapseCurrentProject(): void {
    const project = this.state.projects[this.state.selectedProjectIndex];
    if (project && this.state.expandedProjects[project.id]) {
      this.state.expandedProjects[project.id] = false;
      this.state.selectedThreadIndex = -1;
      this.state.selectedThread = undefined;
      this.updateContextForProject();
      this.render();
    }
  }

  private toggleProjectExpansion(): void {
    const project = this.state.projects[this.state.selectedProjectIndex];
    if (project) {
      if (this.state.expandedProjects[project.id]) {
        this.collapseCurrentProject();
      } else {
        this.expandCurrentProject();
      }
    }
  }

  private contextScrollUp(): void {
    if (this.state.contextScrollOffset > 0) {
      this.state.contextScrollOffset--;
      this.render();
    }
  }

  private contextScrollDown(): void {
    const maxHeight = this.getContextPanelHeight();
    if (this.state.contextScrollOffset < Math.max(0, this.state.contextContent.length - maxHeight)) {
      this.state.contextScrollOffset++;
      this.render();
    }
  }

  private contextScrollLeft(): void {
    // For horizontal scrolling in the future
  }

  private contextScrollRight(): void {
    // For horizontal scrolling in the future
  }

  private async selectItem(): Promise<void> {
    if (this.state.activePanel === 'projects') {
      if (this.state.selectedThreadIndex === -1) {
        // Project selected - toggle expansion
        this.toggleProjectExpansion();
      } else {
        // Thread selected - update context
        const project = this.state.projects[this.state.selectedProjectIndex];
        const threads = this.projectsCache.get(project.id) || [];
        const thread = threads[this.state.selectedThreadIndex];
        
        if (thread) {
          this.state.selectedThread = thread;
          await this.updateContextForThread();
        }
      }
    }
  }

  private async refresh(): Promise<void> {
    await this.loadData();
    this.render();
  }

  private async createNew(): Promise<void> {
    // Implementation for creating new projects/threads
    this.showHelp(); // Placeholder for now
  }

  private async deleteSelected(): Promise<void> {
    // Implementation for deleting selected items
    this.showHelp(); // Placeholder for now
  }

  private toggleFullscreen(): void {
    // Clear screen and re-render
    this.render();
  }

  private showHelp(): void {
    process.stdout.write('\x1B[2J\x1B[H'); // Clear screen and move cursor to top
    
    console.log(chalk.cyan.bold('  Apex TUI Dashboard - Help'));
    console.log();
    console.log(chalk.white.bold('  Navigation:'));
    console.log(chalk.gray('    ↑/k ↓/j     Navigate up/down'));
    console.log(chalk.gray('    ←/h →/l     Collapse/expand projects, scroll context'));
    console.log(chalk.gray('    Tab         Switch between project list and context panel'));
    console.log(chalk.gray('    Enter/Space Select item or toggle expansion'));
    console.log(chalk.gray('    x           Toggle project expansion'));
    console.log();
    console.log(chalk.white.bold('  Context Panel (when active):'));
    console.log(chalk.gray('    J/K         Scroll context up/down (Shift+j/k)'));
    console.log();
    console.log(chalk.white.bold('  Actions:'));
    console.log(chalk.gray('    r           Refresh all data'));
    console.log(chalk.gray('    n           Create new project/thread'));
    console.log(chalk.gray('    d           Delete selected item'));
    console.log(chalk.gray('    f           Toggle fullscreen'));
    console.log(chalk.gray('    ?/H         Show this help'));
    console.log(chalk.gray('    q/Ctrl+C    Quit'));
    console.log();
    console.log(chalk.yellow('  Press any key to return...'));

    // Wait for any key
    process.stdin.once('data', () => {
      this.render();
    });
  }

  private async loadData(): Promise<void> {
    this.state.projects = this.db.listProjects();
    
    // Pre-load threads for expanded projects
    for (const project of this.state.projects) {
      if (this.state.expandedProjects[project.id]) {
        this.loadProjectThreads(project.id);
      }
    }

    // Ensure selected indices are valid
    this.state.selectedProjectIndex = Math.min(this.state.selectedProjectIndex, this.state.projects.length - 1);
    if (this.state.selectedProjectIndex >= 0) {
      this.state.selectedProject = this.state.projects[this.state.selectedProjectIndex];
      this.updateContextForProject();
    }
  }

  private loadProjectThreads(projectId: string): void {
    const threads = this.db.listThreads(projectId);
    this.projectsCache.set(projectId, threads);
  }

  private async loadThreadMessages(threadId: string): Promise<Message[]> {
    if (!this.messagesCache.has(threadId)) {
      const messages = this.db.getMessages(threadId);
      this.messagesCache.set(threadId, messages);
    }
    return this.messagesCache.get(threadId)!;
  }

  private updateContextForProject(): void {
    if (!this.state.selectedProject) {
      this.state.contextContent = ['No project selected'];
      return;
    }

    const project = this.state.selectedProject;
    const threads = this.projectsCache.get(project.id) || [];

    this.state.contextContent = [
      `Project: ${project.name}`,
      `Status: ${this.getStatusText(project.status)}`,
      `Provider: ${project.provider}`,
      `Created: ${this.formatDate(project.createdAt)}`,
      '',
      `Threads: ${threads.length}`,
    ];

    if (project.description) {
      this.state.contextContent.push('', 'Description:', project.description);
    }

    if (project.gitRepo) {
      this.state.contextContent.push('', 'Git Repository:', project.gitRepo);
    }

    if (project.localDir) {
      this.state.contextContent.push('', 'Local Directory:', project.localDir);
    }

    this.state.contextScrollOffset = 0;
  }

  private async updateContextForThread(): Promise<void> {
    if (!this.state.selectedThread) {
      this.state.contextContent = ['No thread selected'];
      return;
    }

    const thread = this.state.selectedThread;
    const messages = await this.loadThreadMessages(thread.id);

    this.state.contextContent = [
      `Thread: ${thread.title || 'Untitled'}`,
      `Status: ${this.getStatusText(thread.status)}`,
      `Created: ${this.formatDate(thread.createdAt)}`,
      `Messages: ${messages.length}`,
      '',
      'Recent Messages:',
      '─'.repeat(40),
    ];

    // Add recent messages to context
    const recentMessages = messages.slice(-10);
    for (const message of recentMessages) {
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      this.state.contextContent.push(
        '',
        `[${timestamp}] ${message.role.toUpperCase()}:`
      );

      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          const lines = this.wrapText(block.text, this.getContextPanelWidth() - 4);
          this.state.contextContent.push(...lines.slice(0, 5));
          if (lines.length > 5) {
            this.state.contextContent.push(`... (${lines.length - 5} more lines)`);
          }
        } else if (block.type === 'tool_use') {
          this.state.contextContent.push(`🔧 Tool: ${block.name}`);
        } else if (block.type === 'tool_result') {
          const icon = block.is_error ? '❌' : '✅';
          this.state.contextContent.push(`${icon} Tool result`);
        }
      }
    }

    this.state.contextScrollOffset = 0;
  }

  private render(): void {
    // Clear screen and move cursor to top-left
    process.stdout.write('\x1B[2J\x1B[H');

    this.renderHeader();
    this.renderMainContent();
    this.renderFooter();
  }

  private renderHeader(): void {
    const title = chalk.cyan.bold('Apex TUI Dashboard');
    const activePanel = this.state.activePanel === 'projects' ? 'Projects' : 'Context';
    const statusText = chalk.gray(`Active: ${activePanel} | Tab: switch panels | ?: help | q: quit`);
    
    console.log(`${title}  ${statusText}`);
    console.log(chalk.gray('─'.repeat(this.terminalSize.width)));
  }

  private renderMainContent(): void {
    const projectsPanelWidth = Math.floor(this.terminalSize.width * 0.6);
    const contextPanelWidth = this.terminalSize.width - projectsPanelWidth - 1;
    const contentHeight = this.terminalSize.height - 4; // Header + footer

    const projectsLines = this.renderProjectsPanel(projectsPanelWidth, contentHeight);
    const contextLines = this.renderContextPanel(contextPanelWidth, contentHeight);

    // Render side by side
    for (let i = 0; i < contentHeight; i++) {
      const projectLine = projectsLines[i] || ' '.repeat(projectsPanelWidth);
      const contextLine = contextLines[i] || ' '.repeat(contextPanelWidth);
      
      console.log(projectLine + chalk.gray('│') + contextLine);
    }
  }

  private renderProjectsPanel(width: number, height: number): string[] {
    const lines: string[] = [];
    const isActive = this.state.activePanel === 'projects';
    const borderColor = isActive ? chalk.cyan : chalk.gray;

    // Panel header
    lines.push(borderColor('Projects').padEnd(width));
    lines.push(borderColor('─'.repeat(width - 2)).padEnd(width));

    if (this.state.projects.length === 0) {
      lines.push(' No projects found'.padEnd(width));
      lines.push(' Press n to create one'.padEnd(width));
    } else {
      // Render projects and their threads
      const flatItems = this.getFlatProjectItems();
      const visibleStart = Math.max(0, this.getCurrentItemIndex(flatItems) - Math.floor(height / 2));
      const visibleEnd = Math.min(flatItems.length, visibleStart + height - 2);

      for (let i = visibleStart; i < visibleEnd && lines.length < height; i++) {
        const item = flatItems[i];
        const isSelected = i === this.getCurrentItemIndex(flatItems);
        let line = '';

        if (item.type === 'project') {
          const project = this.state.projects[item.projectIndex];
          const isExpanded = this.state.expandedProjects[project.id];
          const expandIcon = isExpanded ? '▼' : '▶';
          const statusIcon = this.getStatusIcon(project.status);
          const prefix = isSelected && isActive ? chalk.cyan.bold('▶ ') : '  ';
          
          line = prefix + 
                 chalk.white(`${expandIcon} ${project.name} ${statusIcon}`) +
                 chalk.gray(` (${this.projectsCache.get(project.id)?.length || 0} threads)`);
        } else {
          const project = this.state.projects[item.projectIndex];
          const threads = this.projectsCache.get(project.id) || [];
          const thread = threads[item.threadIndex!];
          const statusIcon = this.getStatusIcon(thread.status);
          const prefix = isSelected && isActive ? chalk.cyan.bold('  ▶ ') : '    ';
          
          line = prefix + 
                 chalk.gray('├─ ') + 
                 chalk.white(`${thread.title || 'Untitled'} ${statusIcon}`) +
                 chalk.gray(` (${this.messagesCache.get(thread.id)?.length || 0} msgs)`);
        }

        lines.push(line.slice(0, width - 1).padEnd(width));
      }
    }

    // Fill remaining lines
    while (lines.length < height) {
      lines.push(' '.repeat(width));
    }

    return lines;
  }

  private renderContextPanel(width: number, height: number): string[] {
    const lines: string[] = [];
    const isActive = this.state.activePanel === 'context';
    const borderColor = isActive ? chalk.cyan : chalk.gray;

    // Panel header
    const title = this.state.selectedThread ? 'Thread Context' : 'Project Context';
    lines.push(borderColor(`${title}`).padEnd(width));
    lines.push(borderColor('─'.repeat(width - 2)).padEnd(width));

    if (this.state.contextContent.length === 0) {
      lines.push(' No selection'.padEnd(width));
    } else {
      // Render scrollable content
      const visibleContent = this.state.contextContent.slice(
        this.state.contextScrollOffset,
        this.state.contextScrollOffset + height - 2
      );

      for (const line of visibleContent) {
        const wrappedLines = this.wrapText(line, width - 2);
        for (const wrappedLine of wrappedLines.slice(0, 1)) { // Show only first wrapped line per content line
          if (lines.length < height) {
            lines.push(` ${wrappedLine}`.slice(0, width - 1).padEnd(width));
          }
        }
      }
    }

    // Fill remaining lines
    while (lines.length < height) {
      lines.push(' '.repeat(width));
    }

    // Add scroll indicator if needed
    if (this.state.contextContent.length > height - 2) {
      const scrollPercent = Math.round(
        (this.state.contextScrollOffset / (this.state.contextContent.length - height + 2)) * 100
      );
      const lastLine = lines[height - 1];
      lines[height - 1] = lastLine.slice(0, -10) + chalk.gray(`[${scrollPercent}%]`).padStart(10);
    }

    return lines;
  }

  private renderFooter(): void {
    const shortcuts = this.state.activePanel === 'projects' 
      ? 'x:toggle r:refresh n:new d:delete'
      : 'J/K:scroll r:refresh';
    
    console.log(chalk.gray('─'.repeat(this.terminalSize.width)));
    console.log(chalk.gray(`${shortcuts} | Tab:switch panels | ?:help | q:quit`));
  }

  private getContextPanelHeight(): number {
    return this.terminalSize.height - 4; // Header + footer
  }

  private getContextPanelWidth(): number {
    return Math.floor(this.terminalSize.width * 0.4);
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
      case 'active':
        return chalk.green('[RUN]');
      case 'creating':
      case 'starting':
        return chalk.yellow('[NEW]');
      case 'completed':
        return chalk.blue('[DONE]');
      case 'stopped':
        return chalk.gray('[STOP]');
      case 'error':
        return chalk.red('[ERR]');
      default:
        return chalk.white('[---]');
    }
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'running':
      case 'active':
        return chalk.green(status);
      case 'creating':
      case 'starting':
        return chalk.yellow(status);
      case 'completed':
        return chalk.blue(status);
      case 'stopped':
        return chalk.gray(status);
      case 'error':
        return chalk.red(status);
      default:
        return chalk.white(status);
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

  private wrapText(text: string, width: number): string[] {
    if (!text) return [''];
    
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
    return lines.length > 0 ? lines : [''];
  }

  private cleanup(): void {
    // Show cursor
    process.stdout.write('\x1B[?25h');
    
    // Restore terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    
    if (this.rl) {
      this.rl.close();
    }
    
    this.db.close();
    
    // Clear screen and move cursor to top
    process.stdout.write('\x1B[2J\x1B[H');
    console.log(chalk.green('Dashboard closed.'));
  }
}

export async function startFullScreenTUI(db: DB): Promise<void> {
  const tui = new FullScreenTUI(db);
  await tui.start();
}