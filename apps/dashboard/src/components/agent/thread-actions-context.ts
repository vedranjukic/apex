import { createContext, useContext } from 'react';

interface ThreadActions {
  fillPrompt: (text: string) => void;
  sendPrompt: (text: string) => void;
  sendSilentPrompt: (text: string, mode?: string, agentType?: string) => void;
  sendUserAnswer: (toolUseId: string, answer: string) => void;
}

export const ThreadActionsContext = createContext<ThreadActions>({
  fillPrompt: () => {},
  sendPrompt: () => {},
  sendSilentPrompt: () => {},
  sendUserAnswer: () => {},
});

export function useThreadActions() {
  return useContext(ThreadActionsContext);
}
