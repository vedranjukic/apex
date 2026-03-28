import type { ReconnectingWebSocket } from '../../lib/reconnecting-ws';

let nextRequestId = 90000;

type LspResponsePayload = {
  type: string;
  payload: { language: string; jsonrpc: { id?: number; result?: unknown; error?: unknown } };
};

function normalizeLspLang(lang: string): string {
  if (lang === 'typescriptreact') return 'typescript';
  if (lang === 'javascriptreact') return 'javascript';
  return lang;
}

/**
 * Send a one-shot LSP request through Socket.io and return the result.
 * Bypasses monaco-languageclient — used for "Find All References" etc.
 * where we need the raw Location[] to display in the sidebar panel.
 */
export function sendLspRequest(
  socket: ReconnectingWebSocket,
  projectId: string,
  language: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  const id = nextRequestId++;
  const normalized = normalizeLspLang(language);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('lsp_response', handler);
      reject(new Error(`LSP request '${method}' timed out after 15s`));
    }, 15000);

    const handler = (data: LspResponsePayload) => {
      const respLang = normalizeLspLang(data.payload?.language ?? '');
      if (respLang !== normalized) return;
      const jsonrpc = data.payload?.jsonrpc;
      if (!jsonrpc || jsonrpc.id !== id) return;

      socket.off('lsp_response', handler);
      clearTimeout(timeout);

      if (jsonrpc.error) {
        reject(new Error(String((jsonrpc.error as any).message ?? jsonrpc.error)));
      } else {
        resolve(jsonrpc.result);
      }
    };

    socket.on('lsp_response', handler);

    socket.send('lsp_data', {
      projectId,
      language,
      jsonrpc: { jsonrpc: '2.0', id, method, params },
    });
  });
}
