import React from 'react';
import { Box, Text } from 'ink';
import { Project, Thread } from '../../types/index.js';
import chalk from 'chalk';

interface StatusBarProps {
  selectedProject: Project | null;
  selectedThread: Thread | null;
  focusedPanel: 'tree' | 'content' | 'prompt';
  fullscreen: boolean;
  hasPromptPanel: boolean;
  terminalSize: { width: number; height: number };
}

export default function StatusBar({
  selectedProject,
  selectedThread,
  focusedPanel,
  fullscreen,
  hasPromptPanel,
  terminalSize,
}: StatusBarProps) {
  
  const getBreadcrumb = () => {
    if (!selectedProject) {
      return 'Projects';
    }
    
    if (selectedThread) {
      const threadTitle = selectedThread.title || 'Untitled';
      return `${selectedProject.name} › ${threadTitle}`;
    }
    
    return selectedProject.name;
  };

  const getHelpText = () => {
    if (fullscreen) {
      return 'f/Esc: exit fullscreen · ↑/↓: scroll · q: quit';
    }
    
    if (hasPromptPanel) {
      return 'Tab: focus · Enter: send/expand · f: fullscreen · Ctrl+N: new project · n: new thread · q: quit';
    }
    
    return 'Tab: focus · Enter: expand/select · f: fullscreen · Ctrl+N: new project · Backspace: delete · q: quit';
  };

  const getAgentTypeLabel = (agentType: string) => {
    switch (agentType) {
      case 'build':
        return 'Build';
      case 'plan':
        return 'Plan';
      case 'sisyphus':
        return 'Sisyphus';
      default:
        return agentType;
    }
  };

  return (
    <Box flexDirection="column" width={terminalSize.width}>
      {/* Navigation breadcrumb */}
      <Box justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <Text color="gray">
          {getBreadcrumb()}
          {selectedProject && (
            <>
              {' │ '}
              <Text color="cyan">{getAgentTypeLabel(selectedProject.agentType)}</Text>
              {selectedProject.provider && (
                <>
                  {' │ '}
                  <Text color="gray">{selectedProject.provider}</Text>
                </>
              )}
            </>
          )}
        </Text>
        
        <Text color="gray">
          Focus: <Text color="magenta">{focusedPanel}</Text>
          {fullscreen && <Text color="yellow"> [FULLSCREEN]</Text>}
        </Text>
      </Box>
      
      {/* Help text */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text color="gray">{getHelpText()}</Text>
      </Box>
    </Box>
  );
}