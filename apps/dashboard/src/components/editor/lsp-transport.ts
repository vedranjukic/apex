import {
  AbstractMessageReader,
  AbstractMessageWriter,
  type DataCallback,
  type Disposable,
  type Message,
  type MessageTransports,
} from 'vscode-languageserver-protocol/browser.js';
import type { ReconnectingWebSocket } from '../../lib/reconnecting-ws';
import { useLspStore } from '../../stores/lsp-store';

type LspResponseHandler = (data: { type: string; payload: { language: string; jsonrpc: any } }) => void;

const lspReadyDetected = new Set<string>();

/**
 * Minimal WebSocket stub that satisfies LanguageClientWrapper's readyState
 * check. All actual communication goes through the custom MessageTransports.
 */
export function createStubWebSocket(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send() {},
    close() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    url: '',
    protocol: '',
    extensions: '',
    bufferedAmount: 0,
    binaryType: 'blob' as BinaryType,
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  } as unknown as WebSocket;
}

function normalizeLspLang(lang: string): string {
  if (lang === 'typescriptreact') return 'typescript';
  if (lang === 'javascriptreact') return 'javascript';
  return lang;
}

class SocketIoMessageReader extends AbstractMessageReader {
  private callback: DataCallback | null = null;
  private socketHandler: LspResponseHandler | null = null;
  private normalizedLang: string;

  constructor(
    private socket: ReconnectingWebSocket,
    private language: string,
  ) {
    super();
    this.normalizedLang = normalizeLspLang(language);
  }

  listen(callback: DataCallback): Disposable {
    this.callback = callback;

    this.socketHandler = (data) => {
      const respLang = normalizeLspLang(data.payload?.language ?? '');
      if (respLang !== this.normalizedLang) return;
      const msg = data.payload.jsonrpc;
      if (msg && this.callback) {
        if (!lspReadyDetected.has(this.normalizedLang) && msg.result?.capabilities) {
          lspReadyDetected.add(this.normalizedLang);
          useLspStore.getState().setStatus(this.normalizedLang, 'ready');
        }
        this.callback(msg as Message);
      }
    };

    this.socket.on('lsp_response', this.socketHandler);

    return {
      dispose: () => {
        if (this.socketHandler) {
          this.socket.off('lsp_response', this.socketHandler);
          this.socketHandler = null;
        }
        this.callback = null;
      },
    };
  }
}

class SocketIoMessageWriter extends AbstractMessageWriter {
  constructor(
    private socket: ReconnectingWebSocket,
    private projectId: string,
    private language: string,
  ) {
    super();
  }

  async write(msg: Message): Promise<void> {
    if ((msg as any).method === 'initialize') {
      const lang = normalizeLspLang(this.language);
      if (!lspReadyDetected.has(lang)) {
        useLspStore.getState().setStatus(lang, 'starting');
      }
    }
    this.socket.send('lsp_data', {
      projectId: this.projectId,
      language: this.language,
      jsonrpc: msg,
    });
  }

  end(): void {}
}

export function createSocketIoTransports(
  socket: ReconnectingWebSocket,
  projectId: string,
  language: string,
): MessageTransports {
  return {
    reader: new SocketIoMessageReader(socket, language),
    writer: new SocketIoMessageWriter(socket, projectId, language),
  };
}
