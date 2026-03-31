import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import type { DatabaseManager } from '../database/bun-sqlite.js';
import type { MockDatabaseManager } from '../database/mock.js';
import type { Project, Thread } from '../types/index.js';

type DB = DatabaseManager | MockDatabaseManager;

interface DashboardProps {
  db: DB;
}

const Dashboard: React.FC<DashboardProps> = ({ db }) => {
  const { exit } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<'projects' | 'context'>('projects');
  const [context, setContext] = useState<string[]>(['Select a project to view details']);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const projectList = db.listProjects();
    setProjects(projectList);
    setSelectedIndex(Math.min(selectedIndex, projectList.length - 1));
  };

  const getFlatItems = () => {
    const items: Array<{type: 'project' | 'thread', project: Project, thread?: Thread, label: string}> = [];
    
    projects.forEach((project) => {
      const isExpanded = expandedProjects.has(project.id);
      const threads = db.listThreads(project.id);
      const icon = isExpanded ? '▼' : '▶';
      
      items.push({
        type: 'project',
        project,
        label: `${icon} ${project.name} (${threads.length} threads)`
      });
      
      if (isExpanded) {
        threads.forEach((thread) => {
          const messages = db.getMessages(thread.id);
          items.push({
            type: 'thread',
            project,
            thread,
            label: `  ├─ ${thread.title || 'Untitled'} (${messages.length} msgs)`
          });
        });
      }
    });
    
    return items;
  };

  const updateContext = (item: ReturnType<typeof getFlatItems>[0]) => {
    if (item.type === 'project') {
      const threads = db.listThreads(item.project.id);
      setContext([
        `Project: ${item.project.name}`,
        `Status: ${item.project.status}`,
        `Provider: ${item.project.provider}`,
        `Threads: ${threads.length}`,
        '',
        item.project.description || 'No description'
      ]);
    } else if (item.thread) {
      const messages = db.getMessages(item.thread.id);
      setContext([
        `Thread: ${item.thread.title || 'Untitled'}`,
        `Status: ${item.thread.status}`,
        `Messages: ${messages.length}`,
        '',
        'Recent activity...'
      ]);
    }
  };

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    if (key.tab) {
      setActivePanel(prev => prev === 'projects' ? 'context' : 'projects');
      return;
    }

    if (activePanel === 'projects') {
      const flatItems = getFlatItems();
      
      if (key.upArrow || input === 'k') {
        const newIndex = Math.max(0, selectedIndex - 1);
        setSelectedIndex(newIndex);
        if (flatItems[newIndex]) updateContext(flatItems[newIndex]);
      } else if (key.downArrow || input === 'j') {
        const newIndex = Math.min(flatItems.length - 1, selectedIndex + 1);
        setSelectedIndex(newIndex);
        if (flatItems[newIndex]) updateContext(flatItems[newIndex]);
      } else if (key.return || input === ' ') {
        const item = flatItems[selectedIndex];
        if (item?.type === 'project') {
          setExpandedProjects(prev => {
            const newSet = new Set(prev);
            if (newSet.has(item.project.id)) {
              newSet.delete(item.project.id);
            } else {
              newSet.add(item.project.id);
            }
            return newSet;
          });
        }
        if (item) updateContext(item);
      }
    }

    if (input === 'r') {
      loadData();
    }

    if (input === '?') {
      setContext([
        'Apex Dashboard Help',
        '',
        'Navigation:',
        '  ↑/k, ↓/j - Navigate',
        '  Enter    - Expand/collapse',
        '  Tab      - Switch panels',
        '  r        - Refresh',
        '  q        - Quit'
      ]);
    }
  });

  const flatItems = getFlatItems();

  return (
    <Box flexDirection="column" height={25}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>Apex TUI Dashboard</Text>
        <Text color="gray"> | Tab: switch | ?: help | q: quit</Text>
      </Box>
      
      <Box flexDirection="row" flexGrow={1}>
        <Box width="60%" flexDirection="column" borderStyle="round" borderColor={activePanel === 'projects' ? 'cyan' : 'gray'}>
          <Text color="cyan" bold> Projects {activePanel === 'projects' ? '(Active)' : ''} </Text>
          <Box flexDirection="column">
            {flatItems.map((item, index) => (
              <Box key={index}>
                <Text color={index === selectedIndex && activePanel === 'projects' ? 'cyan' : 'white'} 
                      bold={index === selectedIndex && activePanel === 'projects'}>
                  {index === selectedIndex && activePanel === 'projects' ? '▶ ' : '  '}
                  {item.label}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
        
        <Box width="40%" marginLeft={1} flexDirection="column" borderStyle="round" borderColor={activePanel === 'context' ? 'cyan' : 'gray'}>
          <Text color="cyan" bold> Context {activePanel === 'context' ? '(Active)' : ''} </Text>
          <Box flexDirection="column">
            {context.map((line, index) => (
              <Box key={index}>
                <Text>{line}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      
      <Box marginTop={1}>
        <Text color="gray">
          {activePanel === 'projects' ? 'Enter: expand | ' : 'J/K: scroll | '}
          Tab: switch | r: refresh | ?: help | q: quit
        </Text>
      </Box>
    </Box>
  );
};

export async function startInkTUISimple(db: DB): Promise<void> {
  const { waitUntilExit } = render(<Dashboard db={db} />);
  await waitUntilExit();
}