import { Elysia } from 'elysia';

const clientSenders = new Map<string, (data: string) => void>();

export function projectsWsBroadcast(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload });
  for (const send of clientSenders.values()) {
    try { send(msg); } catch { /* ignore dead connections */ }
  }
}

export const projectsWs = new Elysia()
  .ws('/ws/projects', {
    open(ws) {
      clientSenders.set(ws.id, (data: string) => ws.send(data));
    },
    message(ws) {
      clientSenders.set(ws.id, (data: string) => ws.send(data));
    },
    close(ws) {
      clientSenders.delete(ws.id);
    },
  });
