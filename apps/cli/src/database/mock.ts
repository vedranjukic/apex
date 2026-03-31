import { Project, Thread, Message, User } from '../types/index.js';

// Mock database for development/testing when SQLite is not available
export class MockDatabaseManager {
  private projects: Project[] = [];
  private threads: Thread[] = [];
  private messages: Message[] = [];
  private settings: Record<string, string> = {};

  constructor(dbPath: string) {
    // Initialize with some sample data for testing
    this.initializeMockData();
  }

  private initializeMockData(): void {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Create multiple sample projects
    const projects: Omit<Project, 'createdAt' | 'updatedAt'>[] = [
      {
        id: 'project-webapp-1',
        userId: 'default-user',
        name: 'my-webapp',
        description: 'A web application project with React frontend',
        sandboxId: undefined,
        provider: 'daytona',
        status: 'running',
        agentType: 'build',
        gitRepo: 'https://github.com/user/my-webapp.git',
        agentConfig: {},
        localDir: '/home/user/projects/my-webapp',
      },
      {
        id: 'project-api-2',
        userId: 'default-user',
        name: 'api-service',
        description: 'REST API service built with Node.js and Express',
        sandboxId: undefined,
        provider: 'docker',
        status: 'stopped',
        agentType: 'build',
        gitRepo: undefined,
        agentConfig: {},
        localDir: undefined,
      },
      {
        id: 'project-mobile-3',
        userId: 'default-user',
        name: 'mobile-app',
        description: 'React Native mobile application',
        sandboxId: undefined,
        provider: 'daytona',
        status: 'creating',
        agentType: 'build',
        gitRepo: undefined,
        agentConfig: {},
        localDir: undefined,
      },
      {
        id: 'project-ml-4',
        userId: 'default-user',
        name: 'ml-pipeline',
        description: 'Machine learning data processing pipeline',
        sandboxId: undefined,
        provider: 'docker',
        status: 'completed',
        agentType: 'build',
        gitRepo: 'https://github.com/user/ml-pipeline.git',
        agentConfig: {},
        localDir: undefined,
      }
    ];

    projects.forEach((project, index) => {
      const createdAt = index < 2 ? now.toISOString() : (index === 2 ? yesterday.toISOString() : lastWeek.toISOString());
      this.projects.push({
        ...project,
        createdAt,
        updatedAt: createdAt,
      });
    });

    // Create sample threads for each project
    const threads = [
      // Threads for my-webapp
      { projectId: 'project-webapp-1', title: 'Initial setup and configuration', status: 'completed' },
      { projectId: 'project-webapp-1', title: 'Implement user authentication', status: 'active' },
      { projectId: 'project-webapp-1', title: 'Add responsive design', status: 'active' },
      { projectId: 'project-webapp-1', title: 'Fix login validation bug', status: 'completed' },
      
      // Threads for api-service
      { projectId: 'project-api-2', title: 'Set up Express server', status: 'completed' },
      { projectId: 'project-api-2', title: 'Design database schema', status: 'active' },
      
      // Threads for mobile-app
      { projectId: 'project-mobile-3', title: 'Project initialization', status: 'active' },
      
      // Threads for ml-pipeline
      { projectId: 'project-ml-4', title: 'Data preprocessing pipeline', status: 'completed' },
      { projectId: 'project-ml-4', title: 'Model training optimization', status: 'completed' },
    ];

    threads.forEach((threadData, index) => {
      const createdTime = new Date(now.getTime() - (index * 2 * 60 * 60 * 1000)); // Each thread 2 hours apart
      const thread: Thread = {
        id: `thread-${index + 1}`,
        projectId: threadData.projectId,
        title: threadData.title,
        status: threadData.status,
        sessionId: undefined,
        createdAt: createdTime.toISOString(),
        updatedAt: createdTime.toISOString(),
      };
      this.threads.push(thread);
    });

    // Create sample messages for some threads
    this.createSampleMessages();
  }

  private createSampleMessages(): void {
    const messageData = [
      {
        threadId: 'thread-1',
        messages: [
          { role: 'user', text: 'I need to set up a new React webapp. Can you help me get started?' },
          { role: 'assistant', text: 'I\'ll help you set up a React webapp! Let me start by creating the project structure and installing the necessary dependencies.\n\nFirst, I\'ll initialize the project with Vite for fast development.' },
          { role: 'user', text: 'Great! I also need to add TypeScript support and configure ESLint.' },
          { role: 'assistant', text: 'Perfect! I\'ll add TypeScript support and configure ESLint with recommended settings for React development. This will give you better type safety and code quality.' }
        ]
      },
      {
        threadId: 'thread-2',
        messages: [
          { role: 'user', text: 'How can I implement JWT authentication in my React app?' },
          { role: 'assistant', text: 'I\'ll help you implement JWT authentication! We\'ll need to:\n\n1. Set up authentication context\n2. Create login/logout functions\n3. Implement protected routes\n4. Add token refresh logic\n\nLet me start with the auth context setup.' }
        ]
      },
      {
        threadId: 'thread-5',
        messages: [
          { role: 'user', text: 'I want to create a REST API with Express.js and connect it to a PostgreSQL database.' },
          { role: 'assistant', text: 'Excellent! I\'ll help you build a robust REST API. We\'ll use:\n\n- Express.js for the server\n- PostgreSQL with connection pooling\n- Input validation with Joi\n- Authentication middleware\n- Error handling\n\nLet me start by setting up the Express server structure.' }
        ]
      }
    ];

    messageData.forEach(({ threadId, messages }) => {
      messages.forEach((msg, index) => {
        const msgTime = new Date(Date.now() - (messages.length - index) * 30 * 60 * 1000); // 30 minutes apart
        this.messages.push({
          id: `msg-${threadId}-${index + 1}`,
          threadId,
          role: msg.role as 'user' | 'assistant',
          content: [{ type: 'text', text: msg.text }],
          tokenCount: undefined,
          createdAt: msgTime.toISOString(),
        });
      });
    });
  }

  public getDefaultUser(): User {
    return {
      id: 'default-user',
      email: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public createProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project {
    const now = new Date().toISOString();
    const newProject: Project = {
      ...project,
      createdAt: now,
      updatedAt: now,
    };
    
    this.projects.push(newProject);
    return newProject;
  }

  public getProject(id: string): Project | null {
    return this.projects.find(p => p.id === id) || null;
  }

  public getProjectByName(name: string): Project | null {
    return this.projects.find(p => p.name.toLowerCase() === name.toLowerCase()) || null;
  }

  public listProjects(userId?: string): Project[] {
    if (userId) {
      return this.projects.filter(p => p.userId === userId);
    }
    return [...this.projects];
  }

  public updateProject(id: string, updates: Partial<Project>): void {
    const project = this.projects.find(p => p.id === id);
    if (project) {
      Object.assign(project, updates, { updatedAt: new Date().toISOString() });
    }
  }

  public deleteProject(id: string): void {
    this.projects = this.projects.filter(p => p.id !== id);
    this.threads = this.threads.filter(t => t.projectId !== id);
    this.messages = this.messages.filter(m => {
      const thread = this.threads.find(t => t.id === m.threadId);
      return thread?.projectId !== id;
    });
  }

  public createThread(thread: Omit<Thread, 'createdAt' | 'updatedAt'>): Thread {
    const now = new Date().toISOString();
    const newThread: Thread = {
      ...thread,
      createdAt: now,
      updatedAt: now,
    };
    
    this.threads.push(newThread);
    return newThread;
  }

  public getThread(id: string): Thread | null {
    return this.threads.find(t => t.id === id) || null;
  }

  public listThreads(projectId: string): Thread[] {
    return this.threads.filter(t => t.projectId === projectId);
  }

  public updateThread(id: string, updates: Partial<Thread>): void {
    const thread = this.threads.find(t => t.id === id);
    if (thread) {
      Object.assign(thread, updates, { updatedAt: new Date().toISOString() });
    }
  }

  public deleteThread(id: string): void {
    this.threads = this.threads.filter(t => t.id !== id);
    this.messages = this.messages.filter(m => m.threadId !== id);
  }

  public createMessage(message: Omit<Message, 'createdAt'>): Message {
    const now = new Date().toISOString();
    const newMessage: Message = {
      ...message,
      createdAt: now,
    };
    
    this.messages.push(newMessage);
    return newMessage;
  }

  public getMessages(threadId: string): Message[] {
    return this.messages.filter(m => m.threadId === threadId);
  }

  public getSetting(key: string): string | null {
    return this.settings[key] || null;
  }

  public setSetting(key: string, value: string): void {
    this.settings[key] = value;
  }

  public deleteSetting(key: string): void {
    delete this.settings[key];
  }

  public getAllSettings(): Record<string, string> {
    return { ...this.settings };
  }

  public close(): void {
    // Nothing to close for mock implementation
  }
}