import { useEffect, useCallback, useRef } from 'react';
import type { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useSearchStore, type SearchResult } from '../stores/search-store';

const SEARCH_TIMEOUT_MS = 35_000;

export function useSearchSocket(
  projectId: string | undefined,
  socketRef: { current: ReconnectingWebSocket | null },
) {
  const setResults = useSearchStore((s) => s.setResults);
  const setIsSearching = useSearchStore((s) => s.setIsSearching);
  const boundProjectId = useRef(projectId);
  boundProjectId.current = projectId;
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const ws = socketRef.current;
    if (!projectId || !ws) return;

    const onSearchResult = (data: any) => {
      const d = data.payload;
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = undefined; }
      if (d.error) console.warn('[ws] file_search_result error:', d.error);
      setResults(d.results);
    };

    ws.on('file_search_result', onSearchResult);
    return () => {
      ws.off('file_search_result', onSearchResult);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [projectId, socketRef, setResults, setIsSearching]);

  const search = useCallback(
    (query: string, options?: { matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean; includePattern?: string; excludePattern?: string }) => {
      const ws = socketRef.current;
      if (!ws?.connected || !boundProjectId.current) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsSearching(true);
      ws.send('file_search', { projectId: boundProjectId.current, query, ...options });
      timeoutRef.current = setTimeout(() => { setIsSearching(false); }, SEARCH_TIMEOUT_MS);
    },
    [socketRef, setIsSearching],
  );

  return { search };
}
