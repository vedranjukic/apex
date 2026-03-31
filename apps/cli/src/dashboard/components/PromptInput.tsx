import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';

interface PromptInputProps {
  onSendPrompt: (input: string) => void;
  onSendAnswer: (answer: string) => void;
  waitingForAnswer: boolean;
  isStreaming: boolean;
  error: string;
  focused: boolean;
  terminalSize: { width: number; height: number };
}

export default function PromptInput({
  onSendPrompt,
  onSendAnswer,
  waitingForAnswer,
  isStreaming,
  error,
  focused,
  terminalSize,
}: PromptInputProps) {
  const [input, setInput] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  const inputWidth = terminalSize.width - 4;
  const maxLines = 3;

  // Reset cursor position when input changes
  useEffect(() => {
    if (cursorPosition > input.length) {
      setCursorPosition(input.length);
    }
  }, [input, cursorPosition]);

  const handleSend = () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    if (waitingForAnswer) {
      onSendAnswer(trimmedInput);
    } else {
      onSendPrompt(trimmedInput);
    }
    
    setInput('');
    setCursorPosition(0);
  };

  useInput((inputChar, key) => {
    if (!focused) return;

    if (key.return && !key.meta && !key.alt) {
      handleSend();
    } else if (key.return && (key.meta || key.alt)) {
      // Alt+Enter for new line
      const newInput = input.slice(0, cursorPosition) + '\n' + input.slice(cursorPosition);
      setInput(newInput);
      setCursorPosition(cursorPosition + 1);
    } else if (key.backspace) {
      if (cursorPosition > 0) {
        const newInput = input.slice(0, cursorPosition - 1) + input.slice(cursorPosition);
        setInput(newInput);
        setCursorPosition(cursorPosition - 1);
      }
    } else if (key.delete) {
      if (cursorPosition < input.length) {
        const newInput = input.slice(0, cursorPosition) + input.slice(cursorPosition + 1);
        setInput(newInput);
      }
    } else if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
    } else if (key.rightArrow) {
      setCursorPosition(Math.min(input.length, cursorPosition + 1));
    } else if (key.ctrl && inputChar === 'a') {
      setCursorPosition(0);
    } else if (key.ctrl && inputChar === 'e') {
      setCursorPosition(input.length);
    } else if (key.ctrl && inputChar === 'u') {
      setInput(input.slice(cursorPosition));
      setCursorPosition(0);
    } else if (key.ctrl && inputChar === 'k') {
      setInput(input.slice(0, cursorPosition));
    } else if (key.ctrl && inputChar === 'w') {
      // Delete word backward
      const beforeCursor = input.slice(0, cursorPosition);
      const match = beforeCursor.match(/\S+\s*$/);
      if (match) {
        const deleteLength = match[0].length;
        const newInput = input.slice(0, cursorPosition - deleteLength) + input.slice(cursorPosition);
        setInput(newInput);
        setCursorPosition(cursorPosition - deleteLength);
      }
    } else if (inputChar && !key.ctrl && !key.meta) {
      const newInput = input.slice(0, cursorPosition) + inputChar + input.slice(cursorPosition);
      setInput(newInput);
      setCursorPosition(cursorPosition + 1);
    }
  });

  const getPlaceholder = () => {
    if (waitingForAnswer) {
      return 'Type your answer... (Enter to send)';
    }
    return 'Type a prompt... (Enter to send · Alt+Enter new line)';
  };

  const getStatusText = () => {
    if (error) {
      return chalk.red(`Error: ${error}`);
    }
    if (waitingForAnswer) {
      return chalk.yellow('? Waiting for your answer (type below, press Enter)');
    }
    if (isStreaming) {
      return chalk.blue('Thinking...');
    }
    return '';
  };

  // Split input into lines and wrap long lines
  const wrapInput = (text: string, width: number): string[] => {
    const lines = text.split('\n');
    const wrappedLines: string[] = [];
    
    for (const line of lines) {
      if (line.length <= width) {
        wrappedLines.push(line);
      } else {
        // Wrap long lines
        for (let i = 0; i < line.length; i += width) {
          wrappedLines.push(line.slice(i, i + width));
        }
      }
    }
    
    return wrappedLines;
  };

  // Calculate cursor position in wrapped text
  const getCursorDisplayPosition = (text: string, cursorPos: number, width: number) => {
    const beforeCursor = text.slice(0, cursorPos);
    const lines = beforeCursor.split('\n');
    
    let row = 0;
    let col = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === lines.length - 1) {
        // Last line, cursor is somewhere in this line
        col = line.length % width;
        row += Math.floor(line.length / width);
      } else {
        // Full line, add its wrapped line count
        row += Math.max(1, Math.ceil(line.length / width));
      }
    }
    
    return { row, col };
  };

  const displayText = input || getPlaceholder();
  const isPlaceholder = input.length === 0;
  const wrappedLines = wrapInput(displayText, inputWidth);
  const visibleLines = wrappedLines.slice(0, maxLines);
  
  const cursorDisplay = getCursorDisplayPosition(input, cursorPosition, inputWidth);
  const showCursor = focused && !isPlaceholder && cursorDisplay.row < maxLines;

  return (
    <Box flexDirection="column" width={terminalSize.width} paddingLeft={2} paddingRight={2}>
      <Box flexDirection="column" borderStyle="single" borderColor="gray">
        {visibleLines.map((line, index) => {
          const showCursorOnThisLine = showCursor && index === cursorDisplay.row;
          const cursorCol = showCursorOnThisLine ? cursorDisplay.col : -1;
          
          return (
            <Text key={index} color={isPlaceholder ? 'gray' : 'white'}>
              {showCursorOnThisLine ? (
                <>
                  {line.slice(0, cursorCol)}
                  <Text backgroundColor="white" color="black">
                    {line[cursorCol] || ' '}
                  </Text>
                  {line.slice(cursorCol + 1)}
                </>
              ) : (
                line
              )}
            </Text>
          );
        })}
        
        {visibleLines.length < maxLines && (
          <>
            {Array.from({ length: maxLines - visibleLines.length }, (_, i) => (
              <Text key={`empty-${i}`}> </Text>
            ))}
          </>
        )}
      </Box>
      
      <Text color="gray">{getStatusText()}</Text>
      
      {focused && (
        <Text color="magenta">
          {'─'.repeat(Math.min(terminalSize.width - 4, 60))}
        </Text>
      )}
    </Box>
  );
}