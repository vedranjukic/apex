import { useEffect, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useLspStore } from '../stores/lsp-store';
import type { LspServerStatus } from '../stores/lsp-store';

export function useLspSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const setStatus = useLspStore((s) => s.setStatus);
  const reset = useLspStore((s) => s.reset);
  const boundProjectId = useRef(projectId);
  boundProjectId.current = projectId;

  useEffect(() => {
    const ws = socketRef.current;
    if (!projectId || !ws) return;

    const onLspStatus = (data: { payload: { language: string; status: LspServerStatus; error?: string } }) => {
      const { language, status, error } = data.payload;
      setStatus(language, status, error);
    };

    const onLspResponse = (_data: { payload: { language: string; jsonrpc: unknown } }) => {
      // LSP JSON-RPC responses are handled by the language client transport,
      // not consumed directly here. This listener is a placeholder for future
      // direct response handling if needed.
    };

    ws.on('lsp_status', onLspStatus);
    ws.on('lsp_response', onLspResponse);

    return () => {
      ws.off('lsp_status', onLspStatus);
      ws.off('lsp_response', onLspResponse);
      reset();
    };
  }, [projectId, socketRef, setStatus, reset]);

  return {
    sendLspData: (language: string, jsonrpc: Record<string, unknown>) => {
      const ws = socketRef.current;
      if (!ws?.connected || !boundProjectId.current) return;
      ws.send('lsp_data', {
        projectId: boundProjectId.current,
        language,
        jsonrpc,
      });
    },
  };
}
