import { eq, desc, asc, inArray, sql } from 'drizzle-orm';
import { db } from '../../database/db';
import { tasks, messages, projects } from '../../database/schema';
import { proxyProjectsService } from '../llm-proxy/proxy-projects.service';
import type { ThreadSyncPayload, MessageSyncPayload } from '../llm-proxy/proxy-projects.service';

export type Task = typeof tasks.$inferSelect;
export type Message = typeof messages.$inferSelect;

const STALE_ACTIVE_STATUSES = ['idle', 'running', 'waiting_for_input'];
const TERMINAL_STATUSES = new Set(['completed', 'error']);

class ThreadsService {
  private providerCache = new Map<string, string>();

  private async getProjectProvider(projectId: string): Promise<string> {
    const cached = this.providerCache.get(projectId);
    if (cached) return cached;
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { provider: true },
    });
    const provider = project?.provider || '';
    this.providerCache.set(projectId, provider);
    return provider;
  }

  private toThreadPayload(thread: Task): ThreadSyncPayload {
    return {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      status: thread.status,
      agentType: thread.agentType,
      model: thread.model,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  }

  private syncThreadToProxy(thread: Task): void {
    this.getProjectProvider(thread.projectId).then((provider) => {
      if (provider !== 'daytona') return;
      proxyProjectsService.syncThread(this.toThreadPayload(thread)).catch(() => {});
    }).catch(() => {});
  }

  private syncThreadAndMessagesToProxy(thread: Task): void {
    this.getProjectProvider(thread.projectId).then(async (provider) => {
      if (provider !== 'daytona') return;
      proxyProjectsService.syncThread(this.toThreadPayload(thread)).catch(() => {});
      const msgs = await this.getMessages(thread.id);
      if (msgs.length > 0) {
        const payload: MessageSyncPayload[] = msgs.map((m) => ({
          id: m.id,
          taskId: m.taskId,
          role: m.role,
          content: m.content as unknown[],
          metadata: m.metadata,
          createdAt: m.createdAt,
        }));
        proxyProjectsService.syncMessages(thread.id, payload).catch(() => {});
      }
    }).catch(() => {});
  }

  private removeThreadFromProxy(threadId: string, projectId: string): void {
    this.getProjectProvider(projectId).then((provider) => {
      if (provider !== 'daytona') return;
      proxyProjectsService.removeThread(threadId).catch(() => {});
    }).catch(() => {});
  }
  async init() {
    // Mark active threads as completed (they can't survive a restart)
    await db
      .update(tasks)
      .set({ status: 'completed', agentSessionId: null, updatedAt: new Date().toISOString() })
      .where(inArray(tasks.status, STALE_ACTIVE_STATUSES));
    // Clear all stale agentSessionId values — after a restart, no OC sessions
    // survive so any stored ID is invalid. This ensures follow-up prompts on
    // completed threads correctly trigger session recovery with context injection.
    await db
      .update(tasks)
      .set({ agentSessionId: null })
      .where(sql`${tasks.agentSessionId} IS NOT NULL`);
  }

  async findByProject(projectId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.createdAt));
  }

  async reconcileStaleThreads(projectId: string, activeThreadIds: Set<string>): Promise<string[]> {
    const projectThreads = await this.findByProject(projectId);
    const stale = projectThreads.filter(
      (t) => STALE_ACTIVE_STATUSES.includes(t.status) && !activeThreadIds.has(t.id),
    );
    for (const t of stale) {
      await db
        .update(tasks)
        .set({ status: 'completed', agentSessionId: null, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, t.id));
    }
    return stale.map((t) => t.id);
  }

  async findById(id: string): Promise<Task & { messages?: Message[] }> {
    const thread = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
      with: { messages: { orderBy: [asc(messages.createdAt)] } },
    });
    if (!thread) throw new Error(`Thread ${id} not found`);
    return thread;
  }

  async create(projectId: string, data: { prompt: string; agentType?: string }): Promise<Task & { messages?: Message[] }> {
    const title = data.prompt.length > 100 ? data.prompt.substring(0, 100) + '…' : data.prompt;
    const id = crypto.randomUUID();

    await db.insert(tasks).values({
      id,
      projectId,
      title,
      status: 'completed',
      agentType: data.agentType ?? null,
    });

    await this.addMessage(id, {
      role: 'user',
      content: [{ type: 'text', text: data.prompt }],
      metadata: null,
    });

    const saved = await this.findById(id);
    this.syncThreadAndMessagesToProxy(saved);
    return saved;
  }

  async updateStatus(id: string, status: string): Promise<Task & { messages?: Message[] }> {
    await db.update(tasks).set({ status, updatedAt: new Date().toISOString() }).where(eq(tasks.id, id));
    const updated = await this.findById(id);
    if (TERMINAL_STATUSES.has(status)) {
      this.syncThreadAndMessagesToProxy(updated);
    } else {
      this.syncThreadToProxy(updated);
    }
    return updated;
  }

  async updateAgentSessionId(threadId: string, sessionId: string | null): Promise<void> {
    await db.update(tasks).set({ agentSessionId: sessionId, updatedAt: new Date().toISOString() }).where(eq(tasks.id, threadId));
  }

  async updateMode(threadId: string, mode: string): Promise<void> {
    await db.update(tasks).set({ mode, updatedAt: new Date().toISOString() }).where(eq(tasks.id, threadId));
  }

  async updateAgentType(threadId: string, agentType: string): Promise<void> {
    await db.update(tasks).set({ agentType, updatedAt: new Date().toISOString() }).where(eq(tasks.id, threadId));
  }

  async updateModel(threadId: string, model: string): Promise<void> {
    await db.update(tasks).set({ model: model || null, updatedAt: new Date().toISOString() }).where(eq(tasks.id, threadId));
  }

  async updatePlanData(
    threadId: string,
    planData: { id: string; title: string; filename: string; content: string },
  ): Promise<void> {
    await db.update(tasks).set({ planData, updatedAt: new Date().toISOString() }).where(eq(tasks.id, threadId));
  }

  async updateLastPersistedSeq(threadId: string, seq: number): Promise<void> {
    await db
      .update(tasks)
      .set({ lastPersistedSeq: seq })
      .where(eq(tasks.id, threadId));
  }

  async addMessage(
    threadId: string,
    data: {
      role: string;
      content: Record<string, unknown>[];
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<Message> {
    const id = crypto.randomUUID();
    await db.insert(messages).values({
      id,
      taskId: threadId,
      role: data.role,
      content: data.content,
      metadata: data.metadata || null,
    });
    const msg = await db.query.messages.findFirst({ where: eq(messages.id, id) });
    return msg!;
  }

  async getMessages(threadId: string): Promise<Message[]> {
    return db.select().from(messages).where(eq(messages.taskId, threadId)).orderBy(asc(messages.createdAt));
  }

  async getFirstUserMessage(threadId: string): Promise<Message | undefined> {
    return db.query.messages.findFirst({
      where: (m, { eq, and }) => and(eq(m.taskId, threadId), eq(m.role, 'user')),
      orderBy: [asc(messages.createdAt)],
    });
  }

  async updateTitle(threadId: string, title: string): Promise<Task & { messages?: Message[] }> {
    await db.update(tasks).set({ title, updatedAt: new Date().toISOString() }).where(eq(tasks.id, threadId));
    const updated = await this.findById(threadId);
    this.syncThreadToProxy(updated);
    return updated;
  }

  async forkThread(threadId: string): Promise<Task & { messages?: Message[] }> {
    // Get the original thread with its messages
    const originalThread = await this.findById(threadId);
    
    // Create new thread with forked title
    const newThreadId = crypto.randomUUID();
    const forkTitle = `Fork of ${originalThread.title}`;
    
    await db.insert(tasks).values({
      id: newThreadId,
      projectId: originalThread.projectId,
      title: forkTitle,
      status: 'completed',
      agentType: originalThread.agentType,
      mode: originalThread.mode,
      model: originalThread.model,
    });

    // Copy all messages from the original thread
    if (originalThread.messages && originalThread.messages.length > 0) {
      const messageValues = originalThread.messages.map(msg => ({
        id: crypto.randomUUID(),
        taskId: newThreadId,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
      }));
      
      await db.insert(messages).values(messageValues);
    }

    return this.findById(newThreadId);
  }

  async remove(id: string): Promise<void> {
    const thread = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    await db.delete(tasks).where(eq(tasks.id, id));
    if (thread) this.removeThreadFromProxy(id, thread.projectId);
  }
}

export const threadsService = new ThreadsService();
