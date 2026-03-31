import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';

interface CreateProjectDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function CreateProjectDialog({
  onConfirm,
  onCancel,
}: CreateProjectDialogProps) {
  const [projectName, setProjectName] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  // Reset cursor position when project name changes
  useEffect(() => {
    if (cursorPosition > projectName.length) {
      setCursorPosition(projectName.length);
    }
  }, [projectName, cursorPosition]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      const trimmedName = projectName.trim();
      if (trimmedName) {
        onConfirm(trimmedName);
      }
    } else if (key.backspace) {
      if (cursorPosition > 0) {
        const newName = projectName.slice(0, cursorPosition - 1) + projectName.slice(cursorPosition);
        setProjectName(newName);
        setCursorPosition(cursorPosition - 1);
      }
    } else if (key.delete) {
      if (cursorPosition < projectName.length) {
        const newName = projectName.slice(0, cursorPosition) + projectName.slice(cursorPosition + 1);
        setProjectName(newName);
      }
    } else if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
    } else if (key.rightArrow) {
      setCursorPosition(Math.min(projectName.length, cursorPosition + 1));
    } else if (key.ctrl && input === 'a') {
      setCursorPosition(0);
    } else if (key.ctrl && input === 'e') {
      setCursorPosition(projectName.length);
    } else if (key.ctrl && input === 'u') {
      setProjectName(projectName.slice(cursorPosition));
      setCursorPosition(0);
    } else if (key.ctrl && input === 'k') {
      setProjectName(projectName.slice(0, cursorPosition));
    } else if (input && !key.ctrl && !key.meta && input.match(/^[\w\-\.]+$/)) {
      // Only allow alphanumeric characters, hyphens, and dots
      const newName = projectName.slice(0, cursorPosition) + input + projectName.slice(cursorPosition);
      setProjectName(newName);
      setCursorPosition(cursorPosition + 1);
    }
  });

  const displayText = projectName || 'my-project';
  const isPlaceholder = projectName.length === 0;

  return (
    <Box 
      flexDirection="column" 
      borderStyle="double" 
      borderColor="cyan" 
      padding={1}
      marginX={2}
      marginY={1}
    >
      <Text bold color="cyan">Create New Project</Text>
      <Text> </Text>
      
      <Text>
        Project name: 
        <Text color={isPlaceholder ? 'gray' : 'white'}>
          {projectName.slice(0, cursorPosition)}
          <Text backgroundColor="white" color="black">
            {isPlaceholder ? displayText[0] : (projectName[cursorPosition] || ' ')}
          </Text>
          {isPlaceholder ? 
            displayText.slice(1) : 
            projectName.slice(cursorPosition + 1)
          }
        </Text>
      </Text>
      
      <Text> </Text>
      <Text color="gray">Esc: cancel · Enter: create</Text>
    </Box>
  );
}