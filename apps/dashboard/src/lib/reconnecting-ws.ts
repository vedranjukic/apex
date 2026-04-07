import { useNetworkStore } from '../stores/network-store';

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
  private offlineReconnectDelay = 5000; // Longer delay when offline
  private maxOfflineReconnectDelay = 60000; // Max 1 minute when offline
  private destroyed = false;
  private pendingMessages: string[] = [];
  private networkUnsubscribe: (() => void) | null = null;

  constructor(path: string) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${proto}//${location.host}${path}`;
    
    // Subscribe to network store changes
    this.networkUnsubscribe = useNetworkStore.subscribe(
      (state, prevState) => {
        // If we went from offline to online, attempt immediate reconnection
        if (!prevState.isOnline && state.isOnline && !this.connected) {
          this.cancelReconnect();
          this.reconnectDelay = 1000; // Reset delay when coming back online
          this.connect();
        }
      }
    );
    
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;
    
    // Check network status before attempting connection
    const networkStore = useNetworkStore.getState();
    if (!networkStore.isOnline) {
      // Don't attempt connection if offline, but schedule a retry
      this.scheduleReconnect();
      return;
    }
    
    this.notifyStatus('connecting');
    networkStore.setReconnecting(true);
    
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      networkStore.incrementFailures();
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      const networkStore = useNetworkStore.getState();
      this.reconnectDelay = 1000;
      this.notifyStatus('connected');
      networkStore.setSocketConnected(true);
      networkStore.setReconnecting(false);
      networkStore.resetFailures();
      
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
      const networkStore = useNetworkStore.getState();
      this.notifyStatus('disconnected');
      networkStore.setSocketConnected(false);
      networkStore.setReconnecting(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      const networkStore = useNetworkStore.getState();
      networkStore.incrementFailures();
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    
    const networkStore = useNetworkStore.getState();
    const isOffline = !networkStore.isOnline;
    
    // Use different delays and max delays based on network status
    const delay = isOffline ? this.offlineReconnectDelay : this.reconnectDelay;
    const maxDelay = isOffline ? this.maxOfflineReconnectDelay : this.maxReconnectDelay;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    
    // Update delay for next attempt
    if (isOffline) {
      this.offlineReconnectDelay = Math.min(this.offlineReconnectDelay * 1.5, this.maxOfflineReconnectDelay);
    } else {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.cancelReconnect();
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
    this.statusHandlers.clear();
    this.pendingMessages = [];
    
    // Unsubscribe from network store
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe();
      this.networkUnsubscribe = null;
    }
    
    // Update network store
    const networkStore = useNetworkStore.getState();
    networkStore.setSocketConnected(false);
    networkStore.setReconnecting(false);
  }
}
