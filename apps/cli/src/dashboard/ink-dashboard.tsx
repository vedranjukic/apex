import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useFocus, useFocusManager } from 'ink';
import chalk from 'chalk';
import type { DatabaseManager } from '../database/bun-sqlite.js';
import type { MockDatabaseManager } from '../database/mock.js';
import type { Project, Thread, Message } from '../types/index.js';

type DB = DatabaseManager | MockDatabaseManager;

interface DashboardProps {
  db: DB;
}

interface ProjectData {
  project: Project;
  threads: Thread[];
  expanded: boolean;
}

interface DashboardState {
  projects: ProjectData[];
  selectedItemIndex: number;
  selectedProject?: Project;
  selectedThread?: Thread;
  activePanel: 'projects' | 'context';
  contextContent: string[];
  contextScrollOffset: number;
}

const Dashboard: React.FC<DashboardProps> = ({ db }) => {
  const [state, setState] = useState<DashboardState>({
    projects: [],
    selectedItemIndex: 0,
    activePanel: 'projects',
    contextContent: ['Select a project or thread to view details'],
    contextScrollOffset: 0,
  });

  const { focusNext, focusPrevious } = useFocusManager();

  // Load data on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = useCallback(() => {
    const projects = db.listProjects();
    const projectsData: ProjectData[] = projects.map(project => ({
      project,
      threads: db.listThreads(project.id),
      expanded: false,
    }));

    setState(prev => ({
      ...prev,
      projects: projectsData,
      selectedItemIndex: Math.min(prev.selectedItemIndex, projectsData.length - 1),
    }));
  }, [db]);

  const getFlatItems = useCallback(() => {
    const items: Array<{ type: 'project' | 'thread'; projectIndex: number; threadIndex?: number }> = [];

    state.projects.forEach((projectData, projectIndex) => {
      items.push({ type: 'project', projectIndex });

      if (projectData.expanded) {
        projectData.threads.forEach((_, threadIndex) => {
          items.push({ type: 'thread', projectIndex, threadIndex });
        });
      }
    });

    return items;
  }, [state.projects]);

  const updateContextForProject = useCallback((project: Project, threads: Thread[]) => {
    const contextContent = [
      `Project: ${project.name}`,
      `Status: ${project.status}`,
      `Provider: ${project.provider}`,
      `Created: ${new Date(project.createdAt).toLocaleDateString()}`,
      '',
      `Threads: ${threads.length}`,
    ];

    if (project.description) {
      contextContent.push('', 'Description:', project.description);
    }

    if (project.gitRepo) {
      contextContent.push('', 'Git Repository:', project.gitRepo);
    }

    if (project.localDir) {
      contextContent.push('', 'Local Directory:', project.localDir);
    }

    setState(prev => ({
      ...prev,
      contextContent,
      contextScrollOffset: 0,
    }));
  }, []);

  const updateContextForThread = useCallback(async (thread: Thread) => {
    const messages = db.getMessages(thread.id);

    const contextContent = [
      `Thread: ${thread.title || 'Untitled'}`,
      `Status: ${thread.status}`,
      `Created: ${new Date(thread.createdAt).toLocaleDateString()}`,
      `Messages: ${messages.length}`,
      '',
      'Recent Messages:',
      '─'.repeat(40),
    ];

    // Add recent messages to context
    const recentMessages = messages.slice(-5);
    for (const message of recentMessages) {
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      contextContent.push(
        '',
        `[${timestamp}] ${message.role.toUpperCase()}:`
      );

      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          const lines = block.text.split('\n').slice(0, 3);
          contextContent.push(...lines);
          if (block.text.split('\n').length > 3) {
            contextContent.push('...');
          }
        } else if (block.type === 'tool_use') {
          contextContent.push(`🔧 Tool: ${block.name}`);
        } else if (block.type === 'tool_result') {
          const icon = block.is_error ? '❌' : '✅';
          contextContent.push(`${icon} Tool result`);
        }
      }
    }

    setState(prev => ({
      ...prev,
      contextContent,
      contextScrollOffset: 0,
    }));
  }, [db]);

  const handleSelection = useCallback(() => {
    const flatItems = getFlatItems();
    const currentItem = flatItems[state.selectedItemIndex];

    if (!currentItem) return;

    if (currentItem.type === 'project') {
      const projectData = state.projects[currentItem.projectIndex];
      
      // Toggle expansion
      setState(prev => ({
        ...prev,
        projects: prev.projects.map((p, i) => 
          i === currentItem.projectIndex 
            ? { ...p, expanded: !p.expanded }
            : p
        ),
        selectedProject: projectData.project,
        selectedThread: undefined,
      }));

      updateContextForProject(projectData.project, projectData.threads);
    } else {
      const projectData = state.projects[currentItem.projectIndex];
      const thread = projectData.threads[currentItem.threadIndex!];
      
      setState(prev => ({
        ...prev,
        selectedProject: projectData.project,
        selectedThread: thread,
      }));

      updateContextForThread(thread);
    }
  }, [state.selectedItemIndex, state.projects, getFlatItems, updateContextForProject, updateContextForThread]);

  useInput((input, key) => {
    const flatItems = getFlatItems();

    if (key.upArrow || input === 'k') {
      setState(prev => ({
        ...prev,
        selectedItemIndex: Math.max(0, prev.selectedItemIndex - 1),
      }));
    } else if (key.downArrow || input === 'j') {
      setState(prev => ({
        ...prev,
        selectedItemIndex: Math.min(flatItems.length - 1, prev.selectedItemIndex + 1),
      }));
    } else if (key.return || input === ' ') {
      handleSelection();
    } else if (key.tab) {
      setState(prev => ({
        ...prev,
        activePanel: prev.activePanel === 'projects' ? 'context' : 'projects',
      }));
    } else if (input === 'r') {
      loadProjects();
    } else if (input === 'q' || key.ctrl && input === 'c') {
      process.exit(0);
    } else if (input === '?') {
      setState(prev => ({
        ...prev,
        contextContent: [
          'Apex Dashboard - Help',
          '',
          'Navigation:',
          '  ↑/k ↓/j     Navigate up/down',
          '  Enter/Space Select item or toggle expansion',
          '  Tab         Switch between panels',
          '',
          'Actions:',
          '  r           Refresh data',
          '  ?           Show this help',
          '  q/Ctrl+C    Quit',
          '',
          'Press any key to return...',
        ],
        contextScrollOffset: 0,
      }));
    } else if (state.activePanel === 'context') {
      if (input === 'J') {
        setState(prev => ({
          ...prev,
          contextScrollOffset: Math.min(
            prev.contextContent.length - 10,
            prev.contextScrollOffset + 1
          ),
        }));
      } else if (input === 'K') {
        setState(prev => ({
          ...prev,
          contextScrollOffset: Math.max(0, prev.contextScrollOffset - 1),
        }));
      }
    }
  });

  const renderProjectsList = () => {
    const flatItems = getFlatItems();
    
    return (
      <Box flexDirection="column" width="60%">
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            📁 Projects {state.activePanel === 'projects' ? '(Active)' : ''}
          </Text>
        </Box>
        
        {state.projects.length === 0 ? (
          <Box>
            <Text color="gray">No projects found.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {flatItems.map((item, index) => {
              const isSelected = index === state.selectedItemIndex && state.activePanel === 'projects';
              
              if (item.type === 'project') {
                const projectData = state.projects[item.projectIndex];
                const project = projectData.project;
                const expandIcon = projectData.expanded ? '▼' : '▶';
                const statusColor = getStatusColor(project.status);
                
                return (
                  <Box key={`project-${item.projectIndex}`}>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                      {isSelected ? '▶ ' : '  '}
                      {expandIcon} {project.name} {statusColor(project.status)} ({projectData.threads.length} threads)
                    </Text>
                  </Box>
                );
              } else {
                const projectData = state.projects[item.projectIndex];
                const thread = projectData.threads[item.threadIndex!];
                const statusColor = getStatusColor(thread.status);
                const messageCount = db.getMessages(thread.id).length;
                
                return (
                  <Box key={`thread-${item.projectIndex}-${item.threadIndex}`}>
                    <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                      {isSelected ? '  ▶ ' : '    '}
                      ├─ {thread.title || 'Untitled'} {statusColor(thread.status)} ({messageCount} msgs)
                    </Text>
                  </Box>
                );
              }
            })}
          </Box>
        )}
      </Box>
    );
  };

  const renderContextPanel = () => {
    const visibleContent = state.contextContent.slice(
      state.contextScrollOffset,
      state.contextScrollOffset + 15
    );

    return (
      <Box flexDirection="column" width="40%" paddingLeft={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            📋 Context {state.activePanel === 'context' ? '(Active)' : ''}
          </Text>
        </Box>
        
        <Box flexDirection="column">
          {visibleContent.map((line, index) => (
            <Box key={index}>
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
        
        {state.contextContent.length > 15 && (
          <Box marginTop={1}>
            <Text color="gray">
              [{Math.round((state.contextScrollOffset / (state.contextContent.length - 15)) * 100)}%] Use J/K to scroll
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Apex TUI Dashboard
        </Text>
        <Text color="gray"> | Tab: switch panels | ?: help | q: quit</Text>
      </Box>
      
      {/* Separator */}
      <Box marginBottom={1}>
        <Text color="gray">{'─'.repeat(80)}</Text>
      </Box>
      
      {/* Main content */}
      <Box flexDirection="row" flexGrow={1}>
        {renderProjectsList()}
        <Box>
          <Text color="gray">│</Text>
        </Box>
        {renderContextPanel()}
      </Box>
      
      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">{'─'.repeat(80)}</Text>
      </Box>
      <Box>
        <Text color="gray">
          {state.activePanel === 'projects' ? 'Enter: expand/select' : 'J/K: scroll'} | Tab: switch | r: refresh | ?: help | q: quit
        </Text>
      </Box>
    </Box>
  );
};

function getStatusColor(status: string) {
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

export async function startInkDashboard(db: DB): Promise<void> {
  const { waitUntilExit } = render(<Dashboard db={db} />);
  await waitUntilExit();
}