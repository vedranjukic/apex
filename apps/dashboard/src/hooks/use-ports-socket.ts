import { useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { usePortsStore, type PortInfo } from '../stores/ports-store';

export function usePortsSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
) {
  const setPorts = usePortsStore((s) => s.setPorts);
  const setPreviewUrl = usePortsStore((s) => s.setPreviewUrl);
  const reset = usePortsStore((s) => s.reset);
  const resolvedRef = useRef(new Set<number>());

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId) return;

    reset();
    resolvedRef.current.clear();

    const resolvePreviewUrl = (port: number) => {
      if (resolvedRef.current.has(port)) return;
      resolvedRef.current.add(port);

      const handler = (data: { port: number; url?: string; token?: string; error?: string }) => {
        if (data.port !== port) return;
        socket.off('port_preview_url_result', handler);
        if (!data.error && data.url) {
          setPreviewUrl(port, data.url);
        }
      };

      socket.on('port_preview_url_result', handler);
      socket.emit('port_preview_url', { projectId, port });

      setTimeout(() => {
        socket.off('port_preview_url_result', handler);
      }, 10_000);
    };

    const onPortsUpdate = (data: { ports: PortInfo[] }) => {
      setPorts(data.ports);
      for (const p of data.ports) {
        resolvePreviewUrl(p.port);
      }
    };

    socket.on('ports_update', onPortsUpdate);
    socket.emit('get_ports', { projectId });

    const userPorts = usePortsStore.getState().userPorts;
    for (const port of userPorts) {
      resolvePreviewUrl(port);
    }

    return () => {
      socket.off('ports_update', onPortsUpdate);
    };
  }, [projectId, socketRef, setPorts, setPreviewUrl, reset]);

  const requestPreviewUrl = useCallback(
    (port: number): Promise<{ url: string; token?: string }> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !projectId) {
          reject(new Error('Socket not connected'));
          return;
        }

        const handler = (data: { port: number; url?: string; token?: string; error?: string }) => {
          if (data.port !== port) return;
          socket.off('port_preview_url_result', handler);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            setPreviewUrl(port, data.url!);
            resolve({ url: data.url!, token: data.token });
          }
        };

        socket.on('port_preview_url_result', handler);
        socket.emit('port_preview_url', { projectId, port });

        setTimeout(() => {
          socket.off('port_preview_url_result', handler);
          reject(new Error('Preview URL request timed out'));
        }, 10_000);
      });
    },
    [projectId, socketRef, setPreviewUrl],
  );

  return { requestPreviewUrl };
}
