import blessed from 'neo-blessed';
import chalk from 'chalk';
import type { DatabaseManager } from '../database/bun-sqlite.js';
import type { MockDatabaseManager } from '../database/mock.js';
import type { Project, Thread, Message } from '../types/index.js';

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

export class BlessedDashboard {
  private db: DB;
  private screen: blessed.Widgets.Screen;
  private projectsList: blessed.Widgets.ListElement;
  private contextBox: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  private footerBox: blessed.Widgets.BoxElement;
  
  private state: DashboardState;
  private projectsCache: Map<string, Thread[]> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();

  constructor(db: DB) {
    this.db = db;
    this.state = {
      activePanel: 'projects',
      selectedProjectIndex: 0,
      selectedThreadIndex: -1,
      projects: [],
      expandedProjects: {},
      contextScrollOffset: 0,
      contextContent: ['Select a project or thread to view details'],
    };

    this.initializeScreen();
    this.setupEventHandlers();
  }

  private initializeScreen(): void {
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Apex Dashboard',
      dockBorders: false,
      fullUnicode: true,
    });

    // Header
    this.headerBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 2,
      content: '{cyan-fg}{bold}Apex TUI Dashboard{/bold}{/cyan-fg}  {gray-fg}Tab: switch panels | ?: help | q: quit{/gray-fg}',
      tags: true,
      style: {
        bg: 'black',
      },
    });

    // Projects list (left panel)
    this.projectsList = blessed.list({
      label: ' Projects ',
      top: 2,
      left: 0,
      width: '60%',
      height: '100%-4',
      border: {
        type: 'line',
        fg: 'cyan',
      },
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
        item: {
          fg: 'white',
        },
        label: {
          fg: 'cyan',
          bold: true,
        },
      },
      tags: true,
      mouse: true,
      keys: true,
      vi: true,
    });

    // Context panel (right panel)
    this.contextBox = blessed.box({
      label: ' Context ',
      top: 2,
      left: '60%',
      width: '40%',
      height: '100%-4',
      border: {
        type: 'line',
        fg: 'gray',
      },
      style: {
        label: {
          fg: 'cyan',
          bold: true,
        },
      },
      content: 'Select a project or thread to view details',
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
    });

    // Footer
    this.footerBox = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      content: '{gray-fg}Enter: expand/select | Tab: switch panels | r: refresh | ?: help | q: quit{/gray-fg}',
      tags: true,
      style: {
        bg: 'black',
      },
    });

    // Append to screen
    this.screen.append(this.headerBox);
    this.screen.append(this.projectsList);
    this.screen.append(this.contextBox);
    this.screen.append(this.footerBox);

    // Focus on projects list initially
    this.projectsList.focus();
    this.updatePanelBorders();
  }

  private setupEventHandlers(): void {
    // Screen-level key handling
    this.screen.key(['q', 'C-c'], () => {
      this.cleanup();
      process.exit(0);
    });

    this.screen.key(['tab'], () => {
      this.switchPanel();
    });

    this.screen.key(['r'], () => {
      this.loadData();
    });

    this.screen.key(['?'], () => {
      this.showHelp();
    });

    // Projects list events
    this.projectsList.key(['enter', 'space'], () => {
      this.handleProjectSelection();
    });

    this.projectsList.key(['right', 'l'], () => {
      this.expandCurrentProject();
    });

    this.projectsList.key(['left', 'h'], () => {
      this.collapseCurrentProject();
    });

    this.projectsList.key(['x'], () => {
      this.toggleProjectExpansion();
    });

    // Context panel scrolling
    this.contextBox.key(['j', 'down'], () => {
      this.contextBox.scroll(1);
      this.screen.render();
    });

    this.contextBox.key(['k', 'up'], () => {
      this.contextBox.scroll(-1);
      this.screen.render();
    });

    // Mouse support
    this.projectsList.on('select', (item, index) => {
      this.handleProjectSelection();
    });

    // Handle terminal resize
    this.screen.on('resize', () => {
      this.screen.render();
    });
  }

  private switchPanel(): void {
    this.state.activePanel = this.state.activePanel === 'projects' ? 'context' : 'projects';
    
    if (this.state.activePanel === 'projects') {
      this.projectsList.focus();
    } else {
      this.contextBox.focus();
    }
    
    this.updatePanelBorders();
    this.screen.render();
  }

  private updatePanelBorders(): void {
    if (this.state.activePanel === 'projects') {
      this.projectsList.style.border = { fg: 'cyan' };
      this.contextBox.style.border = { fg: 'gray' };
      this.projectsList.setLabel(' Projects (Active) ');
      this.contextBox.setLabel(' Context ');
    } else {
      this.projectsList.style.border = { fg: 'gray' };
      this.contextBox.style.border = { fg: 'cyan' };
      this.projectsList.setLabel(' Projects ');
      this.contextBox.setLabel(' Context (Active) ');
    }
  }

  private getFlatProjectItems(): Array<{ type: 'project' | 'thread'; projectIndex: number; threadIndex?: number; label: string }> {
    const items: Array<{ type: 'project' | 'thread'; projectIndex: number; threadIndex?: number; label: string }> = [];

    this.state.projects.forEach((project, projectIndex) => {
      const isExpanded = this.state.expandedProjects[project.id];
      const expandIcon = isExpanded ? '▼' : '▶';
      const statusColor = this.getStatusIcon(project.status);
      const threads = this.projectsCache.get(project.id) || [];
      
      items.push({
        type: 'project',
        projectIndex,
        label: `${expandIcon} {bold}${project.name}{/bold} ${statusColor} (${threads.length} threads)`
      });

      if (isExpanded) {
        threads.forEach((thread, threadIndex) => {
          const threadStatusColor = this.getStatusIcon(thread.status);
          const messageCount = this.messagesCache.get(thread.id)?.length || 0;
          
          items.push({
            type: 'thread',
            projectIndex,
            threadIndex,
            label: `  ├─ ${thread.title || 'Untitled'} ${threadStatusColor} (${messageCount} msgs)`
          });
        });
      }
    });

    return items;
  }

  private handleProjectSelection(): void {
    const flatItems = this.getFlatProjectItems();
    const currentIndex = this.projectsList.selected;
    const currentItem = flatItems[currentIndex];

    if (!currentItem) return;

    if (currentItem.type === 'project') {
      // Toggle project expansion
      const project = this.state.projects[currentItem.projectIndex];
      this.state.expandedProjects[project.id] = !this.state.expandedProjects[project.id];
      
      if (this.state.expandedProjects[project.id]) {
        this.loadProjectThreads(project.id);
      }

      this.state.selectedProject = project;
      this.state.selectedThread = undefined;
      this.updateContextForProject();
      this.updateProjectsList();
    } else {
      // Select thread
      const project = this.state.projects[currentItem.projectIndex];
      const threads = this.projectsCache.get(project.id) || [];
      const thread = threads[currentItem.threadIndex!];
      
      this.state.selectedProject = project;
      this.state.selectedThread = thread;
      this.updateContextForThread();
    }

    this.screen.render();
  }

  private expandCurrentProject(): void {
    const flatItems = this.getFlatProjectItems();
    const currentIndex = this.projectsList.selected;
    const currentItem = flatItems[currentIndex];

    if (currentItem?.type === 'project') {
      const project = this.state.projects[currentItem.projectIndex];
      if (!this.state.expandedProjects[project.id]) {
        this.state.expandedProjects[project.id] = true;
        this.loadProjectThreads(project.id);
        this.updateProjectsList();
        this.screen.render();
      }
    }
  }

  private collapseCurrentProject(): void {
    const flatItems = this.getFlatProjectItems();
    const currentIndex = this.projectsList.selected;
    const currentItem = flatItems[currentIndex];

    if (currentItem?.type === 'project') {
      const project = this.state.projects[currentItem.projectIndex];
      if (this.state.expandedProjects[project.id]) {
        this.state.expandedProjects[project.id] = false;
        this.updateProjectsList();
        this.screen.render();
      }
    }
  }

  private toggleProjectExpansion(): void {
    const flatItems = this.getFlatProjectItems();
    const currentIndex = this.projectsList.selected;
    const currentItem = flatItems[currentIndex];

    if (currentItem?.type === 'project') {
      const project = this.state.projects[currentItem.projectIndex];
      this.state.expandedProjects[project.id] = !this.state.expandedProjects[project.id];
      
      if (this.state.expandedProjects[project.id]) {
        this.loadProjectThreads(project.id);
      }
      
      this.updateProjectsList();
      this.screen.render();
    }
  }

  private updateProjectsList(): void {
    const flatItems = this.getFlatProjectItems();
    const items = flatItems.map(item => item.label);
    
    this.projectsList.setItems(items);
  }

  private loadData(): void {
    this.state.projects = this.db.listProjects();
    
    // Pre-load threads for expanded projects
    for (const project of this.state.projects) {
      if (this.state.expandedProjects[project.id]) {
        this.loadProjectThreads(project.id);
      }
    }

    this.updateProjectsList();
    this.screen.render();
  }

  private loadProjectThreads(projectId: string): void {
    const threads = this.db.listThreads(projectId);
    this.projectsCache.set(projectId, threads);

    // Pre-load message counts
    threads.forEach(thread => {
      const messages = this.db.getMessages(thread.id);
      this.messagesCache.set(thread.id, messages);
    });
  }

  private updateContextForProject(): void {
    if (!this.state.selectedProject) {
      this.contextBox.setContent('No project selected');
      return;
    }

    const project = this.state.selectedProject;
    const threads = this.projectsCache.get(project.id) || [];

    const content = [
      `{bold}Project:{/bold} ${project.name}`,
      `{bold}Status:{/bold} ${this.getStatusText(project.status)}`,
      `{bold}Provider:{/bold} ${project.provider}`,
      `{bold}Created:{/bold} ${this.formatDate(project.createdAt)}`,
      '',
      `{bold}Threads:{/bold} ${threads.length}`,
    ];

    if (project.description) {
      content.push('', '{bold}Description:{/bold}', project.description);
    }

    if (project.gitRepo) {
      content.push('', '{bold}Git Repository:{/bold}', project.gitRepo);
    }

    if (project.localDir) {
      content.push('', '{bold}Local Directory:{/bold}', project.localDir);
    }

    this.contextBox.setContent(content.join('\n'));
  }

  private updateContextForThread(): void {
    if (!this.state.selectedThread) {
      this.contextBox.setContent('No thread selected');
      return;
    }

    const thread = this.state.selectedThread;
    const messages = this.messagesCache.get(thread.id) || [];

    const content = [
      `{bold}Thread:{/bold} ${thread.title || 'Untitled'}`,
      `{bold}Status:{/bold} ${this.getStatusText(thread.status)}`,
      `{bold}Created:{/bold} ${this.formatDate(thread.createdAt)}`,
      `{bold}Messages:{/bold} ${messages.length}`,
      '',
      '{bold}Recent Messages:{/bold}',
      '─'.repeat(40),
    ];

    // Add recent messages
    const recentMessages = messages.slice(-5);
    for (const message of recentMessages) {
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      content.push(
        '',
        `{bold}[${timestamp}] ${message.role.toUpperCase()}:{/bold}`
      );

      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          const lines = block.text.split('\n').slice(0, 3);
          content.push(...lines);
          if (block.text.split('\n').length > 3) {
            content.push('...');
          }
        } else if (block.type === 'tool_use') {
          content.push(`[TOOL] ${block.name}`);
        } else if (block.type === 'tool_result') {
          const icon = block.is_error ? '[ERR]' : '[OK]';
          content.push(`${icon} Tool result`);
        }
      }
    }

    this.contextBox.setContent(content.join('\n'));
  }

  private showHelp(): void {
    const helpContent = [
      '{bold}{cyan-fg}Apex Dashboard - Help{/cyan-fg}{/bold}',
      '',
      '{bold}Navigation:{/bold}',
      '  ↑/↓ j/k     Navigate up/down',
      '  →/l         Expand project',
      '  ←/h         Collapse project',
      '  Enter/Space Select item or toggle expansion',
      '  Tab         Switch between project list and context panel',
      '  x           Toggle project expansion',
      '',
      '{bold}Context Panel (when active):{/bold}',
      '  j/k ↑/↓     Scroll up/down',
      '',
      '{bold}Actions:{/bold}',
      '  r           Refresh all data',
      '  ?           Show this help',
      '  q/Ctrl+C    Quit',
      '',
      'Press any key to return...',
    ];

    this.contextBox.setContent(helpContent.join('\n'));
    this.screen.render();
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
      case 'active':
        return '{green-fg}[RUN]{/green-fg}';
      case 'creating':
      case 'starting':
        return '{yellow-fg}[NEW]{/yellow-fg}';
      case 'completed':
        return '{blue-fg}[DONE]{/blue-fg}';
      case 'stopped':
        return '{gray-fg}[STOP]{/gray-fg}';
      case 'error':
        return '{red-fg}[ERR]{/red-fg}';
      default:
        return '{white-fg}[---]{/white-fg}';
    }
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'running':
      case 'active':
        return `{green-fg}${status}{/green-fg}`;
      case 'creating':
      case 'starting':
        return `{yellow-fg}${status}{/yellow-fg}`;
      case 'completed':
        return `{blue-fg}${status}{/blue-fg}`;
      case 'stopped':
        return `{gray-fg}${status}{/gray-fg}`;
      case 'error':
        return `{red-fg}${status}{/red-fg}`;
      default:
        return `{white-fg}${status}{/white-fg}`;
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

  async start(): Promise<void> {
    // Load initial data
    this.loadData();
    
    // Render screen
    this.screen.render();

    // Return a promise that resolves when the app exits
    return new Promise((resolve) => {
      this.screen.on('destroy', resolve);
    });
  }

  private cleanup(): void {
    this.screen.destroy();
    this.db.close();
  }
}

export async function startBlessedDashboard(db: DB): Promise<void> {
  const dashboard = new BlessedDashboard(db);
  await dashboard.start();
}