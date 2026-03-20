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

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, []);
}
