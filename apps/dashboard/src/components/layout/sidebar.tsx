import { useEffect, useCallback } from 'react';
import { Search, Plus, Loader2, CheckCircle2, AlertCircle, Circle, X, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useChatsStore } from '../../stores/tasks-store';
import { useEditorStore } from '../../stores/editor-store';
import { useState } from 'react';

interface SidebarProps {
  projectId: string;
}

export function Sidebar({ projectId }: SidebarProps) {
  const {
    chats,
    activeChatId,
    composingNew,
    loading,
    searchQuery,
    setSearchQuery,
    fetchChats,
    setActiveChat,
    startNewChat,
  } = useChatsStore();

  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const activeView = useEditorStore((s) => s.activeView);
  const closeFile = useEditorStore((s) => s.closeFile);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const showChat = useEditorStore((s) => s.showChat);

  const [filesExpanded, setFilesExpanded] = useState(true);
  const [chatsExpanded, setChatsExpanded] = useState(true);

  useEffect(() => {
    fetchChats(projectId);
  }, [projectId, fetchChats]);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
      fetchChats(projectId);
    },
    [projectId, setSearchQuery, fetchChats],
  );

  const handleChatClick = useCallback(
    (chatId: string) => {
      setActiveChat(chatId);
      showChat();
    },
    [setActiveChat, showChat],
  );

  const handleNewChat = useCallback(() => {
    startNewChat();
    showChat();
  }, [startNewChat, showChat]);

  const filteredChats = searchQuery
    ? chats.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : chats;

  return (
    <aside className="w-72 bg-sidebar text-panel-text flex flex-col shrink-0 h-full">
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

      {/* Chats Section */}
      <div className="flex flex-col flex-1 min-h-0">
        <button
          onClick={() => setChatsExpanded(!chatsExpanded)}
          className="flex items-center gap-1 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-panel-text-muted select-none hover:text-panel-text transition-colors"
        >
          {chatsExpanded
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
          Chats
        </button>
        {chatsExpanded && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Search */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-panel-icon" />
                <input
                  type="text"
                  placeholder="Search chats…"
                  value={searchQuery}
                  onChange={handleSearch}
                  className="w-full pl-9 pr-3 py-2 bg-sidebar-hover rounded-lg text-sm text-panel-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* New Chat button */}
            <div className="px-3 pb-2">
              <button
                onClick={handleNewChat}
                  className={cn(
                  'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors',
                  composingNew && activeView === 'chat'
                    ? 'bg-sidebar-active text-panel-text'
                    : 'text-panel-text-muted hover:bg-sidebar-hover',
                )}
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
            </div>

            {/* Chat list */}
            <div className="flex-1 overflow-y-auto px-2">
              {loading && chats.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                </div>
              ) : filteredChats.length === 0 ? (
                <p className="text-center text-text-muted text-sm py-8">No chats yet</p>
              ) : (
                <ul className="space-y-0.5">
                  {filteredChats.map((chat) => (
                    <li key={chat.id}>
                      <button
                        onClick={() => handleChatClick(chat.id)}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left transition-colors',
                          activeView === 'chat' && activeChatId === chat.id
                            ? 'bg-sidebar-active text-panel-text'
                            : 'text-panel-text-muted hover:bg-sidebar-hover',
                        )}
                      >
                        <StatusIcon status={chat.status} />
                        <span className="truncate flex-1">{chat.title}</span>
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
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 shrink-0 text-accent animate-pulse" />;
    case 'error':
      return <AlertCircle className="w-4 h-4 shrink-0 text-danger" />;
    default:
      return <Circle className="w-4 h-4 shrink-0 text-text-muted" />;
  }
}
