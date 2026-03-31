import React from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';

interface DeleteConfirmationDialogProps {
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmationDialog({
  projectName,
  onConfirm,
  onCancel,
}: DeleteConfirmationDialogProps) {

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape || key.return) {
      onCancel();
    }
  });

  return (
    <Box 
      flexDirection="column" 
      borderStyle="double" 
      borderColor="red" 
      padding={1}
      marginX={2}
      marginY={1}
    >
      <Text bold color="red">Delete Project</Text>
      <Text> </Text>
      
      <Text>
        Delete project{' '}
        <Text bold color="white">"{projectName}"</Text>
        ?
      </Text>
      
      <Text color="red">This action cannot be undone!</Text>
      <Text> </Text>
      
      <Text color="gray">
        <Text color="white">y</Text>: yes · <Text color="white">N</Text>/Esc: cancel
      </Text>
    </Box>
  );
}