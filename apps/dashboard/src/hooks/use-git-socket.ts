import { useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useGitStore, type GitStatusData, type GitBranchEntry } from '../stores/git-store';

const POLL_INTERVAL_MS = 5_000;

export interface GitActions {
  requestStatus: () => void;
  stage: (paths: string[]) => void;
  unstage: (paths: string[]) => void;
  discard: (paths: string[]) => void;
  commit: (message: string, stageAll?: boolean) => void;
  push: () => void;
  pull: () => void;
  listBranches: () => void;
  createBranch: (name: string, startPoint?: string) => void;
  checkout: (ref: string) => void;
}

export function useGitSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
): GitActions {
  const setStatus = useGitStore((s) => s.setStatus);
  const setBranches = useGitStore((s) => s.setBranches);
  const setLoading = useGitStore((s) => s.setLoading);
  const reset = useGitStore((s) => s.reset);
  const boundProjectId = useRef(projectId);
  boundProjectId.current = projectId;
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const socket = socketRef.current;
    if (!projectId || !socket) return;

    const onGitStatusResult = (data: GitStatusData & { error?: string }) => {
      if (data.error) {
        console.warn('[ws] git_status_result error:', data.error);
      }
      setStatus(data);
    };

    const onGitOpResult = (data: { ok: boolean; op?: string; error?: string }) => {
      if (!data.ok) {
        console.error('[ws] git_op_result error:', data.error);
      }
      useGitStore.setState({ optimisticUntil: 0 });
      setLoading(false);
    };

    const onGitBranchesResult = (data: { branches: GitBranchEntry[]; error?: string }) => {
      if (data.error) {
        console.warn('[ws] git_branches_result error:', data.error);
      }
      setBranches(data.branches ?? []);
    };

    socket.on('git_status_result', onGitStatusResult);
    socket.on('git_op_result', onGitOpResult);
    socket.on('git_branches_result', onGitBranchesResult);

    const poll = () => {
      if (socket.connected && boundProjectId.current) {
        socket.emit('git_status', { projectId: boundProjectId.current });
      }
    };

    const onConnect = () => {
      setTimeout(poll, 1000);
    };

    if (socket.connected) {
      setTimeout(poll, 1000);
    }
    socket.on('connect', onConnect);

    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      socket.off('git_status_result', onGitStatusResult);
      socket.off('git_op_result', onGitOpResult);
      socket.off('git_branches_result', onGitBranchesResult);
      socket.off('connect', onConnect);
      clearInterval(intervalRef.current);
      reset();
    };
  }, [projectId, socketRef, setStatus, setBranches, setLoading, reset]);

  const requestStatus = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !boundProjectId.current) return;
    socket.emit('git_status', { projectId: boundProjectId.current });
  }, [socketRef]);

  const stage = useCallback(
    (paths: string[]) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      setLoading(true);
      socket.emit('git_stage', { projectId: boundProjectId.current, paths });
    },
    [socketRef, setLoading],
  );

  const unstage = useCallback(
    (paths: string[]) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      setLoading(true);
      socket.emit('git_unstage', { projectId: boundProjectId.current, paths });
    },
    [socketRef, setLoading],
  );

  const discard = useCallback(
    (paths: string[]) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      setLoading(true);
      socket.emit('git_discard', { projectId: boundProjectId.current, paths });
    },
    [socketRef, setLoading],
  );

  const commit = useCallback(
    (message: string, stageAll?: boolean) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      setLoading(true);
      socket.emit('git_commit', { projectId: boundProjectId.current, message, stageAll: !!stageAll });
    },
    [socketRef, setLoading],
  );

  const push = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !boundProjectId.current) return;
    setLoading(true);
    socket.emit('git_push', { projectId: boundProjectId.current });
  }, [socketRef, setLoading]);

  const pull = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !boundProjectId.current) return;
    setLoading(true);
    socket.emit('git_pull', { projectId: boundProjectId.current });
  }, [socketRef, setLoading]);

  const listBranches = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !boundProjectId.current) return;
    socket.emit('git_branches', { projectId: boundProjectId.current });
  }, [socketRef]);

  const createBranch = useCallback(
    (name: string, startPoint?: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      setLoading(true);
      socket.emit('git_create_branch', { projectId: boundProjectId.current, name, startPoint });
    },
    [socketRef, setLoading],
  );

  const checkout = useCallback(
    (ref: string) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;
      setLoading(true);
      socket.emit('git_checkout', { projectId: boundProjectId.current, ref });
    },
    [socketRef, setLoading],
  );

  return { requestStatus, stage, unstage, discard, commit, push, pull, listBranches, createBranch, checkout };
}
