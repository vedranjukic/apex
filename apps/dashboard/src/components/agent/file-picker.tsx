import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Folder, File, ChevronLeft, Search } from 'lucide-react';
import { useFileTreeStore, type FileEntry } from '../../stores/file-tree-store';
import { cn } from '../../lib/cn';

interface Props {
  onSelect: (path: string, isDirectory: boolean) => void;
  onClose: () => void;
  requestListing: (path: string) => void;
  anchorRect?: { top: number; left: number };
}

const MAX_SEARCH_RESULTS = 50;

export function FilePicker({ onSelect, onClose, requestListing, anchorRect }: Props) {
  const rootPath = useFileTreeStore((s) => s.rootPath);
  const cache = useFileTreeStore((s) => s.cache);
  const getAllCachedEntries = useFileTreeStore((s) => s.getAllCachedEntries);
  const [currentDir, setCurrentDir] = useState(rootPath ?? '/');
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const isSearchMode = filter.length > 0;

  useEffect(() => {
    filterRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!cache[currentDir]) {
      requestListing(currentDir);
    }
  }, [currentDir, cache, requestListing]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const browseEntries = cache[currentDir] ?? [];

  const filtered = useMemo(() => {
    if (!isSearchMode) {
      return browseEntries;
    }
    const query = filter.toLowerCase();
    const allEntries = getAllCachedEntries();
    const matches = allEntries.filter((e) =>
      e.name.toLowerCase().includes(query),
    );
    matches.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return matches.slice(0, MAX_SEARCH_RESULTS);
  }, [isSearchMode, filter, browseEntries, getAllCachedEntries]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [filter, currentDir]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const navigateUp = useCallback(() => {
    if (currentDir === rootPath || currentDir === '/') return;
    const parent = currentDir.substring(0, currentDir.lastIndexOf('/')) || '/';
    setCurrentDir(parent);
    setFilter('');
  }, [currentDir, rootPath]);

  const handleItemClick = useCallback(
    (entry: FileEntry, selectAsRef = false) => {
      if (isSearchMode) {
        onSelect(entry.path, entry.isDirectory);
      } else if (entry.isDirectory && !selectAsRef) {
        setCurrentDir(entry.path);
        setFilter('');
      } else {
        onSelect(entry.path, entry.isDirectory);
      }
    },
    [onSelect, isSearchMode],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = filtered[highlightIdx];
        if (entry) {
          handleItemClick(entry, e.shiftKey);
        }
      } else if (e.key === 'Backspace' && filter === '') {
        e.preventDefault();
        navigateUp();
      }
    },
    [onClose, filtered, highlightIdx, handleItemClick, filter, navigateUp],
  );

  const canGoUp = !isSearchMode && currentDir !== rootPath && currentDir !== '/';

  const relativePath = useCallback(
    (entry: FileEntry) => {
      if (!rootPath) return '';
      const full = entry.path;
      const rel = full.startsWith(rootPath) ? full.slice(rootPath.length) : full;
      const stripped = rel.startsWith('/') ? rel.slice(1) : rel;
      const lastSlash = stripped.lastIndexOf('/');
      return lastSlash >= 0 ? stripped.slice(0, lastSlash + 1) : '';
    },
    [rootPath],
  );

  const style: React.CSSProperties = anchorRect
    ? { position: 'fixed', bottom: `calc(100vh - ${anchorRect.top}px)`, left: anchorRect.left }
    : {};

  return (
    <div
      ref={panelRef}
      className="z-50 w-80 border border-border rounded-xl bg-surface shadow-lg overflow-hidden"
      style={style}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        {canGoUp && (
          <button
            type="button"
            onClick={navigateUp}
            className="p-0.5 rounded hover:bg-surface-secondary text-text-muted"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search files…"
          className="flex-1 text-xs bg-transparent outline-none placeholder:text-text-muted"
        />
      </div>

      <div ref={listRef} className="max-h-52 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-muted text-center">
            {isSearchMode ? 'No matches' : browseEntries.length === 0 ? 'Loading…' : 'No matches'}
          </div>
        ) : (
          filtered.map((entry, idx) => (
            <button
              key={entry.path}
              type="button"
              onClick={(e) => handleItemClick(entry, e.shiftKey)}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={cn(
                'flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-left transition-colors',
                idx === highlightIdx
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-primary hover:bg-surface-secondary',
              )}
            >
              {entry.isDirectory ? (
                <Folder className="w-3.5 h-3.5 shrink-0 text-text-muted" />
              ) : (
                <File className="w-3.5 h-3.5 shrink-0 text-text-muted" />
              )}
              <span className="truncate">{entry.name}</span>
              {isSearchMode && (
                <span className="ml-auto text-[10px] text-text-muted truncate max-w-[40%] text-right shrink-0">
                  {relativePath(entry)}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      {!isSearchMode && filtered.some((e) => e.isDirectory) && (
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-text-muted">
          <kbd className="px-1 py-0.5 rounded border border-border bg-surface-secondary text-[10px]">Shift</kbd>
          {' + '}
          <kbd className="px-1 py-0.5 rounded border border-border bg-surface-secondary text-[10px]">Enter</kbd>
          {' or '}
          <kbd className="px-1 py-0.5 rounded border border-border bg-surface-secondary text-[10px]">Shift</kbd>
          {' + Click to select folder'}
        </div>
      )}
    </div>
  );
}
