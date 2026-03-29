import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { ReconnectingWebSocket } from '../../lib/reconnecting-ws';
import { registerSandboxFs } from './sandbox-fs-provider';

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
  useEffect(() => {
    if (!socket.current || !projectId) return;
    const disposable = registerSandboxFs(socket, projectId);
    return () => disposable.dispose();
  }, [socket, projectId]);

  return (
    <LspContext.Provider value={{ socketRef: socket, projectId }}>
      {children}
    </LspContext.Provider>
  );
}

export function useLspContext() {
  return useContext(LspContext);
}
