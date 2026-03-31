import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { DatabaseManager } from '../../database/index.js';
import { Message, ContentBlock } from '../../types/index.js';
import chalk from 'chalk';

interface ContentViewerProps {
  db: DatabaseManager;
  threadId: string | null;
  focused: boolean;
  terminalSize: { width: number; height: number };
}

export default function ContentViewer({ 
  db, 
  threadId, 
  focused, 
  terminalSize 
}: ContentViewerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [content, setContent] = useState<string[]>([]);

  const contentWidth = Math.floor(terminalSize.width * 0.6) - 2;
  const contentHeight = terminalSize.height - 8; // Leave space for status bar and prompt

  // Load messages when threadId changes
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setContent(['Select a thread to view messages']);
      return;
    }

    try {
      const messageRows = db.getMessages(threadId);
      setMessages(messageRows);
      
      if (messageRows.length === 0) {
        setContent(['No messages in this thread']);
        setScrollPosition(0);
        return;
      }

      // Format messages for display
      const formattedContent = formatMessages(messageRows, contentWidth);
      setContent(formattedContent);
      
      // Auto-scroll to bottom
      const maxScroll = Math.max(0, formattedContent.length - contentHeight);
      setScrollPosition(maxScroll);
    } catch (error) {
      setContent([`Failed to load messages: ${(error as Error).message}`]);
    }
  }, [threadId, db, contentWidth, contentHeight]);

  const formatMessages = (messages: Message[], width: number): string[] => {
    const lines: string[] = [];
    
    for (const message of messages) {
      const timestamp = new Date(message.createdAt).toLocaleTimeString();
      const roleColor = message.role === 'user' ? chalk.green : chalk.blue;
      const header = `[${timestamp}] ${message.role.toUpperCase()}:`;
      
      lines.push(roleColor(header));
      
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          const textLines = wrapText(block.text, width - 2);
          textLines.forEach(line => {
            lines.push(`  ${line}`);
          });
        } else if (block.type === 'tool_use' && block.name) {
          lines.push(chalk.cyan(`  🔧 Using tool: ${block.name}`));
          if (block.input) {
            const inputStr = typeof block.input === 'string' 
              ? block.input 
              : JSON.stringify(block.input, null, 2);
            const inputLines = wrapText(inputStr, width - 4);
            inputLines.forEach(line => {
              lines.push(chalk.gray(`    ${line}`));
            });
          }
        } else if (block.type === 'tool_result') {
          const isError = block.is_error;
          const resultColor = isError ? chalk.red : chalk.green;
          lines.push(resultColor(`  ${isError ? '❌' : '✅'} Tool result`));
          
          if (block.content) {
            const resultStr = typeof block.content === 'string' 
              ? block.content 
              : JSON.stringify(block.content, null, 2);
            const resultLines = wrapText(resultStr, width - 4);
            resultLines.slice(0, 10).forEach(line => { // Limit tool result display
              lines.push(chalk.gray(`    ${line}`));
            });
            if (resultLines.length > 10) {
              lines.push(chalk.gray(`    ... (${resultLines.length - 10} more lines)`));
            }
          }
        }
      }
      
      lines.push(''); // Empty line between messages
    }
    
    return lines;
  };

  const wrapText = (text: string, width: number): string[] => {
    const lines: string[] = [];
    const paragraphs = text.split('\n');
    
    for (const paragraph of paragraphs) {
      if (paragraph.length === 0) {
        lines.push('');
        continue;
      }
      
      const words = paragraph.split(' ');
      let currentLine = '';
      
      for (const word of words) {
        if (currentLine.length === 0) {
          currentLine = word;
        } else if (currentLine.length + word.length + 1 <= width) {
          currentLine += ' ' + word;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
    }
    
    return lines;
  };

  // Handle scrolling when focused
  useInput((input, key) => {
    if (!focused) return;

    if (key.upArrow || input === 'k') {
      setScrollPosition(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      const maxScroll = Math.max(0, content.length - contentHeight);
      setScrollPosition(prev => Math.min(maxScroll, prev + 1));
    } else if (key.pageUp) {
      setScrollPosition(prev => Math.max(0, prev - contentHeight));
    } else if (key.pageDown) {
      const maxScroll = Math.max(0, content.length - contentHeight);
      setScrollPosition(prev => Math.min(maxScroll, prev + contentHeight));
    } else if (input === 'g') {
      setScrollPosition(0);
    } else if (input === 'G') {
      const maxScroll = Math.max(0, content.length - contentHeight);
      setScrollPosition(maxScroll);
    }
  });

  const getThreadInfo = (): string => {
    if (!threadId) return '';
    
    const thread = messages.length > 0 ? 
      (() => {
        // Try to get thread info from first message
        try {
          const threads = db.listThreads(''); // This would need the project ID
          return threads.find(t => t.id === threadId);
        } catch {
          return null;
        }
      })() : null;
    
    if (!thread) return `Thread: ${threadId.slice(0, 8)}`;
    
    const shortId = threadId.slice(0, 8);
    const title = thread.title || '(empty)';
    const status = thread.status;
    
    const statusIcon = (() => {
      switch (status) {
        case 'running':
        case 'active':
          return chalk.yellow('●');
        case 'waiting_for_input':
          return chalk.yellow('?');
        case 'completed':
          return chalk.green('✓');
        case 'error':
          return chalk.red('✗');
        default:
          return chalk.gray('○');
      }
    })();
    
    return `${statusIcon} ${title}  ${chalk.gray(shortId)}`;
  };

  // Calculate visible content
  const visibleContent = content.slice(
    scrollPosition, 
    scrollPosition + contentHeight - (threadId ? 3 : 0) // Leave space for header
  );

  const scrollInfo = content.length > contentHeight ? 
    ` (${scrollPosition + 1}-${Math.min(scrollPosition + contentHeight, content.length)}/${content.length})` : 
    '';

  return (
    <Box flexDirection="column" width={contentWidth} height={contentHeight}>
      {threadId && (
        <>
          <Text>{getThreadInfo()}</Text>
          <Text color="gray">{'─'.repeat(Math.min(contentWidth - 2, 60))}</Text>
        </>
      )}
      
      <Box flexDirection="column">
        {visibleContent.map((line, index) => (
          <Text key={scrollPosition + index} wrap="truncate">
            {line}
          </Text>
        ))}
      </Box>
      
      {focused && (
        <Box marginTop={1}>
          <Text color="magenta">
            {'─'.repeat(Math.min(contentWidth - 2 - scrollInfo.length, 40))}
            {scrollInfo && <Text color="gray">{scrollInfo}</Text>}
          </Text>
        </Box>
      )}
    </Box>
  );
}