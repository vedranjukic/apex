import { useEffect, useState, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useFileTreeStore } from '../stores/file-tree-store';

/** Polling interval for project info (ms) */
const POLL_INTERVAL_MS = 10_000;

export interface ProjectInfo {
  gitBranch: string | null;
  projectDir: string | null;
}

/**
 * Hook that polls the sandbox for project-level info (e.g. current git branch).
 * Shares the Socket.io connection from useAgentSocket.
 */
export function useProjectInfoSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
) {
  const [info, setInfo] = useState<ProjectInfo>({ gitBranch: null, projectDir: null });
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const setRootPath = useFileTreeStore((s) => s.setRootPath);

  useEffect(() => {
    const socket = socketRef.current;
    if (!projectId || !socket) {
      setInfo({ gitBranch: null, projectDir: null });
      return;
    }

    const onProjectInfo = (data: ProjectInfo) => {
      setInfo(data);
      if (data.projectDir) {
        setRootPath(data.projectDir);
      }
    };

    socket.on('project_info', onProjectInfo);

    const poll = () => {
      if (socket.connected) {
        socket.emit('project_info', { projectId });
      }
    };

    const onConnect = () => {
      poll();
    };

    if (socket.connected) {
      poll();
    }
    socket.on('connect', onConnect);

    // Periodic polling
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      socket.off('project_info', onProjectInfo);
      socket.off('connect', onConnect);
      clearInterval(intervalRef.current);
      setInfo({ gitBranch: null, projectDir: null });
    };
  }, [projectId, socketRef, setRootPath]);

  return info;
}
