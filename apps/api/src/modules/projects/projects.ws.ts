import { Elysia } from 'elysia';
import type { IMergeStatusData } from '@apex/shared';

const clientSenders = new Map<string, (data: string) => void>();

// WebSocket event types for type safety
export type ProjectWebSocketEventType = 
  | 'project_created'
  | 'project_updated' 
  | 'project_deleted'
  | 'merge-status-updated'
  | 'merge-status-poll-completed'
  | 'merge-status-poll-error';

// WebSocket event payloads
export interface MergeStatusUpdatedEvent {
  projectId: string;
  mergeStatus: IMergeStatusData | null;
  timestamp: string;
}

export interface MergeStatusPollCompletedEvent {
  totalProjects: number;
  successfulUpdates: number;
  failedUpdates: number;
  timestamp: string;
}

export interface MergeStatusPollErrorEvent {
  error: string;
  timestamp: string;
}

export type ProjectWebSocketEventPayload = 
  | unknown // For existing events (project_created, project_updated, project_deleted)
  | MergeStatusUpdatedEvent
  | MergeStatusPollCompletedEvent
  | MergeStatusPollErrorEvent;

export function projectsWsBroadcast(type: ProjectWebSocketEventType, payload: ProjectWebSocketEventPayload) {
  const msg = JSON.stringify({ type, payload });
  console.log(`[projects-ws] Broadcasting ${type} to ${clientSenders.size} clients`);
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
