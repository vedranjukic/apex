import { createContext, useContext } from 'react';

interface ChatActions {
  fillPrompt: (text: string) => void;
  sendPrompt: (text: string) => void;
}

export const ChatActionsContext = createContext<ChatActions>({
  fillPrompt: () => {},
  sendPrompt: () => {},
});

export function useChatActions() {
  return useContext(ChatActionsContext);
}
