import { useEffect, useState, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useFileTreeStore } from '../stores/file-tree-store';

const POLL_INTERVAL_MS = 10_000;

export interface ProjectInfo {
  gitBranch: string | null;
  projectDir: string | null;
}

export function useProjectInfoSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const [info, setInfo] = useState<ProjectInfo>({ gitBranch: null, projectDir: null });
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const setRootPath = useFileTreeStore((s) => s.setRootPath);

  useEffect(() => {
    const ws = socketRef.current;
    if (!projectId || !ws) { setInfo({ gitBranch: null, projectDir: null }); return; }

    const onProjectInfo = (data: any) => {
      const d = data.payload as ProjectInfo;
      setInfo(d);
      if (d.projectDir) setRootPath(d.projectDir);
    };

    ws.on('project_info', onProjectInfo);

    const poll = () => { if (ws.connected) ws.send('project_info', { projectId }); };
    const onConnect = (status: string) => { if (status === 'connected') poll(); };

    if (ws.connected) poll();
    ws.onStatus(onConnect as any);
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      ws.off('project_info', onProjectInfo);
      ws.offStatus(onConnect as any);
      clearInterval(intervalRef.current);
      setInfo({ gitBranch: null, projectDir: null });
    };
  }, [projectId, socketRef, setRootPath]);

  return info;
}
