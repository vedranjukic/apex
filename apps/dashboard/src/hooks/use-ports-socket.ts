import { useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { usePortsStore, type PortInfo } from '../stores/ports-store';

export function usePortsSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
) {
  const setPorts = usePortsStore((s) => s.setPorts);
  const reset = usePortsStore((s) => s.reset);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId) return;

    reset();

    const onPortsUpdate = (data: { ports: PortInfo[] }) => {
      setPorts(data.ports);
    };

    socket.on('ports_update', onPortsUpdate);

    return () => {
      socket.off('ports_update', onPortsUpdate);
    };
  }, [projectId, socketRef, setPorts, reset]);

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
    [projectId, socketRef],
  );

  return { requestPreviewUrl };
}
