import { create } from 'zustand';
import { threadsApi, type Thread, type Message } from '../api/client';

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
  setSearchQuery: (q: string) => void;
  fetchThreads: (projectId: string) => Promise<void>;
  setActiveThread: (threadId: string) => Promise<void>;
  startNewThread: () => void;
  createThread: (
    projectId: string,
    data: { prompt: string; agentType?: string },
  ) => Promise<Thread>;
  addMessage: (msg: Message) => void;
  updateThreadStatus: (threadId: string, status: string) => void;
  updateThread: (threadId: string, patch: Partial<Thread>) => void;
  deleteThread: (id: string) => Promise<void>;
  setThreadScrollOffset: (threadId: string, offset: number) => void;
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

  updateThreadStatus: (threadId, status) => {
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

  deleteThread: async (id) => {
    await threadsApi.delete(id);
    const threads = get().threads.filter((c) => c.id !== id);
    const activeThreadId = get().activeThreadId === id ? null : get().activeThreadId;
    set({ threads, activeThreadId, messages: activeThreadId ? get().messages : [] });
  },

  setThreadScrollOffset: (threadId, offset) =>
    set((state) => ({
      threadScrollOffsets: { ...state.threadScrollOffsets, [threadId]: offset },
    })),

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
    }),
}));
