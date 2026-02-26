import { useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useSearchStore, type SearchResult } from '../stores/search-store';

const SEARCH_TIMEOUT_MS = 35_000;

export function useSearchSocket(
  projectId: string | undefined,
  socketRef: { current: Socket | null },
) {
  const setResults = useSearchStore((s) => s.setResults);
  const setIsSearching = useSearchStore((s) => s.setIsSearching);
  const boundProjectId = useRef(projectId);
  boundProjectId.current = projectId;
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const socket = socketRef.current;
    if (!projectId || !socket) return;

    const onSearchResult = (data: {
      query: string;
      results: SearchResult[];
      error?: string;
    }) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
      if (data.error) {
        console.warn('[ws] file_search_result error:', data.error);
      }
      setResults(data.results);
    };

    socket.on('file_search_result', onSearchResult);

    return () => {
      socket.off('file_search_result', onSearchResult);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [projectId, socketRef, setResults, setIsSearching]);

  const search = useCallback(
    (
      query: string,
      options?: {
        matchCase?: boolean;
        wholeWord?: boolean;
        useRegex?: boolean;
        includePattern?: string;
        excludePattern?: string;
      },
    ) => {
      const socket = socketRef.current;
      if (!socket?.connected || !boundProjectId.current) return;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      setIsSearching(true);
      socket.emit('file_search', {
        projectId: boundProjectId.current,
        query,
        ...options,
      });

      timeoutRef.current = setTimeout(() => {
        console.warn('[ws] file_search timed out');
        setIsSearching(false);
      }, SEARCH_TIMEOUT_MS);
    },
    [socketRef, setIsSearching],
  );

  return { search };
}
