import { useEffect, useRef } from 'react';
import { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useProjectsStore } from '../stores/projects-store';
import type { Project } from '../api/client';

export function useProjectsSocket() {
  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  useEffect(() => {
    const ws = new ReconnectingWebSocket('/ws/projects');
    wsRef.current = ws;

    ws.on('project_created', (data) => {
      const project = data.payload as Project;
      const { projects } = useProjectsStore.getState();
      if (!projects.some((p) => p.id === project.id)) {
        useProjectsStore.setState({ projects: [project, ...projects] });
      }
    });

    ws.on('project_updated', (data) => {
      const project = data.payload as Project;
      const { projects } = useProjectsStore.getState();
      useProjectsStore.setState({
        projects: projects.map((p) => (p.id === project.id ? project : p)),
      });
    });

    ws.on('project_deleted', (data) => {
      const { id } = data.payload as { id: string };
      const { projects } = useProjectsStore.getState();
      useProjectsStore.setState({
        projects: projects.filter((p) => p.id !== id),
      });
    });

    // Handle merge status update events
    ws.on('merge-status-updated', (data) => {
      const { projectId, mergeStatus } = data.payload as {
        projectId: string;
        mergeStatus: any;
        timestamp: string;
      };
      const { projects } = useProjectsStore.getState();
      useProjectsStore.setState({
        projects: projects.map((p) => 
          p.id === projectId ? { ...p, mergeStatus } : p
        ),
      });
      console.log(`[projects-ws] Merge status updated for project ${projectId}`);
    });

    // Handle polling completion events
    ws.on('merge-status-poll-completed', (data) => {
      const { totalProjects, successfulUpdates, failedUpdates } = data.payload as {
        totalProjects: number;
        successfulUpdates: number;
        failedUpdates: number;
        timestamp: string;
      };
      console.log(`[projects-ws] Merge status poll completed: ${successfulUpdates}/${totalProjects} successful`);
      
      // You could show a toast notification here or update some global state
    });

    // Handle polling error events
    ws.on('merge-status-poll-error', (data) => {
      const { error } = data.payload as {
        error: string;
        timestamp: string;
      };
      console.error(`[projects-ws] Merge status polling error: ${error}`);
      
      // You could show an error notification here
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, []);
}
