import { createContext, useContext } from 'react';

interface ChatActions {
  fillPrompt: (text: string) => void;
  sendPrompt: (text: string) => void;
  sendUserAnswer: (toolUseId: string, answer: string) => void;
}

export const ChatActionsContext = createContext<ChatActions>({
  fillPrompt: () => {},
  sendPrompt: () => {},
  sendUserAnswer: () => {},
});

export function useChatActions() {
  return useContext(ChatActionsContext);
}
