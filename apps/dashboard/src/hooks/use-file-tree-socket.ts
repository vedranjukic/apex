import { useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useFileTreeStore, type FileEntry } from '../stores/file-tree-store';
import { useEditorStore } from '../stores/editor-store';

export function useFileTreeSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
) {
  const setEntries = useFileTreeStore((s) => s.setEntries);
  const invalidate = useFileTreeStore((s) => s.invalidate);
  const reset = useFileTreeStore((s) => s.reset);
  const boundProjectId = useRef(projectId);
  boundProjectId.current = projectId;

  useEffect(() => {
    const socket = socketRef.current;
    if (!projectId || !socket) return;

    const onFileListResult = (data: {
      path: string;
      entries: FileEntry[];
      error?: string;
    }) => {
      if (data.error) {
        console.warn('[ws] file_list_result error:', data.error);
      }
      setEntries(data.path, data.entries);
    };

    const onFileOpResult = (data: {
      ok: boolean;
      op?: string;
      path?: string;
      oldPath?: string;
      newPath?: string;
      sourcePath?: string;
      destPath?: string;
      error?: string;
    }) => {
      if (!data.ok) {
        console.error('[ws] file_op_result error:', data.error);
        return;
      }
      const parentOf = (p: string) => p.substring(0, p.lastIndexOf('/')) || '/';

      if (data.op === 'create' && data.path) {
        invalidate(parentOf(data.path));
        requestListing(parentOf(data.path));
      } else if (data.op === 'delete' && data.path) {
        invalidate(parentOf(data.path));
        requestListing(parentOf(data.path));
      } else if (data.op === 'rename' && data.oldPath) {
        invalidate(parentOf(data.oldPath));
        requestListing(parentOf(data.oldPath));
      } else if (data.op === 'move' && data.sourcePath && data.destPath) {
        const srcParent = parentOf(data.sourcePath);
        const destParent = parentOf(data.destPath);
        invalidate(srcParent);
        requestListing(srcParent);
        if (destParent !== srcParent) {
          invalidate(destParent);
          requestListing(destParent);
        }
      }
    };

    const onFileChanged = (data: { dirs: string[] }) => {
      for (const dir of data.dirs) {
        invalidate(dir);
        if (socket.connected && boundProjectId.current) {
          socket.emit('file_list', { projectId: boundProjectId.current, path: dir });
        }
      }
    };

    const onFileReadResult = (data: {
      path: string;
      content: string;
      error?: string;
    }) => {
      if (data.error) {
        console.warn('[ws] file_read_result error:', data.error);
        return;
      }
      useEditorStore.getState().setFileContent(data.path, data.content);
    };

    const onFileWriteResult = (data: {
      ok: boolean;
      path: string;
      error?: string;
    }) => {
      if (!data.ok) {
        console.error('[ws] file_write_result error:', data.error);
        return;
      }
      useEditorStore.getState().markClean(data.path);
    };

    socket.on('file_list_result', onFileListResult);
    socket.on('file_op_result', onFileOpResult);
    socket.on('file_changed', onFileChanged);
    socket.on('file_read_result', onFileReadResult);
    socket.on('file_write_result', onFileWriteResult);

    return () => {
      socket.off('file_list_result', onFileListResult);
      socket.off('file_op_result', onFileOpResult);
      socket.off('file_changed', onFileChanged);
      socket.off('file_read_result', onFileReadResult);
      socket.off('file_write_result', onFileWriteResult);
      reset();
    };
  }, [projectId, socketRef, setEntries, invalidate, reset]);

  const requestListing = useCallback(
    (path: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      socket.emit('file_list', { projectId: boundProjectId.current, path });
    },
    [socketRef],
  );

  const createFile = useCallback(
    (path: string, isDirectory: boolean) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      socket.emit('file_create', { projectId: boundProjectId.current, path, isDirectory });
    },
    [socketRef],
  );

  const renameFile = useCallback(
    (oldPath: string, newPath: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      socket.emit('file_rename', { projectId: boundProjectId.current, oldPath, newPath });
    },
    [socketRef],
  );

  const deleteFile = useCallback(
    (path: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      socket.emit('file_delete', { projectId: boundProjectId.current, path });
    },
    [socketRef],
  );

  const moveFile = useCallback(
    (sourcePath: string, destPath: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      socket.emit('file_move', { projectId: boundProjectId.current, sourcePath, destPath });
    },
    [socketRef],
  );

  const readFile = useCallback(
    (path: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      socket.emit('file_read', { projectId: boundProjectId.current, path });
    },
    [socketRef],
  );

  const writeFile = useCallback(
    (path: string, content: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      socket.emit('file_write', { projectId: boundProjectId.current, path, content });
    },
    [socketRef],
  );

  return { requestListing, createFile, renameFile, deleteFile, moveFile, readFile, writeFile };
}
