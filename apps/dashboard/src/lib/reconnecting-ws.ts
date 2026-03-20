type MessageHandler = (data: { type: string; payload: any }) => void;
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void;

export class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers = new Map<string, Set<MessageHandler>>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private destroyed = false;
  private pendingMessages: string[] = [];

  constructor(path: string) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${proto}//${location.host}${path}`;
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;
    this.notifyStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.notifyStatus('connected');
      for (const msg of this.pendingMessages) {
        this.ws?.send(msg);
      }
      this.pendingMessages = [];
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const typeHandlers = this.handlers.get(data.type);
        if (typeHandlers) {
          for (const handler of typeHandlers) handler(data);
        }
        const allHandlers = this.handlers.get('*');
        if (allHandlers) {
          for (const handler of allHandlers) handler(data);
        }
      } catch { /* ignore malformed messages */ }
    };

    this.ws.onclose = () => {
      this.notifyStatus('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private notifyStatus(status: 'connecting' | 'connected' | 'disconnected') {
    for (const handler of this.statusHandlers) handler(status);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(type: string, payload: unknown) {
    const msg = JSON.stringify({ type, payload });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pendingMessages.push(msg);
    }
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  off(type: string, handler: MessageHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
  }

  offStatus(handler: StatusHandler) {
    this.statusHandlers.delete(handler);
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
    this.statusHandlers.clear();
    this.pendingMessages = [];
  }
}
