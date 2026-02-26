import { useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CaseSensitive,
  WholeWord,
  Regex,
  ChevronRight,
  ChevronDown,
  FileText,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { useSearchStore, type SearchResult } from '../../stores/search-store';
import { useEditorStore } from '../../stores/editor-store';

interface SearchPanelProps {
  projectId: string;
  onSearch: (
    query: string,
    options: {
      matchCase?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
      includePattern?: string;
      excludePattern?: string;
    },
  ) => void;
  readFile: (path: string) => void;
}

export function SearchPanel({ projectId, onSearch, readFile }: SearchPanelProps) {
  const query = useSearchStore((s) => s.query);
  const matchCase = useSearchStore((s) => s.matchCase);
  const wholeWord = useSearchStore((s) => s.wholeWord);
  const useRegex = useSearchStore((s) => s.useRegex);
  const includePattern = useSearchStore((s) => s.includePattern);
  const excludePattern = useSearchStore((s) => s.excludePattern);
  const results = useSearchStore((s) => s.results);
  const isSearching = useSearchStore((s) => s.isSearching);

  const setQuery = useSearchStore((s) => s.setQuery);
  const toggleMatchCase = useSearchStore((s) => s.toggleMatchCase);
  const toggleWholeWord = useSearchStore((s) => s.toggleWholeWord);
  const toggleUseRegex = useSearchStore((s) => s.toggleUseRegex);
  const setIncludePattern = useSearchStore((s) => s.setIncludePattern);
  const setExcludePattern = useSearchStore((s) => s.setExcludePattern);
  const clearResults = useSearchStore((s) => s.clearResults);
  const setIsSearching = useSearchStore((s) => s.setIsSearching);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const triggerSearch = useCallback(
    (q: string, mc: boolean, ww: boolean, re: boolean, inc: string, exc: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (q.length < 2) {
        clearResults();
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      debounceRef.current = setTimeout(() => {
        onSearch(q, {
          matchCase: mc,
          wholeWord: ww,
          useRegex: re,
          includePattern: inc || undefined,
          excludePattern: exc || undefined,
        });
      }, 150);
    },
    [onSearch, clearResults, setIsSearching],
  );

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      triggerSearch(value, matchCase, wholeWord, useRegex, includePattern, excludePattern);
    },
    [setQuery, triggerSearch, matchCase, wholeWord, useRegex, includePattern, excludePattern],
  );

  const handleToggleMatchCase = useCallback(() => {
    toggleMatchCase();
    const next = !matchCase;
    triggerSearch(query, next, wholeWord, useRegex, includePattern, excludePattern);
  }, [toggleMatchCase, matchCase, query, wholeWord, useRegex, includePattern, excludePattern, triggerSearch]);

  const handleToggleWholeWord = useCallback(() => {
    toggleWholeWord();
    const next = !wholeWord;
    triggerSearch(query, matchCase, next, useRegex, includePattern, excludePattern);
  }, [toggleWholeWord, wholeWord, query, matchCase, useRegex, includePattern, excludePattern, triggerSearch]);

  const handleToggleUseRegex = useCallback(() => {
    toggleUseRegex();
    const next = !useRegex;
    triggerSearch(query, matchCase, wholeWord, next, includePattern, excludePattern);
  }, [toggleUseRegex, useRegex, query, matchCase, wholeWord, includePattern, excludePattern, triggerSearch]);

  const handleIncludeChange = useCallback(
    (value: string) => {
      setIncludePattern(value);
      triggerSearch(query, matchCase, wholeWord, useRegex, value, excludePattern);
    },
    [setIncludePattern, triggerSearch, query, matchCase, wholeWord, useRegex, excludePattern],
  );

  const handleExcludeChange = useCallback(
    (value: string) => {
      setExcludePattern(value);
      triggerSearch(query, matchCase, wholeWord, useRegex, includePattern, value);
    },
    [setExcludePattern, triggerSearch, query, matchCase, wholeWord, useRegex, includePattern],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (query.length >= 2) {
          setIsSearching(true);
          onSearch(query, {
            matchCase,
            wholeWord,
            useRegex,
            includePattern: includePattern || undefined,
            excludePattern: excludePattern || undefined,
          });
        }
      }
    },
    [query, matchCase, wholeWord, useRegex, includePattern, excludePattern, onSearch, setIsSearching],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const totalMatches = useMemo(
    () => results.reduce((sum, r) => sum + r.matches.length, 0),
    [results],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    clearResults();
    inputRef.current?.focus();
  }, [setQuery, clearResults]);

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Search input with inline toggle icons */}
      <div className="flex items-center w-full bg-sidebar-hover rounded focus-within:ring-1 focus-within:ring-primary">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search"
          className="flex-1 min-w-0 pl-2 py-1 bg-transparent text-sm text-panel-text placeholder:text-text-muted focus:outline-none"
        />
        <div className="flex items-center shrink-0 pr-1 gap-px">
          {query && (
            <button
              onClick={handleClear}
              className="p-0.5 text-text-muted hover:text-text-secondary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ToggleButton active={matchCase} onClick={handleToggleMatchCase} title="Match Case (Alt+C)">
            <CaseSensitive className="w-4 h-4" />
          </ToggleButton>
          <ToggleButton active={wholeWord} onClick={handleToggleWholeWord} title="Match Whole Word (Alt+W)">
            <WholeWord className="w-4 h-4" />
          </ToggleButton>
          <ToggleButton active={useRegex} onClick={handleToggleUseRegex} title="Use Regular Expression (Alt+R)">
            <Regex className="w-4 h-4" />
          </ToggleButton>
        </div>
      </div>

      {/* Include/Exclude filters -- always visible */}
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          value={includePattern}
          onChange={(e) => handleIncludeChange(e.target.value)}
          placeholder="files to include (e.g. *.ts, src/)"
          className="w-full px-2 py-1 bg-sidebar-hover rounded text-xs text-panel-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          type="text"
          value={excludePattern}
          onChange={(e) => handleExcludeChange(e.target.value)}
          placeholder="files to exclude (e.g. node_modules, *.min.js)"
          className="w-full px-2 py-1 bg-sidebar-hover rounded text-xs text-panel-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Status / summary */}
      {isSearching && (
        <div className="flex items-center gap-1.5 text-xs text-panel-text-muted px-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Searching...</span>
        </div>
      )}

      {!isSearching && query.length >= 2 && results.length === 0 && (
        <p className="text-xs text-text-muted text-center py-4">No results found.</p>
      )}

      {!isSearching && results.length > 0 && (
        <div className="text-[10px] text-text-muted px-1">
          {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file
          {results.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {results.map((result) => (
          <SearchFileGroup
            key={result.filePath}
            result={result}
            query={query}
            matchCase={matchCase}
            useRegex={useRegex}
            readFile={readFile}
          />
        ))}
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-1 rounded transition-colors',
        active
          ? 'bg-primary/30 text-primary'
          : 'text-text-muted hover:text-text-secondary hover:bg-sidebar-hover',
      )}
    >
      {children}
    </button>
  );
}

function SearchFileGroup({
  result,
  query,
  matchCase,
  useRegex,
  readFile,
}: {
  result: SearchResult;
  query: string;
  matchCase: boolean;
  useRegex: boolean;
  readFile: (path: string) => void;
}) {
  const expanded = useSearchStore((s) => s.expandedFiles.has(result.filePath));
  const toggleExpanded = useSearchStore((s) => s.toggleFileExpanded);

  const fileName = result.filePath.split('/').pop() || result.filePath;
  const dirPath = result.filePath.substring(0, result.filePath.lastIndexOf('/'));

  const handleOpenFile = useCallback(
    (line?: number) => {
      const name = result.filePath.split('/').pop() || result.filePath;
      useEditorStore.getState().openFile(result.filePath, name);
      readFile(result.filePath);
    },
    [result.filePath, readFile],
  );

  return (
    <div className="mb-0.5">
      <button
        onClick={() => toggleExpanded(result.filePath)}
        className="flex items-center gap-1 w-full px-1 py-0.5 text-left hover:bg-sidebar-hover rounded group"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-panel-icon shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-panel-icon shrink-0" />
        )}
        <FileText className="w-3.5 h-3.5 text-panel-icon shrink-0" />
        <span className="text-xs text-panel-text truncate">{fileName}</span>
        <span className="text-[10px] text-text-muted truncate ml-1">{dirPath}</span>
        <span className="text-[10px] text-text-muted ml-auto shrink-0">
          {result.matches.length}
        </span>
      </button>

      {expanded && (
        <div className="ml-5">
          {result.matches.map((match, idx) => (
            <button
              key={`${match.line}-${idx}`}
              onClick={() => handleOpenFile(match.line)}
              className="flex items-start gap-1.5 w-full px-1 py-0.5 text-left hover:bg-sidebar-hover rounded"
            >
              <span className="text-[10px] text-text-muted w-7 text-right shrink-0 pt-px font-mono">
                {match.line}
              </span>
              <HighlightedContent
                content={match.content}
                query={query}
                matchCase={matchCase}
                useRegex={useRegex}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HighlightedContent({
  content,
  query,
  matchCase,
  useRegex,
}: {
  content: string;
  query: string;
  matchCase: boolean;
  useRegex: boolean;
}) {
  const parts = useMemo(() => {
    if (!query) return [{ text: content, highlight: false }];

    try {
      const pattern = useRegex ? query : escapeRegex(query);
      const flags = matchCase ? 'g' : 'gi';
      const re = new RegExp(pattern, flags);
      const result: Array<{ text: string; highlight: boolean }> = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = re.exec(content)) !== null) {
        if (match.index > lastIndex) {
          result.push({ text: content.slice(lastIndex, match.index), highlight: false });
        }
        result.push({ text: match[0], highlight: true });
        lastIndex = re.lastIndex;
        if (match[0].length === 0) {
          re.lastIndex++;
        }
      }

      if (lastIndex < content.length) {
        result.push({ text: content.slice(lastIndex), highlight: false });
      }

      return result.length > 0 ? result : [{ text: content, highlight: false }];
    } catch {
      return [{ text: content, highlight: false }];
    }
  }, [content, query, matchCase, useRegex]);

  return (
    <span className="text-xs text-panel-text-muted truncate font-mono leading-snug">
      {parts.map((part, i) =>
        part.highlight ? (
          <span key={i} className="bg-yellow-500/30 text-yellow-200 rounded-sm px-px">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
