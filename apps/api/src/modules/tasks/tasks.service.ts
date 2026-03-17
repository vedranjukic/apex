import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from '../../database/entities/task.entity';
import { MessageEntity } from '../../database/entities/message.entity';

@Injectable()
export class ThreadsService implements OnModuleInit {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly threadRepo: Repository<TaskEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
  ) {}

  async onModuleInit() {
    await this.threadRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'completed' })
      .where('status = :status', { status: 'idle' })
      .execute();
  }

  async findByProject(projectId: string): Promise<TaskEntity[]> {
    return this.threadRepo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<TaskEntity> {
    const thread = await this.threadRepo.findOne({
      where: { id },
      relations: ['messages'],
    });
    if (!thread) throw new NotFoundException(`Thread ${id} not found`);
    if (thread.messages) {
      thread.messages.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
    return thread;
  }

  async create(
    projectId: string,
    data: { prompt: string; agentType?: string },
  ): Promise<TaskEntity> {
    const title =
      data.prompt.length > 100
        ? data.prompt.substring(0, 100) + '…'
        : data.prompt;

    const thread = this.threadRepo.create({
      projectId,
      title,
      status: 'completed',
      agentType: data.agentType ?? null,
    });
    const saved = await this.threadRepo.save(thread);

    await this.addMessage(saved.id, {
      role: 'user',
      content: [{ type: 'text', text: data.prompt }],
      metadata: null,
    });

    return this.findById(saved.id);
  }

  async updateStatus(id: string, status: string): Promise<TaskEntity> {
    await this.threadRepo.update(id, { status });
    return this.findById(id);
  }

  async updateClaudeSessionId(threadId: string, sessionId: string): Promise<void> {
    await this.threadRepo.update(threadId, { claudeSessionId: sessionId });
  }

  async updateMode(threadId: string, mode: string): Promise<void> {
    await this.threadRepo.update(threadId, { mode });
  }

  async updateAgentType(threadId: string, agentType: string): Promise<void> {
    await this.threadRepo.update(threadId, { agentType });
  }

  async addMessage(
    threadId: string,
    data: {
      role: string;
      content: Record<string, unknown>[];
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<MessageEntity> {
    const msg = this.messageRepo.create({
      taskId: threadId, // DB column is still 'taskId'
      role: data.role,
      content: data.content,
      metadata: data.metadata || null,
    });
    return this.messageRepo.save(msg);
  }

  async getMessages(threadId: string): Promise<MessageEntity[]> {
    return this.messageRepo.find({
      where: { taskId: threadId },
      order: { createdAt: 'ASC' },
    });
  }

  async remove(id: string): Promise<void> {
    const thread = await this.findById(id);
    await this.threadRepo.remove(thread);
  }
}
