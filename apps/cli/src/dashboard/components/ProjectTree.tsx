import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Project, Thread } from '../../types/index.js';
import chalk from 'chalk';

interface TreeItem {
  type: 'project' | 'thread';
  project?: Project;
  thread?: Thread;
  projectId: string;
  expanded?: boolean;
}

interface ProjectTreeProps {
  projects: Project[];
  projectThreads: Record<string, Thread[]>;
  expandedProjects: Set<string>;
  selectedProject: Project | null;
  selectedThread: Thread | null;
  onSelectProject: (project: Project) => void;
  onSelectThread: (thread: Thread) => void;
  onToggleExpanded: (projectId: string) => void;
  focused: boolean;
  terminalSize: { width: number; height: number };
}

export default function ProjectTree({
  projects,
  projectThreads,
  expandedProjects,
  selectedProject,
  selectedThread,
  onSelectProject,
  onSelectThread,
  onToggleExpanded,
  focused,
  terminalSize,
}: ProjectTreeProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  // Build flat tree structure
  const treeItems: TreeItem[] = [];
  projects.forEach(project => {
    const isExpanded = expandedProjects.has(project.id);
    treeItems.push({
      type: 'project',
      project,
      projectId: project.id,
      expanded: isExpanded,
    });
    
    if (isExpanded) {
      const threads = projectThreads[project.id] || [];
      threads.forEach(thread => {
        treeItems.push({
          type: 'thread',
          thread,
          projectId: project.id,
        });
      });
    }
  });

  // Update selected index when external selection changes
  useEffect(() => {
    if (selectedProject && selectedThread) {
      const index = treeItems.findIndex(
        item => item.type === 'thread' && item.thread?.id === selectedThread.id
      );
      if (index >= 0) {
        setSelectedIndex(index);
      }
    } else if (selectedProject) {
      const index = treeItems.findIndex(
        item => item.type === 'project' && item.project?.id === selectedProject.id
      );
      if (index >= 0) {
        setSelectedIndex(index);
      }
    }
  }, [selectedProject, selectedThread, treeItems]);

  useInput((input, key) => {
    if (!focused) return;

    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(treeItems.length - 1, prev + 1));
    } else if (key.return || input === ' ') {
      const selectedItem = treeItems[selectedIndex];
      if (selectedItem) {
        if (selectedItem.type === 'project' && selectedItem.project) {
          onToggleExpanded(selectedItem.project.id);
          onSelectProject(selectedItem.project);
        } else if (selectedItem.type === 'thread' && selectedItem.thread) {
          onSelectThread(selectedItem.thread);
        }
      }
    }
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
      case 'active':
        return { symbol: '●', color: chalk.yellow };
      case 'waiting_for_input':
        return { symbol: '?', color: chalk.yellow };
      case 'completed':
        return { symbol: '✓', color: chalk.green };
      case 'error':
        return { symbol: '✗', color: chalk.red };
      case 'stopped':
        return { symbol: '○', color: chalk.gray };
      default:
        return { symbol: '○', color: chalk.gray };
    }
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  };

  const formatDate = (isoString: string) => {
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
  };

  const treeWidth = Math.floor(terminalSize.width * 0.4) - 2;
  const maxHeight = terminalSize.height - 8; // Leave space for status bar and prompt

  if (projects.length === 0) {
    return (
      <Box flexDirection="column" width={treeWidth} height={maxHeight}>
        <Text bold color="cyan">📁 Projects</Text>
        <Text color="gray">  No projects found.</Text>
        <Text color="gray">  Create one with Ctrl+N</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={treeWidth} height={maxHeight}>
      <Text bold color="cyan">📁 Projects</Text>
      <Text color="gray">{'  '.padEnd(3)}{'NAME'.padEnd(20)} {'STATUS'.padEnd(10)} CREATED</Text>
      <Text color="gray">{'  ' + '─'.repeat(Math.min(60, treeWidth - 2))}</Text>
      
      <Box flexDirection="column">
        {treeItems.slice(0, maxHeight - 4).map((item, index) => {
          const isSelected = index === selectedIndex;
          const prefix = isSelected ? '▶ ' : '  ';
          
          if (item.type === 'project' && item.project) {
            const project = item.project;
            const arrow = item.expanded ? '▼' : '▶';
            const name = truncateText(project.name, treeWidth - 14);
            const status = getStatusIcon(project.status);
            const formattedDate = formatDate(project.createdAt);
            
            const leftPart = `${arrow} ${name}`;
            const rightPart = project.status;
            const padding = Math.max(1, treeWidth - leftPart.length - rightPart.length);
            
            return (
              <Text key={`project-${project.id}`} color={isSelected ? 'magenta' : 'white'}>
                {prefix}
                <Text bold>{leftPart}</Text>
                {' '.repeat(padding)}
                <Text color={status.color.hex ? undefined : 'white'}>{status.symbol}</Text>
                {' '}
                <Text color="gray">{project.provider}</Text>
              </Text>
            );
          } else if (item.type === 'thread' && item.thread) {
            const thread = item.thread;
            const title = thread.title || '(empty)';
            const truncatedTitle = truncateText(title, treeWidth - 6);
            const status = getStatusIcon(thread.status);
            
            return (
              <Text key={`thread-${thread.id}`} color={isSelected ? 'magenta' : 'gray'}>
                {prefix}
                {'   '}
                <Text color={status.color.hex ? undefined : 'gray'}>{status.symbol}</Text>
                {' '}
                <Text>{truncatedTitle}</Text>
              </Text>
            );
          }
          
          return null;
        })}
      </Box>
      
      {focused && (
        <Box marginTop={1}>
          <Text color="magenta">{'─'.repeat(Math.min(treeWidth - 2, 40))}</Text>
        </Box>
      )}
    </Box>
  );
}