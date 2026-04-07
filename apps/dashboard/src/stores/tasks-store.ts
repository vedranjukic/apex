import { create } from 'zustand';
import { threadsApi, type Thread, type Message } from '../api/client';

export interface McpServerInfo {
  name: string;
  status: string;
}

export interface ThreadSessionInfo {
  model?: string;
  tools?: string[];
  mcpServers?: McpServerInfo[];
  permissionMode?: string;
  agentVersion?: string;
}

export interface DraftSelection {
  start: number;
  end: number;
}

interface ThreadsState {
  projectId: string | null;
  threads: Thread[];
  activeThreadId: string | null;
  composingNew: boolean;
  messages: Message[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  threadScrollOffsets: Record<string, number>;
  threadSessionInfo: Record<string, ThreadSessionInfo>;
  threadDrafts: Record<string, string>;
  threadDraftSelections: Record<string, DraftSelection>;
  // Offline-aware state
  pausedThreadIds: Set<string>;
  offlinePausedThreadIds: Set<string>;
  setSearchQuery: (q: string) => void;
  fetchThreads: (projectId: string) => Promise<void>;
  setActiveThread: (threadId: string) => Promise<void>;
  startNewThread: () => void;
  createThread: (
    projectId: string,
    data: { prompt: string; agentType?: string },
  ) => Promise<Thread>;
  addMessage: (msg: Message) => void;
  updateThreadStatus: (threadId: string, status: string, isOnline?: boolean) => void;
  updateThread: (threadId: string, patch: Partial<Thread>) => void;
  setThreadSessionInfo: (threadId: string, info: ThreadSessionInfo) => void;
  deleteThread: (id: string) => Promise<void>;
  renameThread: (id: string, newTitle: string) => Promise<void>;
  forkThread: (id: string) => Promise<Thread>;
  setThreadScrollOffset: (threadId: string, offset: number) => void;
  setThreadDraft: (threadId: string, draft: string) => void;
  getThreadDraft: (threadId: string) => string;
  setThreadDraftSelection: (threadId: string, sel: DraftSelection) => void;
  getThreadDraftSelection: (threadId: string) => DraftSelection | null;
  clearThreadDraft: (threadId: string) => void;
  // Offline-aware methods
  pauseThreadsForOffline: () => void;
  resumeThreadsFromOffline: () => void;
  canTransitionStatus: (fromStatus: string, toStatus: string, isOnline?: boolean) => boolean;
  reset: () => void;
}

export const useThreadsStore = create<ThreadsState>((set, get) => ({
  projectId: null,
  threads: [],
  activeThreadId: null,
  composingNew: false,
  messages: [],
  loading: false,
  error: null,
  searchQuery: '',
  threadScrollOffsets: {},
  threadSessionInfo: {},
  threadDrafts: {},
  threadDraftSelections: {},
  pausedThreadIds: new Set(),
  offlinePausedThreadIds: new Set(),

  setSearchQuery: (q) => set({ searchQuery: q }),

  fetchThreads: async (projectId) => {
    const isNewProject = get().projectId !== projectId;
    if (isNewProject) {
      const restoredThreadId = get().activeThreadId;
      set({
        projectId,
        threads: [],
        activeThreadId: restoredThreadId,
        composingNew: !restoredThreadId,
        messages: restoredThreadId ? get().messages : [],
        searchQuery: '',
        threadScrollOffsets: restoredThreadId ? get().threadScrollOffsets : {},
        loading: true,
        error: null,
      });
    } else {
      set({ loading: true, error: null });
    }
    try {
      const threads = await threadsApi.listByProject(projectId, get().searchQuery || undefined);
      if (get().projectId !== projectId) return;
      set({ threads, loading: false });

      if (!get().activeThreadId && threads.length > 0) {
        const mostRecent = threads.reduce((latest, thread) =>
          new Date(thread.updatedAt) > new Date(latest.updatedAt) ? thread : latest,
        );
        get().setActiveThread(mostRecent.id);
      }
    } catch (err) {
      if (get().projectId !== projectId) return;
      set({ error: String(err), loading: false });
    }
  },

  setActiveThread: async (threadId) => {
    set({ activeThreadId: threadId, composingNew: false, loading: true });
    try {
      const [thread, messages] = await Promise.all([
        get().threads.find((c) => c.id === threadId)
          ? Promise.resolve(null)
          : threadsApi.get(threadId),
        threadsApi.messages(threadId),
      ]);
      const threads = thread && !get().threads.find((c) => c.id === threadId)
        ? [thread, ...get().threads]
        : get().threads;

      set({ threads, messages, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  startNewThread: () => {
    set({ activeThreadId: null, composingNew: true, messages: [] });
  },

  createThread: async (projectId, data) => {
    const thread = await threadsApi.create(projectId, data);
    set({
      threads: [thread, ...get().threads],
      activeThreadId: thread.id,
      composingNew: false,
      messages: thread.messages || [],
    });
    return thread;
  },

  addMessage: (msg) => {
    if (msg.taskId === get().activeThreadId) {
      set({ messages: [...get().messages, msg] });
    }
  },

  updateThreadStatus: (threadId, status, isOnline = true) => {
    const { canTransitionStatus } = get();
    const currentThread = get().threads.find(t => t.id === threadId);
    
    // Check if status transition is allowed
    if (currentThread && !canTransitionStatus(currentThread.status, status, isOnline)) {
      console.log(`[threads] Blocked status transition from ${currentThread.status} to ${status} for thread ${threadId}`);
      return;
    }
    
    const threads = get().threads.map((c) =>
      c.id === threadId ? { ...c, status } : c,
    );
    set({ threads });
  },

  updateThread: (threadId, patch) => {
    const threads = get().threads.map((c) =>
      c.id === threadId ? { ...c, ...patch } : c,
    );
    set({ threads });
  },

  setThreadSessionInfo: (threadId, info) =>
    set((state) => ({
      threadSessionInfo: { ...state.threadSessionInfo, [threadId]: info },
    })),

  deleteThread: async (id) => {
    await threadsApi.delete(id);
    const threads = get().threads.filter((c) => c.id !== id);
    const activeThreadId = get().activeThreadId === id ? null : get().activeThreadId;
    set({ threads, activeThreadId, messages: activeThreadId ? get().messages : [] });
  },

  renameThread: async (id, newTitle) => {
    const updatedThread = await threadsApi.update(id, { title: newTitle });
    const threads = get().threads.map((c) =>
      c.id === id ? updatedThread : c,
    );
    set({ threads });
  },

  forkThread: async (id) => {
    const forkedThread = await threadsApi.fork(id);
    set({
      threads: [forkedThread, ...get().threads],
    });
    return forkedThread;
  },

  setThreadScrollOffset: (threadId, offset) =>
    set((state) => ({
      threadScrollOffsets: { ...state.threadScrollOffsets, [threadId]: offset },
    })),

  setThreadDraft: (threadId, draft) =>
    set((state) => ({
      threadDrafts: { ...state.threadDrafts, [threadId]: draft },
    })),

  getThreadDraft: (threadId) => get().threadDrafts[threadId] || '',

  setThreadDraftSelection: (threadId, sel) =>
    set((state) => ({
      threadDraftSelections: { ...state.threadDraftSelections, [threadId]: sel },
    })),

  getThreadDraftSelection: (threadId) => get().threadDraftSelections[threadId] ?? null,

  clearThreadDraft: (threadId) =>
    set((state) => {
      const { [threadId]: _, ...remainingDrafts } = state.threadDrafts;
      const { [threadId]: __, ...remainingSelections } = state.threadDraftSelections;
      return { threadDrafts: remainingDrafts, threadDraftSelections: remainingSelections };
    }),

  pauseThreadsForOffline: () => {
    const state = get();
    const runningThreads = state.threads.filter(t => 
      t.status === 'running' || t.status === 'waiting_for_user_action'
    );
    
    if (runningThreads.length === 0) return;
    
    console.log(`[threads] Pausing ${runningThreads.length} threads for offline mode`);
    
    const offlinePausedThreadIds = new Set(state.offlinePausedThreadIds);
    const threads = state.threads.map(thread => {
      if (thread.status === 'running' || thread.status === 'waiting_for_user_action') {
        offlinePausedThreadIds.add(thread.id);
        return { ...thread, status: 'offline_paused', previousStatus: thread.status };
      }
      return thread;
    });
    
    set({ threads, offlinePausedThreadIds });
  },

  resumeThreadsFromOffline: () => {
    const state = get();
    if (state.offlinePausedThreadIds.size === 0) return;
    
    console.log(`[threads] Resuming ${state.offlinePausedThreadIds.size} threads from offline mode`);
    
    const threads = state.threads.map(thread => {
      if (state.offlinePausedThreadIds.has(thread.id) && thread.status === 'offline_paused') {
        // Resume with previous status or default to idle
        const resumeStatus = (thread as any).previousStatus || 'idle';
        const { previousStatus, ...cleanThread } = thread as any;
        return { ...cleanThread, status: resumeStatus };
      }
      return thread;
    });
    
    set({ threads, offlinePausedThreadIds: new Set() });
  },

  canTransitionStatus: (fromStatus, toStatus, isOnline = true) => {
    // Block certain transitions when offline
    if (!isOnline) {
      // Don't allow transitioning from offline_paused to running states
      if (fromStatus === 'offline_paused' && (toStatus === 'running' || toStatus === 'waiting_for_user_action')) {
        return false;
      }
      
      // Don't allow transitioning to running states when offline
      if (toStatus === 'running' || toStatus === 'waiting_for_user_action') {
        return false;
      }
    }
    
    // Allow transitions to terminal states (completed, error, stopped) regardless of network
    const terminalStates = ['completed', 'error', 'stopped', 'offline_paused'];
    if (terminalStates.includes(toStatus)) {
      return true;
    }
    
    // Allow transitions from offline_paused when back online
    if (fromStatus === 'offline_paused' && isOnline) {
      return true;
    }
    
    return true;
  },

  reset: () =>
    set({
      projectId: null,
      threads: [],
      activeThreadId: null,
      composingNew: true,
      messages: [],
      loading: false,
      error: null,
      searchQuery: '',
      threadScrollOffsets: {},
      threadSessionInfo: {},
      threadDrafts: {},
      threadDraftSelections: {},
      pausedThreadIds: new Set(),
      offlinePausedThreadIds: new Set(),
    }),
}));
