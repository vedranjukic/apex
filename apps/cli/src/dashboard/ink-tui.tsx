import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
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

interface FlatItem {
  type: 'project' | 'thread';
  projectIndex: number;
  threadIndex?: number;
  project: Project;
  thread?: Thread;
  level: number;
  label: string;
}

const Dashboard: React.FC<DashboardProps> = ({ db }) => {
  const { exit } = useApp();
  
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [activePanel, setActivePanel] = useState<'projects' | 'context'>('projects');
  const [contextContent, setContextContent] = useState<string[]>(['Select a project or thread to view details']);
  const [contextScrollOffset, setContextScrollOffset] = useState(0);

  // Load data on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = useCallback(() => {
    const projectsList = db.listProjects();
    const projectsData: ProjectData[] = projectsList.map(project => ({
      project,
      threads: db.listThreads(project.id),
      expanded: false,
    }));
    setProjects(projectsData);
    setSelectedItemIndex(Math.min(selectedItemIndex, getFlatItems(projectsData).length - 1));
  }, [db, selectedItemIndex]);

  const getFlatItems = useCallback((projectsData: ProjectData[]): FlatItem[] => {
    const items: FlatItem[] = [];

    projectsData.forEach((projectData, projectIndex) => {
      const statusIcon = getStatusIcon(projectData.project.status);
      const expandIcon = projectData.expanded ? '▼' : '▶';
      
      items.push({
        type: 'project',
        projectIndex,
        project: projectData.project,
        level: 0,
        label: `${expandIcon} ${projectData.project.name} ${statusIcon} (${projectData.threads.length} threads)`
      });

      if (projectData.expanded) {
        projectData.threads.forEach((thread, threadIndex) => {
          const threadStatusIcon = getStatusIcon(thread.status);
          const messages = db.getMessages(thread.id);
          
          items.push({
            type: 'thread',
            projectIndex,
            threadIndex,
            project: projectData.project,
            thread,
            level: 1,
            label: `├─ ${thread.title || 'Untitled'} ${threadStatusIcon} (${messages.length} msgs)`
          });
        });
      }
    });

    return items;
  }, [db]);

  const updateContextForProject = useCallback((project: Project, threads: Thread[]) => {
    const content = [
      `Project: ${project.name}`,
      `Status: ${getStatusText(project.status)}`,
      `Provider: ${project.provider}`,
      `Created: ${formatDate(project.createdAt)}`,
      '',
      `Threads: ${threads.length}`,
    ];

    if (project.description) {
      content.push('', 'Description:', project.description);
    }

    if (project.gitRepo) {
      content.push('', 'Git Repository:', project.gitRepo);
    }

    if (project.localDir) {
      content.push('', 'Local Directory:', project.localDir);
    }

    setContextContent(content);
    setContextScrollOffset(0);
  }, []);

  const updateContextForThread = useCallback((thread: Thread) => {
    const messages = db.getMessages(thread.id);

    const content = [
      `Thread: ${thread.title || 'Untitled'}`,
      `Status: ${getStatusText(thread.status)}`,
      `Created: ${formatDate(thread.createdAt)}`,
      `Messages: ${messages.length}`,
      '',
      'Recent Messages:',
      '─'.repeat(40),
    ];

    // Add recent messages to context
    const recentMessages = messages.slice(-5);
    for (const message of recentMessages) {
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      content.push(
        '',
        `[${timestamp}] ${message.role.toUpperCase()}:`
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

    setContextContent(content);
    setContextScrollOffset(0);
  }, [db]);

  const handleSelection = useCallback(() => {
    const flatItems = getFlatItems(projects);
    const currentItem = flatItems[selectedItemIndex];

    if (!currentItem) return;

    if (currentItem.type === 'project') {
      // Toggle project expansion
      setProjects(prev => prev.map((p, i) => 
        i === currentItem.projectIndex 
          ? { ...p, expanded: !p.expanded }
          : p
      ));

      updateContextForProject(currentItem.project, projects[currentItem.projectIndex]?.threads || []);
    } else if (currentItem.thread) {
      // Select thread
      updateContextForThread(currentItem.thread);
    }
  }, [selectedItemIndex, projects, getFlatItems, updateContextForProject, updateContextForThread]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (key.tab) {
      setActivePanel(prev => prev === 'projects' ? 'context' : 'projects');
      return;
    }

    if (input === 'r') {
      loadProjects();
      return;
    }

    if (input === '?') {
      setContextContent([
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
        'Context Panel (when active):',
        '  J/K         Scroll up/down',
      ]);
      setContextScrollOffset(0);
      return;
    }

    if (activePanel === 'projects') {
      const flatItems = getFlatItems(projects);
      
      if (key.upArrow || input === 'k') {
        setSelectedItemIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        setSelectedItemIndex(prev => Math.min(flatItems.length - 1, prev + 1));
      } else if (key.return || input === ' ') {
        handleSelection();
      } else if (input === 'x') {
        handleSelection(); // Toggle expansion
      }
    } else if (activePanel === 'context') {
      if (input === 'J') {
        setContextScrollOffset(prev => Math.min(contextContent.length - 10, prev + 1));
      } else if (input === 'K') {
        setContextScrollOffset(prev => Math.max(0, prev - 1));
      }
    }
  });

  const renderProjectsList = () => {
    const flatItems = getFlatItems(projects);
    const maxHeight = 15;
    const visibleStart = Math.max(0, selectedItemIndex - Math.floor(maxHeight / 2));
    const visibleEnd = Math.min(flatItems.length, visibleStart + maxHeight);
    const visibleItems = flatItems.slice(visibleStart, visibleEnd);

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            Projects {activePanel === 'projects' ? '(Active)' : ''}
          </Text>
        </Box>
        
        {projects.length === 0 ? (
          <Box>
            <Text color="gray">No projects found.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {visibleItems.map((item, index) => {
              const globalIndex = visibleStart + index;
              const isSelected = globalIndex === selectedItemIndex && activePanel === 'projects';
              const prefix = isSelected ? '▶ ' : '  ';
              const indent = '  '.repeat(item.level);
              
              return (
                <Box key={`${item.type}-${item.projectIndex}-${item.threadIndex || 0}`}>
                  <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {prefix}{indent}{item.label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    );
  };

  const renderContextPanel = () => {
    const maxHeight = 15;
    const visibleContent = contextContent.slice(
      contextScrollOffset,
      contextScrollOffset + maxHeight
    );

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            Context {activePanel === 'context' ? '(Active)' : ''}
          </Text>
        </Box>
        
        <Box flexDirection="column">
          {visibleContent.map((line, index) => (
            <Box key={index}>
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
        
        {contextContent.length > maxHeight && (
          <Box marginTop={1}>
            <Text color="gray">
              [{Math.round((contextScrollOffset / Math.max(1, contextContent.length - maxHeight)) * 100)}%] Use J/K to scroll
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height={25}>
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
        <Box width="60%" marginRight={1}>
          {renderProjectsList()}
        </Box>
        <Box>
          <Text color="gray">│</Text>
        </Box>
        <Box width="39%" marginLeft={1}>
          {renderContextPanel()}
        </Box>
      </Box>
      
      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">{'─'.repeat(80)}</Text>
      </Box>
      <Box>
        <Text color="gray">
          {activePanel === 'projects' ? 'Enter: expand/select' : 'J/K: scroll'} | Tab: switch | r: refresh | ?: help | q: quit
        </Text>
      </Box>
    </Box>
  );
};

function getStatusIcon(status: string): string {
  switch (status) {
    case 'running':
    case 'active':
      return '[RUN]';
    case 'creating':
    case 'starting':
      return '[NEW]';
    case 'completed':
      return '[DONE]';
    case 'stopped':
      return '[STOP]';
    case 'error':
      return '[ERR]';
    default:
      return '[---]';
  }
}

function getStatusText(status: string): string {
  const colors = {
    'running': chalk.green,
    'active': chalk.green,
    'creating': chalk.yellow,
    'starting': chalk.yellow,
    'completed': chalk.blue,
    'stopped': chalk.gray,
    'error': chalk.red,
  };
  
  const color = colors[status as keyof typeof colors] || chalk.white;
  return color(status);
}

function formatDate(isoString: string): string {
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

export async function startInkTUI(db: DB): Promise<void> {
  const { waitUntilExit } = render(<Dashboard db={db} />);
  await waitUntilExit();
}