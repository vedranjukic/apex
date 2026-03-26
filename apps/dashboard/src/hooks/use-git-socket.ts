import { useEffect, useCallback, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useGitStore, type GitStatusData, type GitBranchEntry } from '../stores/git-store';
import { useEditorStore } from '../stores/editor-store';

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
  requestDiff: (path: string, staged: boolean) => void;
}

export function useGitSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
): GitActions {
  const setStatus = useGitStore((s) => s.setStatus);
  const setBranches = useGitStore((s) => s.setBranches);
  const setLoading = useGitStore((s) => s.setLoading);
  const reset = useGitStore((s) => s.reset);
  const boundProjectId = useRef(projectId);
  boundProjectId.current = projectId;
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const ws = socketRef.current;
    if (!projectId || !ws) return;

    const onGitStatusResult = (data: any) => {
      const d = data.payload;
      if (d.error) console.warn('[ws] git_status_result error:', d.error);
      setStatus(d);
    };
    const onGitOpResult = (data: any) => {
      const d = data.payload;
      if (!d.ok) console.error('[ws] git_op_result error:', d.error);
      useGitStore.setState({ optimisticUntil: 0 });
      setLoading(false);
    };
    const onGitBranchesResult = (data: any) => {
      const d = data.payload;
      if (d.error) console.warn('[ws] git_branches_result error:', d.error);
      setBranches(d.branches ?? []);
    };

    const onGitDiffResult = (data: any) => {
      const d = data.payload;
      if (d.error) { console.warn('[ws] git_diff_result error:', d.error); return; }
      useEditorStore.getState().setDiffContent(d.path, d.original ?? '', d.modified ?? '');
    };

    ws.on('git_status_result', onGitStatusResult);
    ws.on('git_op_result', onGitOpResult);
    ws.on('git_branches_result', onGitBranchesResult);
    ws.on('git_diff_result', onGitDiffResult);

    const poll = () => { if (ws.connected && boundProjectId.current) ws.send('git_status', { projectId: boundProjectId.current }); };
    const onConnect = (status: string) => { if (status === 'connected') setTimeout(poll, 1000); };
    if (ws.connected) setTimeout(poll, 1000);
    ws.onStatus(onConnect as any);
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      ws.off('git_status_result', onGitStatusResult);
      ws.off('git_op_result', onGitOpResult);
      ws.off('git_branches_result', onGitBranchesResult);
      ws.off('git_diff_result', onGitDiffResult);
      ws.offStatus(onConnect as any);
      clearInterval(intervalRef.current);
      reset();
    };
  }, [projectId, socketRef, setStatus, setBranches, setLoading, reset]);

  const requestStatus = useCallback(() => { if (socketRef.current?.connected && boundProjectId.current) socketRef.current.send('git_status', { projectId: boundProjectId.current }); }, [socketRef]);
  const stage = useCallback((paths: string[]) => { setLoading(true); socketRef.current?.send('git_stage', { projectId: boundProjectId.current, paths }); }, [socketRef, setLoading]);
  const unstage = useCallback((paths: string[]) => { setLoading(true); socketRef.current?.send('git_unstage', { projectId: boundProjectId.current, paths }); }, [socketRef, setLoading]);
  const discard = useCallback((paths: string[]) => { setLoading(true); socketRef.current?.send('git_discard', { projectId: boundProjectId.current, paths }); }, [socketRef, setLoading]);
  const commit = useCallback((message: string, stageAll?: boolean) => { setLoading(true); socketRef.current?.send('git_commit', { projectId: boundProjectId.current, message, stageAll: !!stageAll }); }, [socketRef, setLoading]);
  const push = useCallback(() => { setLoading(true); socketRef.current?.send('git_push', { projectId: boundProjectId.current }); }, [socketRef, setLoading]);
  const pull = useCallback(() => { setLoading(true); socketRef.current?.send('git_pull', { projectId: boundProjectId.current }); }, [socketRef, setLoading]);
  const listBranches = useCallback(() => { socketRef.current?.send('git_branches', { projectId: boundProjectId.current }); }, [socketRef]);
  const createBranch = useCallback((name: string, startPoint?: string) => { setLoading(true); socketRef.current?.send('git_create_branch', { projectId: boundProjectId.current, name, startPoint }); }, [socketRef, setLoading]);
  const checkout = useCallback((ref: string) => { setLoading(true); socketRef.current?.send('git_checkout', { projectId: boundProjectId.current, ref }); }, [socketRef, setLoading]);
  const requestDiff = useCallback((path: string, staged: boolean) => {
    useEditorStore.getState().openDiff(path, staged);
    socketRef.current?.send('git_diff', { projectId: boundProjectId.current, path, staged });
  }, [socketRef]);

  return { requestStatus, stage, unstage, discard, commit, push, pull, listBranches, createBranch, checkout, requestDiff };
}
