import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useProjectsStore } from '../stores/projects-store';
import type { Project } from '../api/client';

/**
 * Connects to the /ws/projects namespace and keeps the Zustand
 * projects store in sync with server-side changes in real time.
 */
export function useProjectsSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io('/ws/projects', {
      path: '/ws/socket.io',
      transports: ['polling', 'websocket'],
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on('project_created', (project: Project) => {
      const { projects } = useProjectsStore.getState();
      if (!projects.some((p) => p.id === project.id)) {
        useProjectsStore.setState({ projects: [project, ...projects] });
      }
    });

    socket.on('project_updated', (project: Project) => {
      const { projects } = useProjectsStore.getState();
      useProjectsStore.setState({
        projects: projects.map((p) => (p.id === project.id ? project : p)),
      });
    });

    socket.on('project_deleted', ({ id }: { id: string }) => {
      const { projects } = useProjectsStore.getState();
      useProjectsStore.setState({
        projects: projects.filter((p) => p.id !== id),
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);
}
