import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { ReconnectingWebSocket } from '../../lib/reconnecting-ws';

interface LspContextValue {
  socketRef: { current: ReconnectingWebSocket | null };
  projectId: string | null;
}

const LspContext = createContext<LspContextValue>({
  socketRef: { current: null },
  projectId: null,
});

export function LspProvider({
  socket,
  projectId,
  children,
}: {
  socket: { current: ReconnectingWebSocket | null };
  projectId: string;
  children: ReactNode;
}) {
  return (
    <LspContext.Provider value={{ socketRef: socket, projectId }}>
      {children}
    </LspContext.Provider>
  );
}

export function useLspContext() {
  return useContext(LspContext);
}
