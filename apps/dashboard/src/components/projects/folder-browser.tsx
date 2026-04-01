import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import { X, Folder, ChevronRight, Home, ArrowUp, Loader2, FolderPlus } from 'lucide-react';
import { cn } from '../../lib/cn';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResult {
  path: string;
  home: string;
  entries: DirEntry[];
  error?: string;
}

interface Props {
  open: boolean;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

async function fetchDir(dirPath: string): Promise<BrowseResult> {
  const res = await fetch(`/api/fs/browse?path=${encodeURIComponent(dirPath)}`);
  return res.json();
}

export function FolderBrowser({ open, initialPath, onSelect, onClose }: Props) {
  const [currentPath, setCurrentPath] = useState('');
  const [homePath, setHomePath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const navigate = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const result = await fetchDir(dirPath);
      setCurrentPath(result.path);
      setHomePath(result.home);
      setPathInput(result.path);
      setEntries(result.entries);
      if (result.error) setError(result.error);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      navigate(initialPath || '~');
    }
  }, [open, initialPath, navigate]);

  if (!open) return null;

  const pathSegments = currentPath.split('/').filter(Boolean);

  const goUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    navigate(parent);
  };

  const goHome = () => navigate(homePath || '~');

  const handlePathSubmit = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && pathInput.trim()) {
      navigate(pathInput.trim());
    }
  };

  const handleSelect = () => {
    onSelect(selected || currentPath);
    onClose();
  };

  const handleDoubleClick = (entry: DirEntry) => {
    navigate(entry.path);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-lg flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Select Folder</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
          <button
            onClick={goHome}
            className="p-1.5 rounded hover:bg-surface-secondary text-text-muted hover:text-text-primary"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            onClick={goUp}
            className="p-1.5 rounded hover:bg-surface-secondary text-text-muted hover:text-text-primary"
            title="Parent folder"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={handlePathSubmit}
            className="flex-1 px-2 py-1 text-xs font-mono border border-border rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="/path/to/folder"
          />
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-0.5 px-3 py-1.5 text-xs text-text-muted overflow-x-auto">
          <button onClick={() => navigate('/')} className="hover:text-text-primary shrink-0">/</button>
          {pathSegments.map((seg, i) => {
            const fullPath = '/' + pathSegments.slice(0, i + 1).join('/');
            return (
              <span key={fullPath} className="flex items-center gap-0.5 shrink-0">
                <ChevronRight className="w-3 h-3" />
                <button onClick={() => navigate(fullPath)} className="hover:text-text-primary">
                  {seg}
                </button>
              </span>
            );
          })}
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto px-1 py-1 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-full text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-text-muted text-xs px-4 text-center">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs gap-1">
              <FolderPlus className="w-5 h-5" />
              <span>No subfolders</span>
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => setSelected(entry.path === selected ? null : entry.path)}
                onDoubleClick={() => handleDoubleClick(entry)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors',
                  entry.path === selected
                    ? 'bg-primary/15 text-text-primary'
                    : 'hover:bg-surface-secondary text-text-muted',
                )}
              >
                <Folder className="w-4 h-4 shrink-0 text-primary/70" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-xs text-text-muted font-mono truncate max-w-[60%]" title={selected || currentPath}>
            {selected || currentPath}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-on-primary hover:bg-primary-hover transition-colors"
            >
              {selected ? 'Select' : 'Use This Folder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
