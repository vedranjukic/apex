import { create } from 'zustand';
import { chatsApi, type Chat, type Message } from '../api/client';

interface ChatsState {
  projectId: string | null;
  chats: Chat[];
  activeChatId: string | null;
  composingNew: boolean;
  messages: Message[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  chatScrollOffsets: Record<string, number>;
  setSearchQuery: (q: string) => void;
  fetchChats: (projectId: string) => Promise<void>;
  setActiveChat: (chatId: string) => Promise<void>;
  startNewChat: () => void;
  createChat: (
    projectId: string,
    data: { prompt: string },
  ) => Promise<Chat>;
  addMessage: (msg: Message) => void;
  updateChatStatus: (chatId: string, status: string) => void;
  deleteChat: (id: string) => Promise<void>;
  setChatScrollOffset: (chatId: string, offset: number) => void;
  reset: () => void;
}

export const useChatsStore = create<ChatsState>((set, get) => ({
  projectId: null,
  chats: [],
  activeChatId: null,
  composingNew: false,
  messages: [],
  loading: false,
  error: null,
  searchQuery: '',
  chatScrollOffsets: {},

  setSearchQuery: (q) => set({ searchQuery: q }),

  fetchChats: async (projectId) => {
    const isNewProject = get().projectId !== projectId;
    if (isNewProject) {
      const restoredChatId = get().activeChatId;
      set({
        projectId,
        chats: [],
        activeChatId: restoredChatId,
        composingNew: !restoredChatId,
        messages: restoredChatId ? get().messages : [],
        searchQuery: '',
        chatScrollOffsets: restoredChatId ? get().chatScrollOffsets : {},
        loading: true,
        error: null,
      });
    } else {
      set({ loading: true, error: null });
    }
    try {
      const chats = await chatsApi.listByProject(projectId, get().searchQuery || undefined);
      if (get().projectId !== projectId) return;
      set({ chats, loading: false });
    } catch (err) {
      if (get().projectId !== projectId) return;
      set({ error: String(err), loading: false });
    }
  },

  setActiveChat: async (chatId) => {
    set({ activeChatId: chatId, composingNew: false, loading: true });
    try {
      const [chat, messages] = await Promise.all([
        get().chats.find((c) => c.id === chatId)
          ? Promise.resolve(null)
          : chatsApi.get(chatId),
        chatsApi.messages(chatId),
      ]);
      let chats = chat && !get().chats.find((c) => c.id === chatId)
        ? [chat, ...get().chats]
        : get().chats;

      const opened = chats.find((c) => c.id === chatId);
      if (opened?.status === 'completed') {
        const completedAge = Date.now() - new Date(opened.updatedAt).getTime();
        if (completedAge > 60 * 60 * 1000) {
          chats = chats.map((c) =>
            c.id === chatId ? { ...c, status: 'idle' } : c,
          );
          chatsApi.updateStatus(chatId, 'idle').catch(() => {});
        }
      }

      set({ chats, messages, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  startNewChat: () => {
    set({ activeChatId: null, composingNew: true, messages: [] });
  },

  createChat: async (projectId, data) => {
    const chat = await chatsApi.create(projectId, data);
    set({
      chats: [chat, ...get().chats],
      activeChatId: chat.id,
      composingNew: false,
      messages: chat.messages || [],
    });
    return chat;
  },

  addMessage: (msg) => {
    if (msg.taskId === get().activeChatId) {
      set({ messages: [...get().messages, msg] });
    }
  },

  updateChatStatus: (chatId, status) => {
    const chats = get().chats.map((c) =>
      c.id === chatId ? { ...c, status } : c,
    );
    set({ chats });
  },

  deleteChat: async (id) => {
    await chatsApi.delete(id);
    const chats = get().chats.filter((c) => c.id !== id);
    const activeChatId = get().activeChatId === id ? null : get().activeChatId;
    set({ chats, activeChatId, messages: activeChatId ? get().messages : [] });
  },

  setChatScrollOffset: (chatId, offset) =>
    set((state) => ({
      chatScrollOffsets: { ...state.chatScrollOffsets, [chatId]: offset },
    })),

  reset: () =>
    set({
      projectId: null,
      chats: [],
      activeChatId: null,
      composingNew: true,
      messages: [],
      loading: false,
      error: null,
      searchQuery: '',
      chatScrollOffsets: {},
    }),
}));
