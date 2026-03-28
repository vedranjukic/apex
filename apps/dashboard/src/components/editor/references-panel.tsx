import { useMemo, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, FileText, Loader2, X } from 'lucide-react';
import { useReferencesStore, type ReferenceLocation } from '../../stores/references-store';
import { useEditorStore } from '../../stores/editor-store';
import { cn } from '../../lib/cn';

interface FileGroup {
  filePath: string;
  fileName: string;
  locations: ReferenceLocation[];
}

function groupByFile(locations: ReferenceLocation[]): FileGroup[] {
  const map = new Map<string, ReferenceLocation[]>();
  for (const loc of locations) {
    const filePath = loc.uri.replace(/^file:\/\//, '');
    const existing = map.get(filePath);
    if (existing) {
      existing.push(loc);
    } else {
      map.set(filePath, [loc]);
    }
  }
  const groups: FileGroup[] = [];
  for (const [filePath, locs] of map) {
    groups.push({
      filePath,
      fileName: filePath.split('/').pop() ?? filePath,
      locations: locs.sort((a, b) => a.range.start.line - b.range.start.line),
    });
  }
  return groups.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

interface ReferencesPanelProps {
  readFile?: (path: string) => void;
}

export function ReferencesPanel({ readFile }: ReferencesPanelProps) {
  const title = useReferencesStore((s) => s.title);
  const locations = useReferencesStore((s) => s.locations);
  const loading = useReferencesStore((s) => s.loading);
  const clear = useReferencesStore((s) => s.clear);

  const groups = useMemo(() => groupByFile(locations), [locations]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
        <span className="ml-2 text-xs text-text-muted">Searching...</span>
      </div>
    );
  }

  if (!title) {
    return (
      <div className="py-4 text-center text-xs text-text-muted">
        No results. Use "Find All References" or "Find All Implementations" from the editor context menu.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 mb-2">
        <span className="flex-1 text-xs text-panel-text truncate" title={title}>
          {title}
        </span>
        <span className="text-[10px] text-text-muted">{locations.length}</span>
        <button
          onClick={clear}
          className="w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-panel-text hover:bg-sidebar-hover"
          title="Clear results"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {locations.length === 0 ? (
        <div className="text-xs text-text-muted py-2">No results found.</div>
      ) : (
        groups.map((group) => (
          <FileGroupItem key={group.filePath} group={group} readFile={readFile} />
        ))
      )}
    </div>
  );
}

function FileGroupItem({ group, readFile }: { group: FileGroup; readFile?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);

  const handleClick = useCallback((filePath: string, fileName: string, line: number) => {
    openFileAtLine(filePath, fileName, line);
    readFile?.(filePath);
  }, [openFileAtLine, readFile]);

  return (
    <div>
      <button
        className="flex items-center gap-1 w-full text-left py-1 hover:bg-sidebar-hover rounded px-1 group"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
        )}
        <FileText className="w-3 h-3 text-text-muted shrink-0" />
        <span className="text-xs text-panel-text truncate flex-1">{group.fileName}</span>
        <span className="text-[10px] text-text-muted">{group.locations.length}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-panel-border pl-2">
          {group.locations.map((loc, i) => {
            const line = loc.range.start.line + 1;
            const col = loc.range.start.character + 1;
            return (
              <button
                key={i}
                className={cn(
                  'flex items-center gap-2 w-full text-left py-0.5 px-1.5 rounded text-[11px]',
                  'text-text-secondary hover:text-panel-text hover:bg-sidebar-hover',
                )}
                title={`${group.filePath}:${line}:${col}`}
                onClick={() => handleClick(group.filePath, group.fileName, line)}
              >
                <span className="text-text-muted tabular-nums w-8 text-right shrink-0">
                  {line}
                </span>
                <span className="truncate">
                  Col {col}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
