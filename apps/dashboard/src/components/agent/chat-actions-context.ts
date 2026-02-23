import { createContext, useContext } from 'react';

interface ChatActions {
  fillPrompt: (text: string) => void;
  sendPrompt: (text: string) => void;
  sendSilentPrompt: (text: string, mode?: string) => void;
  sendUserAnswer: (toolUseId: string, answer: string) => void;
}

export const ChatActionsContext = createContext<ChatActions>({
  fillPrompt: () => {},
  sendPrompt: () => {},
  sendSilentPrompt: () => {},
  sendUserAnswer: () => {},
});

export function useChatActions() {
  return useContext(ChatActionsContext);
}
