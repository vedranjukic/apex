import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, useInput, useStdout } from 'ink';
import { Project, Thread, Message } from '../types/index.js';
import { DatabaseManager } from '../database/index.js';
import { configManager } from '../config/index.js';
import { CliSandboxManager } from '../sandbox/index.js';
import ProjectTree from './components/ProjectTree.js';
import ContentViewer from './components/ContentViewer.js';
import PromptInput from './components/PromptInput.js';
import StatusBar from './components/StatusBar.js';
import CreateProjectDialog from './components/CreateProjectDialog.js';
import DeleteConfirmationDialog from './components/DeleteConfirmationDialog.js';

export interface DashboardState {
  projects: Project[];
  projectThreads: Record<string, Thread[]>;
  expandedProjects: Set<string>;
  selectedProject: Project | null;
  selectedThread: Thread | null;
  viewingThreadId: string | null;
  focusedPanel: 'tree' | 'content' | 'prompt';
  fullscreen: boolean;
  
  // Prompt state
  hasPromptPanel: boolean;
  isStreaming: boolean;
  waitingForAnswer: boolean;
  pendingQuestion: string;
  promptError: string;
  
  // Dialog states
  showCreateDialog: boolean;
  showDeleteDialog: boolean;
  deleteProjectId: string | null;
  
  // Connection state
  sandboxManager: CliSandboxManager | null;
  connectedProjectId: string | null;
}

interface DashboardProps {
  db: DatabaseManager;
  onExit: () => void;
}

export default function Dashboard({ db, onExit }: DashboardProps) {
  const [state, setState] = useState<DashboardState>({
    projects: [],
    projectThreads: {},
    expandedProjects: new Set(),
    selectedProject: null,
    selectedThread: null,
    viewingThreadId: null,
    focusedPanel: 'tree',
    fullscreen: false,
    hasPromptPanel: false,
    isStreaming: false,
    waitingForAnswer: false,
    pendingQuestion: '',
    promptError: '',
    showCreateDialog: false,
    showDeleteDialog: false,
    deleteProjectId: null,
    sandboxManager: null,
    connectedProjectId: null,
  });

  const { stdout } = useStdout();
  const contentUpdatedRef = useRef<((threadId: string) => void) | null>(null);
  const askUserRef = useRef<((threadId: string, questionId: string) => void) | null>(null);

  // Load initial data
  useEffect(() => {
    loadProjects();
  }, []);

  // Update prompt panel state when project changes
  useEffect(() => {
    const hasPromptPanel = state.selectedProject?.status === 'running' && 
                          state.selectedProject?.sandboxId;
    setState(prev => ({ ...prev, hasPromptPanel }));
  }, [state.selectedProject]);

  const loadProjects = useCallback(async () => {
    try {
      const projects = db.listProjects();
      const projectThreads: Record<string, Thread[]> = {};
      const expandedProjects = new Set<string>();
      
      for (const project of projects) {
        projectThreads[project.id] = db.listThreads(project.id);
        expandedProjects.add(project.id); // Expand all by default
      }

      let selectedProject = projects[0] || null;
      let selectedThread: Thread | null = null;
      let viewingThreadId: string | null = null;

      if (selectedProject) {
        const threads = projectThreads[selectedProject.id];
        selectedThread = threads[0] || null;
        viewingThreadId = selectedThread?.id || null;
      }

      setState(prev => ({
        ...prev,
        projects,
        projectThreads,
        expandedProjects,
        selectedProject,
        selectedThread,
        viewingThreadId,
      }));
    } catch (error) {
      // Handle error silently or show error state
    }
  }, [db]);

  const reloadProjectThreads = useCallback((projectId: string) => {
    try {
      const threads = db.listThreads(projectId);
      setState(prev => ({
        ...prev,
        projectThreads: {
          ...prev.projectThreads,
          [projectId]: threads,
        },
      }));
    } catch (error) {
      // Handle error
    }
  }, [db]);

  const selectProject = useCallback((project: Project) => {
    const threads = state.projectThreads[project.id] || [];
    const selectedThread = threads[0] || null;
    
    setState(prev => ({
      ...prev,
      selectedProject: project,
      selectedThread,
      viewingThreadId: selectedThread?.id || null,
    }));
  }, [state.projectThreads]);

  const selectThread = useCallback((thread: Thread) => {
    setState(prev => ({
      ...prev,
      selectedThread: thread,
      viewingThreadId: thread.id,
    }));
  }, []);

  const toggleProjectExpanded = useCallback((projectId: string) => {
    setState(prev => {
      const newExpanded = new Set(prev.expandedProjects);
      if (newExpanded.has(projectId)) {
        newExpanded.delete(projectId);
      } else {
        newExpanded.add(projectId);
        // Reload threads when expanding
        reloadProjectThreads(projectId);
      }
      return { ...prev, expandedProjects: newExpanded };
    });
  }, [reloadProjectThreads]);

  const createProject = useCallback(async (name: string) => {
    try {
      setState(prev => ({ ...prev, showCreateDialog: false }));
      
      const config = configManager.config;
      const user = db.getDefaultUser();
      const projectId = `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newProject: Omit<Project, 'createdAt' | 'updatedAt'> = {
        id: projectId,
        userId: user.id,
        name,
        description: '',
        sandboxId: undefined,
        provider: config.defaultProvider,
        status: 'creating',
        agentType: config.defaultAgentType,
        gitRepo: undefined,
        agentConfig: {},
        localDir: undefined,
      };

      const project = db.createProject(newProject);

      // If we have sandbox configuration, create sandbox
      if (config.anthropicApiKey && config.daytonaApiKey) {
        const sandboxManager = new CliSandboxManager();
        try {
          const sandboxId = await sandboxManager.createSandbox(project);
          db.updateProject(project.id, { status: 'running', sandboxId });
        } catch (error) {
          db.updateProject(project.id, { status: 'error' });
        }
        sandboxManager.disconnect();
      } else {
        db.updateProject(project.id, { status: 'stopped' });
      }

      await loadProjects();
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        showCreateDialog: false,
        promptError: `Failed to create project: ${(error as Error).message}`
      }));
    }
  }, [db, loadProjects]);

  const deleteProject = useCallback(async (projectId: string) => {
    try {
      setState(prev => ({ ...prev, showDeleteDialog: false, deleteProjectId: null }));
      
      const project = state.projects.find(p => p.id === projectId);
      if (!project) return;

      // Close sandbox connection if connected
      if (state.sandboxManager && state.connectedProjectId === projectId) {
        state.sandboxManager.disconnect();
        setState(prev => ({ ...prev, sandboxManager: null, connectedProjectId: null }));
      }

      // Delete sandbox if exists
      if (project.sandboxId) {
        const config = configManager.config;
        if (config.anthropicApiKey && config.daytonaApiKey) {
          const sandboxManager = new CliSandboxManager();
          try {
            await sandboxManager.destroySandbox(project.sandboxId);
          } catch (error) {
            // Ignore sandbox deletion errors
          }
          sandboxManager.disconnect();
        }
      }

      // Delete from database
      db.deleteProject(projectId);
      
      await loadProjects();
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        showDeleteDialog: false,
        promptError: `Failed to delete project: ${(error as Error).message}`
      }));
    }
  }, [db, state.projects, state.sandboxManager, state.connectedProjectId, loadProjects]);

  const sendPrompt = useCallback(async (input: string) => {
    if (!state.selectedProject) return;
    
    let thread = state.selectedThread;
    
    // Create a new thread if none is selected
    if (!thread) {
      const threadId = `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newThread: Omit<Thread, 'createdAt' | 'updatedAt'> = {
        id: threadId,
        projectId: state.selectedProject.id,
        title: input.slice(0, 100), // Use first 100 chars as title
        status: 'active',
        sessionId: undefined,
      };
      
      thread = db.createThread(newThread);
      setState(prev => ({ ...prev, selectedThread: thread, viewingThreadId: thread!.id }));
      reloadProjectThreads(state.selectedProject.id);
    }
    
    try {
      setState(prev => ({ ...prev, isStreaming: true, promptError: '' }));
      
      // Add user message to database
      const messageId = `message-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const contentBlocks = [{ type: 'text' as const, text: input }];
      const newMessage: Omit<Message, 'createdAt'> = {
        id: messageId,
        threadId: thread.id,
        role: 'user',
        content: contentBlocks,
        tokenCount: undefined,
      };
      db.createMessage(newMessage);
      
      // Update thread status
      db.updateThread(thread.id, { status: 'active' });
      reloadProjectThreads(state.selectedProject.id);
      
      // Connect to sandbox if needed
      if (!state.sandboxManager || state.connectedProjectId !== state.selectedProject.id) {
        const config = configManager.config;
        if (!config.anthropicApiKey || !config.daytonaApiKey || !state.selectedProject.sandboxId) {
          throw new Error('Sandbox not configured or running');
        }
        
        if (state.sandboxManager) {
          state.sandboxManager.disconnect();
        }
        
        const sandboxManager = new CliSandboxManager();
        await sandboxManager.connectToSandbox(state.selectedProject.sandboxId);
        
        setState(prev => ({ 
          ...prev, 
          sandboxManager,
          connectedProjectId: state.selectedProject!.id 
        }));
        
        // Set up callbacks for real-time updates
        contentUpdatedRef.current = (threadId: string) => {
          if (threadId === state.viewingThreadId) {
            setState(prev => ({ ...prev })); // Trigger re-render
          }
        };
        
        askUserRef.current = (threadId: string, questionId: string) => {
          setState(prev => ({ 
            ...prev,
            isStreaming: false,
            waitingForAnswer: true,
            pendingQuestion: questionId,
          }));
        };
      }
      
      // Send prompt to sandbox
      await state.sandboxManager!.sendPrompt(
        state.selectedProject.sandboxId!,
        input,
        state.selectedProject.agentType
      );
      
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        isStreaming: false,
        promptError: (error as Error).message 
      }));
    }
  }, [state.selectedProject, state.selectedThread, state.sandboxManager, state.connectedProjectId, state.viewingThreadId, db, reloadProjectThreads]);

  const sendAnswer = useCallback(async (answer: string) => {
    if (!state.sandboxManager || !state.selectedThread || !state.pendingQuestion) return;
    
    try {
      // For now, just treat answer as a regular prompt since the CLI sandbox manager
      // doesn't have sendUserAnswer method yet
      await state.sandboxManager.sendPrompt(
        state.selectedProject?.sandboxId!,
        answer,
        state.selectedProject?.agentType!
      );
      
      setState(prev => ({
        ...prev,
        waitingForAnswer: false,
        pendingQuestion: '',
        isStreaming: true,
      }));
    } catch (error) {
      setState(prev => ({ 
        ...prev,
        promptError: (error as Error).message 
      }));
    }
  }, [state.sandboxManager, state.selectedThread, state.pendingQuestion, state.selectedProject]);

  const setFocus = useCallback((panel: 'tree' | 'content' | 'prompt') => {
    setState(prev => ({ ...prev, focusedPanel: panel }));
  }, []);

  const toggleFullscreen = useCallback(() => {
    setState(prev => ({ 
      ...prev, 
      fullscreen: !prev.fullscreen,
      focusedPanel: prev.fullscreen ? 'tree' : 'content'
    }));
  }, []);

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Exit dialogs first
    if (state.showCreateDialog || state.showDeleteDialog) {
      return; // Let dialogs handle input
    }
    
    if (key.ctrl && input === 'c') {
      if (state.sandboxManager) {
        state.sandboxManager.disconnect();
      }
      onExit();
      return;
    }
    
    if (input === 'q') {
      if (state.sandboxManager) {
        state.sandboxManager.disconnect();
      }
      onExit();
      return;
    }
    
    if (key.ctrl && input === 'n') {
      setState(prev => ({ ...prev, showCreateDialog: true }));
      return;
    }
    
    if (input === 'f' && state.viewingThreadId) {
      toggleFullscreen();
      return;
    }
    
    if (key.escape && state.fullscreen) {
      setState(prev => ({ ...prev, fullscreen: false, focusedPanel: 'tree' }));
      return;
    }
    
    // Tab navigation (only when not in fullscreen)
    if ((key.tab || (key.shift && key.tab)) && !state.fullscreen) {
      const panels: ('tree' | 'content' | 'prompt')[] = state.hasPromptPanel 
        ? ['tree', 'content', 'prompt'] 
        : ['tree', 'content'];
      
      const currentIndex = panels.indexOf(state.focusedPanel);
      let nextIndex: number;
      
      if (key.shift && key.tab) {
        nextIndex = currentIndex <= 0 ? panels.length - 1 : currentIndex - 1;
      } else {
        nextIndex = (currentIndex + 1) % panels.length;
      }
      
      setFocus(panels[nextIndex]);
      return;
    }
    
    // Delete key for projects
    if ((key.backspace || key.delete) && 
        state.focusedPanel === 'tree' && 
        state.selectedProject) {
      setState(prev => ({ 
        ...prev, 
        showDeleteDialog: true, 
        deleteProjectId: state.selectedProject!.id 
      }));
      return;
    }
    
    // New thread shortcut
    if (input === 'n' && 
        state.focusedPanel === 'tree' && 
        state.hasPromptPanel &&
        state.selectedProject) {
      // Create a new draft thread and focus prompt
      const threadId = `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const draftTitle = '(draft)';
      try {
        const newThread: Omit<Thread, 'createdAt' | 'updatedAt'> = {
          id: threadId,
          projectId: state.selectedProject.id,
          title: draftTitle,
          status: 'active',
          sessionId: undefined,
        };
        const thread = db.createThread(newThread);
        reloadProjectThreads(state.selectedProject.id);
        selectThread(thread);
        setFocus('prompt');
      } catch (error) {
        setState(prev => ({ 
          ...prev, 
          promptError: `Failed to create thread: ${(error as Error).message}`
        }));
      }
      return;
    }
  });

  const terminal = stdout;
  const terminalSize = terminal ? { width: terminal.columns, height: terminal.rows } : { width: 80, height: 24 };

  return (
    <Box flexDirection="column" width={terminalSize.width} height={terminalSize.height}>
      {state.fullscreen ? (
        <ContentViewer
          db={db}
          threadId={state.viewingThreadId}
          focused={true}
          terminalSize={terminalSize}
        />
      ) : (
        <>
          <Box flexGrow={1}>
            <Box width="40%" marginRight={1}>
              <ProjectTree
                projects={state.projects}
                projectThreads={state.projectThreads}
                expandedProjects={state.expandedProjects}
                selectedProject={state.selectedProject}
                selectedThread={state.selectedThread}
                onSelectProject={selectProject}
                onSelectThread={selectThread}
                onToggleExpanded={toggleProjectExpanded}
                focused={state.focusedPanel === 'tree'}
                terminalSize={terminalSize}
              />
            </Box>
            <Box flexGrow={1}>
              <ContentViewer
                db={db}
                threadId={state.viewingThreadId}
                focused={state.focusedPanel === 'content'}
                terminalSize={terminalSize}
              />
            </Box>
          </Box>
          
          {state.hasPromptPanel && (
            <PromptInput
              onSendPrompt={sendPrompt}
              onSendAnswer={sendAnswer}
              waitingForAnswer={state.waitingForAnswer}
              isStreaming={state.isStreaming}
              error={state.promptError}
              focused={state.focusedPanel === 'prompt'}
              terminalSize={terminalSize}
            />
          )}
        </>
      )}
      
      <StatusBar
        selectedProject={state.selectedProject}
        selectedThread={state.selectedThread}
        focusedPanel={state.focusedPanel}
        fullscreen={state.fullscreen}
        hasPromptPanel={state.hasPromptPanel}
        terminalSize={terminalSize}
      />
      
      {state.showCreateDialog && (
        <CreateProjectDialog
          onConfirm={createProject}
          onCancel={() => setState(prev => ({ ...prev, showCreateDialog: false }))}
        />
      )}
      
      {state.showDeleteDialog && state.deleteProjectId && (
        <DeleteConfirmationDialog
          projectName={state.projects.find(p => p.id === state.deleteProjectId)?.name || ''}
          onConfirm={() => deleteProject(state.deleteProjectId!)}
          onCancel={() => setState(prev => ({ 
            ...prev, 
            showDeleteDialog: false, 
            deleteProjectId: null 
          }))}
        />
      )}
    </Box>
  );
}

// Main function to start the dashboard
export function startDashboard() {
  const config = configManager.config;
  const db = new DatabaseManager(config.dbPath);

  const App = () => (
    <Dashboard 
      db={db}
      onExit={() => {
        db.close();
        process.exit(0);
      }}
    />
  );

  render(<App />);
}