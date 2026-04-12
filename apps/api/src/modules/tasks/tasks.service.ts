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
    await this.importProxyThreads(projectId);
    return db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.createdAt));
  }

  /**
   * For Daytona projects, pull any threads from the proxy that don't exist
   * in the host DB (created by mobile-initiated prompts).
   */
  private async importProxyThreads(projectId: string): Promise<void> {
    try {
      const provider = await this.getProjectProvider(projectId);
      if (provider !== 'daytona') return;

      const proxyThreads = await proxyProjectsService.fetchProjectThreads(projectId);
      if (proxyThreads.length === 0) return;

      const existingIds = new Set(
        (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId))).map((t) => t.id),
      );

      const newThreads = proxyThreads.filter((pt) => !existingIds.has(pt.id));
      if (newThreads.length === 0) return;

      console.log(`[threads] Importing ${newThreads.length} proxy threads for project ${projectId.slice(0, 8)}`);
      for (const pt of newThreads) {
        await db.insert(tasks).values({
          id: pt.id,
          projectId: pt.projectId,
          title: pt.title,
          status: pt.status,
          agentType: pt.agentType ?? null,
          model: pt.model ?? null,
          createdAt: pt.createdAt || new Date().toISOString(),
          updatedAt: pt.updatedAt || new Date().toISOString(),
        }).onConflictDoNothing();
      }
    } catch (err) {
      console.warn(`[threads] importProxyThreads error for project ${projectId.slice(0, 8)}:`, (err as Error).message);
    }
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
    await this.syncThreadStatusFromProxy(thread);
    return thread;
  }

  /**
   * If the proxy has a more recent status for this Daytona thread
   * (e.g. from a mobile-initiated prompt), update the host DB.
   */
  private async syncThreadStatusFromProxy(thread: Task): Promise<void> {
    try {
      const provider = await this.getProjectProvider(thread.projectId);
      if (provider !== 'daytona') return;

      const proxyThread = await proxyProjectsService.fetchThread(thread.id);
      if (!proxyThread) return;

      if (proxyThread.updatedAt > thread.updatedAt && proxyThread.status !== thread.status) {
        console.log(`[threads] Syncing thread ${thread.id.slice(0, 8)} status from proxy: ${thread.status} -> ${proxyThread.status}`);
        await db.update(tasks).set({ status: proxyThread.status, updatedAt: proxyThread.updatedAt }).where(eq(tasks.id, thread.id));
        thread.status = proxyThread.status;
        thread.updatedAt = proxyThread.updatedAt;
      }
    } catch (err) {
      console.warn(`[threads] syncThreadStatusFromProxy error for ${thread.id.slice(0, 8)}:`, (err as Error).message);
    }
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
    if (data.role === 'user') {
      this.syncMessagesToProxyForThread(threadId);
    }
    return msg!;
  }

  private syncMessagesToProxyForThread(threadId: string): void {
    db.select().from(messages).where(eq(messages.taskId, threadId)).orderBy(asc(messages.createdAt)).then(async (msgs) => {
      if (msgs.length === 0) return;
      const thread = await db.query.tasks.findFirst({ where: eq(tasks.id, threadId), columns: { projectId: true } });
      if (!thread) return;
      const provider = await this.getProjectProvider(thread.projectId);
      if (provider !== 'daytona') return;
      const payload: MessageSyncPayload[] = msgs.map((m) => ({
        id: m.id, taskId: m.taskId, role: m.role,
        content: m.content as unknown[], metadata: m.metadata, createdAt: m.createdAt,
      }));
      proxyProjectsService.syncMessages(threadId, payload).catch(() => {});
    }).catch(() => {});
  }

  async getMessages(threadId: string): Promise<Message[]> {
    await this.importProxyMessages(threadId);
    return db.select().from(messages).where(eq(messages.taskId, threadId)).orderBy(asc(messages.createdAt));
  }

  /**
   * For Daytona threads, pull any messages from the proxy that don't exist
   * in the host DB (e.g. from mobile-initiated prompts). Runs in the
   * background and doesn't block on failure.
   */
  private async importProxyMessages(threadId: string): Promise<void> {
    try {
      const thread = await db.query.tasks.findFirst({ where: eq(tasks.id, threadId), columns: { projectId: true } });
      if (!thread) return;
      const provider = await this.getProjectProvider(thread.projectId);
      if (provider !== 'daytona') return;

      const proxyMessages = await proxyProjectsService.fetchThreadMessages(threadId);
      if (proxyMessages.length === 0) return;

      const existingIds = new Set(
        (await db.select({ id: messages.id }).from(messages).where(eq(messages.taskId, threadId))).map((m) => m.id),
      );

      const newMessages = proxyMessages.filter((pm) => !existingIds.has(pm.id));
      if (newMessages.length === 0) return;

      console.log(`[threads] Importing ${newMessages.length} proxy messages for thread ${threadId.slice(0, 8)}`);
      for (const pm of newMessages) {
        await db.insert(messages).values({
          id: pm.id,
          taskId: pm.taskId,
          role: pm.role,
          content: pm.content as Record<string, unknown>[],
          metadata: (pm.metadata as Record<string, unknown> | null) || null,
          createdAt: pm.createdAt,
        }).onConflictDoNothing();
      }
    } catch (err) {
      console.warn(`[threads] importProxyMessages error for ${threadId.slice(0, 8)}:`, (err as Error).message);
    }
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
