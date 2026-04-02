import { useEffect, useCallback, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { usePortsStore, type PortInfo, type PortRelay } from '../stores/ports-store';
import { useSettingsStore } from '../stores/settings-store';

export function usePortsSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const setPorts = usePortsStore((s) => s.setPorts);
  const setPreviewUrl = usePortsStore((s) => s.setPreviewUrl);
  const bindProject = usePortsStore((s) => s.bindProject);
  const setPortRelay = usePortsStore((s) => s.setPortRelay);
  const updatePortRelays = usePortsStore((s) => s.updatePortRelays);
  const setAutoForwardEnabled = useSettingsStore((s) => s.setAutoForwardEnabled);
  const resolvedRef = useRef(new Set<number>());

  useEffect(() => {
    if (!projectId) return;
    bindProject(projectId);
    resolvedRef.current.clear();

    const ws = socketRef.current;
    if (!ws) return;

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

    const onPortForwardsUpdate = (data: any) => {
      const { forwards, autoForwardEnabled } = data.payload;
      if (forwards) {
        const relays: PortRelay[] = forwards.map((f: any) => ({
          remotePort: f.remotePort,
          localPort: f.localPort,
          status: f.status === 'active' ? 'forwarding' as const : 
                 f.status === 'stopped' ? 'stopped' as const : 'failed' as const,
          localhostUrl: `localhost:${f.localPort}`,
          error: f.error,
        }));
        updatePortRelays(relays);
      }
      if (autoForwardEnabled !== undefined) {
        setAutoForwardEnabled(autoForwardEnabled);
      }
    };

    const onAutoForwardStatusChanged = (data: any) => {
      const { autoForwardEnabled } = data.payload;
      if (autoForwardEnabled !== undefined) {
        setAutoForwardEnabled(autoForwardEnabled);
      }
    };

    ws.on('ports_update', onPortsUpdate);
    ws.on('port_forwards_updated', onPortForwardsUpdate);
    ws.on('auto_forward_status_changed', onAutoForwardStatusChanged);
    ws.send('get_ports', { projectId });

    const userPorts = usePortsStore.getState().userPorts;
    for (const port of userPorts) resolvePreviewUrl(port);

    return () => { 
      ws.off('ports_update', onPortsUpdate);
      ws.off('port_forwards_updated', onPortForwardsUpdate);
      ws.off('auto_forward_status_changed', onAutoForwardStatusChanged);
    };
  }, [projectId, socketRef, setPorts, setPreviewUrl, bindProject, updatePortRelays, setAutoForwardEnabled]);

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

  const forwardPort = useCallback(
    (port: number): Promise<{ localPort: number; url: string }> => {
      return new Promise((resolve, reject) => {
        const ws = socketRef.current;
        if (!ws || !projectId) { reject(new Error('Socket not connected')); return; }
        const handler = (data: any) => {
          const d = data.payload;
          if (d.port !== port) return;
          ws.off('forward_port_result', handler);
          if (d.error) reject(new Error(d.error));
          else {
            setPreviewUrl(port, d.url);
            resolve({ localPort: d.localPort, url: d.url });
          }
        };
        ws.on('forward_port_result', handler);
        ws.send('forward_port', { projectId, port });
        setTimeout(() => { ws.off('forward_port_result', handler); reject(new Error('Port forward timed out')); }, 15_000);
      });
    },
    [projectId, socketRef, setPreviewUrl],
  );

  const enableAutoForward = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve, reject) => {
      const ws = socketRef.current;
      if (!ws || !projectId) { 
        reject(new Error('Socket not connected')); 
        return; 
      }
      
      const handler = (data: any) => {
        const d = data.payload;
        if (d.projectId !== projectId) return;
        ws.off('auto_forward_ports_result', handler);
        if (d.error) {
          reject(new Error(d.error));
        } else {
          resolve({ success: d.success });
        }
      };
      
      ws.on('auto_forward_ports_result', handler);
      ws.send('auto_forward_ports', { projectId, enabled: true });
      setTimeout(() => {
        ws.off('auto_forward_ports_result', handler);
        reject(new Error('Auto-forward enable timed out'));
      }, 10_000);
    });
  }, [projectId, socketRef]);

  const disableAutoForward = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve, reject) => {
      const ws = socketRef.current;
      if (!ws || !projectId) { 
        reject(new Error('Socket not connected')); 
        return; 
      }
      
      const handler = (data: any) => {
        const d = data.payload;
        if (d.projectId !== projectId) return;
        ws.off('auto_forward_ports_result', handler);
        if (d.error) {
          reject(new Error(d.error));
        } else {
          resolve({ success: d.success });
        }
      };
      
      ws.on('auto_forward_ports_result', handler);
      ws.send('auto_forward_ports', { projectId, enabled: false });
      setTimeout(() => {
        ws.off('auto_forward_ports_result', handler);
        reject(new Error('Auto-forward disable timed out'));
      }, 10_000);
    });
  }, [projectId, socketRef]);

  const togglePortRelay = useCallback((port: number, enabled: boolean): Promise<{ success: boolean; localPort?: number; error?: string }> => {
    return new Promise((resolve, reject) => {
      const ws = socketRef.current;
      if (!ws || !projectId) { 
        reject(new Error('Socket not connected')); 
        return; 
      }
      
      const handler = (data: any) => {
        const d = data.payload;
        if (d.remotePort !== port) return;
        ws.off('set_port_relay_result', handler);
        if (d.error) {
          reject(new Error(d.error));
        } else {
          resolve({ 
            success: d.success, 
            localPort: d.localPort 
          });
        }
      };
      
      ws.on('set_port_relay_result', handler);
      ws.send('set_port_relay', { 
        projectId, 
        action: enabled ? 'forward' : 'unforward',
        remotePort: port 
      });
      setTimeout(() => {
        ws.off('set_port_relay_result', handler);
        reject(new Error('Port relay command timed out'));
      }, 15_000);
    });
  }, [projectId, socketRef]);

  return { 
    requestPreviewUrl, 
    forwardPort, 
    enableAutoForward, 
    disableAutoForward, 
    togglePortRelay 
  };
}
