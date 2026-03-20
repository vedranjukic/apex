import { useEffect, useCallback, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { usePortsStore, type PortInfo } from '../stores/ports-store';

export function usePortsSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const setPorts = usePortsStore((s) => s.setPorts);
  const setPreviewUrl = usePortsStore((s) => s.setPreviewUrl);
  const bindProject = usePortsStore((s) => s.bindProject);
  const resolvedRef = useRef(new Set<number>());

  useEffect(() => {
    const ws = socketRef.current;
    if (!ws || !projectId) return;

    bindProject(projectId);
    resolvedRef.current.clear();

    const resolvePreviewUrl = (port: number) => {
      if (resolvedRef.current.has(port)) return;
      resolvedRef.current.add(port);
      const handler = (data: any) => {
        const d = data.payload;
        if (d.port !== port) return;
        ws.off('port_preview_url_result', handler);
        if (!d.error && d.url) setPreviewUrl(port, d.url);
      };
      ws.on('port_preview_url_result', handler);
      ws.send('port_preview_url', { projectId, port });
      setTimeout(() => ws.off('port_preview_url_result', handler), 10_000);
    };

    const onPortsUpdate = (data: any) => {
      const ports = data.payload.ports as PortInfo[];
      setPorts(ports);
      for (const p of ports) resolvePreviewUrl(p.port);
    };

    ws.on('ports_update', onPortsUpdate);
    ws.send('get_ports', { projectId });

    const userPorts = usePortsStore.getState().userPorts;
    for (const port of userPorts) resolvePreviewUrl(port);

    return () => { ws.off('ports_update', onPortsUpdate); };
  }, [projectId, socketRef, setPorts, setPreviewUrl, bindProject]);

  const requestPreviewUrl = useCallback(
    (port: number): Promise<{ url: string; token?: string }> => {
      return new Promise((resolve, reject) => {
        const ws = socketRef.current;
        if (!ws || !projectId) { reject(new Error('Socket not connected')); return; }
        const handler = (data: any) => {
          const d = data.payload;
          if (d.port !== port) return;
          ws.off('port_preview_url_result', handler);
          if (d.error) reject(new Error(d.error));
          else { setPreviewUrl(port, d.url!); resolve({ url: d.url!, token: d.token }); }
        };
        ws.on('port_preview_url_result', handler);
        ws.send('port_preview_url', { projectId, port });
        setTimeout(() => { ws.off('port_preview_url_result', handler); reject(new Error('Preview URL request timed out')); }, 10_000);
      });
    },
    [projectId, socketRef, setPreviewUrl],
  );

  return { requestPreviewUrl };
}
