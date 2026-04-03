import { eq, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../../database/db';
import { tasks, messages } from '../../database/schema';

export type Task = typeof tasks.$inferSelect;
export type Message = typeof messages.$inferSelect;

const STALE_ACTIVE_STATUSES = ['idle', 'running', 'waiting_for_input'];

class ThreadsService {
  async init() {
    await db
      .update(tasks)
      .set({ status: 'completed', claudeSessionId: null, updatedAt: new Date().toISOString() })
      .where(inArray(tasks.status, STALE_ACTIVE_STATUSES));
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
        .set({ status: 'completed', claudeSessionId: null, updatedAt: new Date().toISOString() })
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

    return this.findById(id);
  }

  async updateStatus(id: string, status: string): Promise<Task & { messages?: Message[] }> {
    await db.update(tasks).set({ status, updatedAt: new Date().toISOString() }).where(eq(tasks.id, id));
    return this.findById(id);
  }

  async updateClaudeSessionId(threadId: string, sessionId: string | null): Promise<void> {
    await db.update(tasks).set({ claudeSessionId: sessionId, updatedAt: new Date().toISOString() }).where(eq(tasks.id, threadId));
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

  async remove(id: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }
}

export const threadsService = new ThreadsService();
