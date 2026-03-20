import { useEffect, useCallback, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useFileTreeStore, type FileEntry } from '../stores/file-tree-store';
import { useEditorStore } from '../stores/editor-store';

const ROOT_POLL_INTERVAL_MS = 30_000;

export function useFileTreeSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const setEntries = useFileTreeStore((s) => s.setEntries);
  const invalidate = useFileTreeStore((s) => s.invalidate);
  const reset = useFileTreeStore((s) => s.reset);
  const boundProjectId = useRef(projectId);
  boundProjectId.current = projectId;

  const refreshAllCachedDirs = useCallback(() => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    const { cache, rootPath } = useFileTreeStore.getState();
    const dirs = rootPath ? [rootPath, ...Object.keys(cache)] : Object.keys(cache);
    const seen = new Set<string>();
    for (const dir of dirs) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      ws.send('file_list', { projectId: boundProjectId.current, path: dir });
    }
  }, [socketRef]);

  useEffect(() => {
    const ws = socketRef.current;
    if (!projectId || !ws) return;

    const onFileListResult = (data: any) => {
      const d = data.payload;
      if (d.error) console.warn('[ws] file_list_result error:', d.error);
      setEntries(d.path, d.entries);
    };
    const onFileOpResult = (data: any) => {
      const d = data.payload;
      if (!d.ok) { console.error('[ws] file_op_result error:', d.error); return; }
      const parentOf = (p: string) => p.substring(0, p.lastIndexOf('/')) || '/';
      if (d.op === 'create' && d.path) { invalidate(parentOf(d.path)); requestListing(parentOf(d.path)); }
      else if (d.op === 'delete' && d.path) { invalidate(parentOf(d.path)); requestListing(parentOf(d.path)); }
      else if (d.op === 'rename' && d.oldPath) { invalidate(parentOf(d.oldPath)); requestListing(parentOf(d.oldPath)); }
      else if (d.op === 'move' && d.sourcePath && d.destPath) {
        const srcParent = parentOf(d.sourcePath);
        const destParent = parentOf(d.destPath);
        invalidate(srcParent); requestListing(srcParent);
        if (destParent !== srcParent) { invalidate(destParent); requestListing(destParent); }
      }
    };
    const onFileChanged = (data: any) => {
      for (const dir of data.payload.dirs) {
        invalidate(dir);
        if (ws.connected && boundProjectId.current) ws.send('file_list', { projectId: boundProjectId.current, path: dir });
      }
    };
    const onFileReadResult = (data: any) => {
      const d = data.payload;
      if (d.error) { console.warn('[ws] file_read_result error:', d.error); return; }
      useEditorStore.getState().setFileContent(d.path, d.content);
    };
    const onFileWriteResult = (data: any) => {
      const d = data.payload;
      if (!d.ok) { console.error('[ws] file_write_result error:', d.error); return; }
      useEditorStore.getState().markClean(d.path);
    };
    const onReconnect = (status: string) => { if (status === 'connected') refreshAllCachedDirs(); };

    ws.on('file_list_result', onFileListResult);
    ws.on('file_op_result', onFileOpResult);
    ws.on('file_changed', onFileChanged);
    ws.on('file_read_result', onFileReadResult);
    ws.on('file_write_result', onFileWriteResult);
    ws.onStatus(onReconnect as any);

    return () => {
      ws.off('file_list_result', onFileListResult);
      ws.off('file_op_result', onFileOpResult);
      ws.off('file_changed', onFileChanged);
      ws.off('file_read_result', onFileReadResult);
      ws.off('file_write_result', onFileWriteResult);
      ws.offStatus(onReconnect as any);
      reset();
    };
  }, [projectId, socketRef, setEntries, invalidate, reset, refreshAllCachedDirs]);

  const requestListing = useCallback(
    (path: string) => {
      const ws = socketRef.current;
      if (!ws?.connected || !boundProjectId.current) return;
      ws.send('file_list', { projectId: boundProjectId.current, path });
    }, [socketRef],
  );
  const createFile = useCallback((path: string, isDirectory: boolean) => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    ws.send('file_create', { projectId: boundProjectId.current, path, isDirectory });
  }, [socketRef]);
  const renameFile = useCallback((oldPath: string, newPath: string) => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    ws.send('file_rename', { projectId: boundProjectId.current, oldPath, newPath });
  }, [socketRef]);
  const deleteFile = useCallback((path: string) => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    ws.send('file_delete', { projectId: boundProjectId.current, path });
  }, [socketRef]);
  const moveFile = useCallback((sourcePath: string, destPath: string) => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    ws.send('file_move', { projectId: boundProjectId.current, sourcePath, destPath });
  }, [socketRef]);
  const readFile = useCallback((path: string) => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    ws.send('file_read', { projectId: boundProjectId.current, path });
  }, [socketRef]);
  const writeFile = useCallback((path: string, content: string) => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    ws.send('file_write', { projectId: boundProjectId.current, path, content });
  }, [socketRef]);
  const refreshAll = useCallback(() => {
    const ws = socketRef.current;
    if (!ws?.connected || !boundProjectId.current) return;
    const { cache, rootPath } = useFileTreeStore.getState();
    const dirs = rootPath ? [rootPath, ...Object.keys(cache)] : Object.keys(cache);
    const seen = new Set<string>();
    for (const dir of dirs) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      invalidate(dir);
      ws.send('file_list', { projectId: boundProjectId.current, path: dir });
    }
  }, [socketRef, invalidate]);

  useEffect(() => {
    const id = setInterval(() => refreshAllCachedDirs(), ROOT_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshAllCachedDirs]);

  return { requestListing, createFile, renameFile, deleteFile, moveFile, readFile, writeFile, refreshAll };
}
