import { useEffect, useRef } from 'react';
import { useCommandStore, type Command } from '../stores/command-store';
import { useTerminalStore } from '../stores/terminal-store';
import { useChatsStore } from '../stores/tasks-store';
import { usePanelsStore } from '../stores/panels-store';
import { useEditorStore } from '../stores/editor-store';
import { useThemeStore } from '../stores/theme-store';

interface UseProjectCommandsDeps {
  createTerminal: (
    terminalId: string,
    cols: number,
    rows: number,
    name?: string,
  ) => void;
  sendPrompt: (chatId: string, prompt: string) => void;
  writeFile: (path: string, content: string) => void;
}

function buildAgentCommand(
  id: string,
  label: string,
  slashCommand: string,
  sendPrompt: (chatId: string, prompt: string) => void,
): Command {
  return {
    id,
    label,
    category: 'Agent',
    execute: () => {
      const chatId = useChatsStore.getState().activeChatId;
      if (chatId) sendPrompt(chatId, slashCommand);
    },
  };
}

export function useProjectCommands({ createTerminal, sendPrompt, writeFile }: UseProjectCommandsDeps) {
  const register = useCommandStore((s) => s.register);
  const unregister = useCommandStore((s) => s.unregister);
  const depsRef = useRef({ createTerminal, sendPrompt, writeFile });
  depsRef.current = { createTerminal, sendPrompt, writeFile };

  useEffect(() => {
    const commands: Command[] = [
      {
        id: 'terminal.new',
        label: 'New Terminal',
        category: 'Terminal',
        execute: () => {
          const store = useTerminalStore.getState();
          const num = store.getNextTerminalNumber();
          const id = `term-${crypto.randomUUID().slice(0, 8)}`;
          const name = `Terminal ${num}`;
          store.addTerminal({ id, name, status: 'alive' });
          depsRef.current.createTerminal(id, 80, 24, name);
        },
      },

      {
        id: 'project.fork',
        label: 'Fork Project',
        category: 'Project',
        execute: () => {
          usePanelsStore.getState().openPanel('forks');
        },
      },

      {
        id: 'editor.save',
        label: 'Save File',
        category: 'Editor',
        execute: () => {
          const { activeFilePath, fileContents, dirtyFiles } = useEditorStore.getState();
          if (activeFilePath && dirtyFiles.has(activeFilePath)) {
            depsRef.current.writeFile(activeFilePath, fileContents[activeFilePath]);
          }
        },
      },

      // ── Agent (Claude slash commands) ──
      buildAgentCommand('agent.clear', 'Agent: Clear Context', '/clear', sendPrompt),
      buildAgentCommand('agent.compact', 'Agent: Compact History', '/compact', sendPrompt),
      buildAgentCommand('agent.cost', 'Agent: Show Token Usage', '/cost', sendPrompt),
      buildAgentCommand('agent.help', 'Agent: Help', '/help', sendPrompt),
      buildAgentCommand('agent.init', 'Agent: Init Project', '/init', sendPrompt),
      buildAgentCommand('agent.model', 'Agent: Switch Model', '/model', sendPrompt),
      buildAgentCommand('agent.doctor', 'Agent: Doctor', '/doctor', sendPrompt),
      buildAgentCommand('agent.memory', 'Agent: Edit Memory', '/memory', sendPrompt),
      buildAgentCommand('agent.review', 'Agent: Code Review', '/review', sendPrompt),
      buildAgentCommand('agent.config', 'Agent: Settings', '/config', sendPrompt),
      buildAgentCommand('agent.context', 'Agent: Show Context', '/context', sendPrompt),
      buildAgentCommand('agent.status', 'Agent: Status', '/status', sendPrompt),
      buildAgentCommand('agent.export', 'Agent: Export Chat', '/export', sendPrompt),
      buildAgentCommand('agent.debug', 'Agent: Debug Session', '/debug', sendPrompt),
      buildAgentCommand('agent.permissions', 'Agent: Permissions', '/permissions', sendPrompt),
      buildAgentCommand('agent.plan', 'Agent: Plan Mode', '/plan', sendPrompt),
      buildAgentCommand('agent.stats', 'Agent: Usage Stats', '/stats', sendPrompt),
      buildAgentCommand('agent.todos', 'Agent: List TODOs', '/todos', sendPrompt),
      {
        id: 'agent.theme',
        label: 'Change Color Theme',
        category: 'Preferences',
        execute: () => useThemeStore.getState().cycleTheme(),
      },
    ];

    const ids = commands.map((c) => c.id);
    register(commands);
    return () => { unregister(ids); };
  }, [register, unregister, sendPrompt]);
}
