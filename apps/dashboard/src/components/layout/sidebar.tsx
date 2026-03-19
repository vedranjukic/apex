import { useEffect, useCallback } from 'react';
import { Search, Plus, Loader2, CheckCircle2, AlertCircle, Circle, MessageCircleQuestion, CirclePause, X, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useThreadsStore } from '../../stores/tasks-store';
import { useEditorStore } from '../../stores/editor-store';
import { useState } from 'react';

interface SidebarProps {
  projectId: string;
}

export function Sidebar({ projectId }: SidebarProps) {
  const {
    threads,
    activeThreadId,
    composingNew,
    loading,
    searchQuery,
    setSearchQuery,
    fetchThreads,
    setActiveThread,
    startNewThread,
  } = useThreadsStore();

  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const activeView = useEditorStore((s) => s.activeView);
  const closeFile = useEditorStore((s) => s.closeFile);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const showThread = useEditorStore((s) => s.showThread);

  const [filesExpanded, setFilesExpanded] = useState(true);
  const [threadsExpanded, setThreadsExpanded] = useState(true);

  useEffect(() => {
    fetchThreads(projectId);
  }, [projectId, fetchThreads]);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
      fetchThreads(projectId);
    },
    [projectId, setSearchQuery, fetchThreads],
  );

  const handleThreadClick = useCallback(
    (threadId: string) => {
      setActiveThread(threadId);
      showThread();
    },
    [setActiveThread, showThread],
  );

  const handleNewThread = useCallback(() => {
    startNewThread();
    showThread();
  }, [startNewThread, showThread]);

  const filteredThreads = searchQuery
    ? threads.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : threads;

  return (
    <aside className="w-72 bg-sidebar text-panel-text flex flex-col shrink-0 h-full border-l border-panel-border">
      {/* Open Files Section */}
      <div className="flex flex-col">
        <button
          onClick={() => setFilesExpanded(!filesExpanded)}
          className="flex items-center gap-1 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-panel-text-muted select-none hover:text-panel-text transition-colors"
        >
          {filesExpanded
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
          Open Files
        </button>
        {filesExpanded && (
          <div className="px-2 pb-2">
            {openFiles.length === 0 ? (
              <p className="text-center text-text-muted text-xs py-4">No open files</p>
            ) : (
              <ul className="space-y-0.5">
                {openFiles.map((file) => (
                  <li key={file.path}>
                    <button
                      onClick={() => setActiveFile(file.path)}
                      className={cn(
                        'flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm text-left transition-colors group',
                        activeView === 'editor' && activeFilePath === file.path
                          ? 'bg-sidebar-active text-panel-text'
                          : 'text-panel-text-muted hover:bg-sidebar-hover',
                      )}
                    >
                      <FileText className="w-4 h-4 shrink-0 text-panel-icon" />
                      <span className="truncate flex-1">{file.name}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeFile(file.path);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            closeFile(file.path);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-sidebar-hover transition-opacity"
                      >
                        <X className="w-3.5 h-3.5 text-panel-icon hover:text-panel-text" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-panel-border" />

      {/* Threads Section */}
      <div className="flex flex-col flex-1 min-h-0">
        <button
          onClick={() => setThreadsExpanded(!threadsExpanded)}
          className="flex items-center gap-1 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-panel-text-muted select-none hover:text-panel-text transition-colors"
        >
          {threadsExpanded
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
          Threads
        </button>
        {threadsExpanded && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Search */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-panel-icon" />
                <input
                  type="text"
                  placeholder="Search threads…"
                  value={searchQuery}
                  onChange={handleSearch}
                  className="w-full pl-9 pr-3 py-2 bg-sidebar-hover rounded-lg text-sm text-panel-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* New Thread button */}
            <div className="px-3 pb-2">
              <button
                onClick={handleNewThread}
                  className={cn(
                  'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors',
                  composingNew && activeView === 'thread'
                    ? 'bg-sidebar-active text-panel-text'
                    : 'text-panel-text-muted hover:bg-sidebar-hover',
                )}
              >
                <Plus className="w-4 h-4" />
                New Thread
              </button>
            </div>

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto px-2">
              {loading && threads.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                </div>
              ) : filteredThreads.length === 0 ? (
                <p className="text-center text-text-muted text-sm py-8">No threads yet</p>
              ) : (
                <ul className="space-y-0.5">
                  {filteredThreads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        onClick={() => handleThreadClick(thread.id)}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left transition-colors',
                          activeView === 'thread' && activeThreadId === thread.id
                            ? 'bg-sidebar-active text-panel-text'
                            : 'text-panel-text-muted hover:bg-sidebar-hover',
                        )}
                      >
                        <StatusIcon status={thread.status} />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate">{thread.title}</span>
                          <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
                            <span className="font-mono">{thread.id.slice(0, 8)}</span>
                            {thread.agentType && (
                              <span className="px-1 rounded bg-surface-secondary/60">
                                {{ claude_code: 'Claude', open_code: 'OpenCode', codex: 'Codex' }[thread.agentType] ?? thread.agentType}
                              </span>
                            )}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 shrink-0 animate-spin text-yellow-400" />;
    case 'waiting_for_input':
      return <MessageCircleQuestion className="w-4 h-4 shrink-0 animate-pulse text-yellow-400" />;
    case 'waiting_for_user_action':
      return <CirclePause className="w-4 h-4 shrink-0 text-yellow-400" />;
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 shrink-0 text-accent animate-pulse" />;
    case 'error':
      return <AlertCircle className="w-4 h-4 shrink-0 text-danger" />;
    default:
      return <Circle className="w-4 h-4 shrink-0 text-text-muted" />;
  }
}
