import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from '../../database/entities/task.entity';
import { MessageEntity } from '../../database/entities/message.entity';

@Injectable()
export class ChatsService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly chatRepo: Repository<TaskEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
  ) {}

  async findByProject(projectId: string): Promise<TaskEntity[]> {
    return this.chatRepo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<TaskEntity> {
    const chat = await this.chatRepo.findOne({
      where: { id },
      relations: ['messages'],
    });
    if (!chat) throw new NotFoundException(`Chat ${id} not found`);
    if (chat.messages) {
      chat.messages.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
    return chat;
  }

  async create(
    projectId: string,
    data: { prompt: string },
  ): Promise<TaskEntity> {
    const title =
      data.prompt.length > 100
        ? data.prompt.substring(0, 100) + '…'
        : data.prompt;

    const chat = this.chatRepo.create({
      projectId,
      title,
      status: 'idle',
    });
    const saved = await this.chatRepo.save(chat);

    await this.addMessage(saved.id, {
      role: 'user',
      content: [{ type: 'text', text: data.prompt }],
      metadata: null,
    });

    return this.findById(saved.id);
  }

  async updateStatus(id: string, status: string): Promise<TaskEntity> {
    await this.chatRepo.update(id, { status });
    return this.findById(id);
  }

  async updateClaudeSessionId(chatId: string, sessionId: string): Promise<void> {
    await this.chatRepo.update(chatId, { claudeSessionId: sessionId });
  }

  async updateMode(chatId: string, mode: string): Promise<void> {
    await this.chatRepo.update(chatId, { mode });
  }

  async addMessage(
    chatId: string,
    data: {
      role: string;
      content: Record<string, unknown>[];
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<MessageEntity> {
    const msg = this.messageRepo.create({
      taskId: chatId, // DB column is still 'taskId'
      role: data.role,
      content: data.content,
      metadata: data.metadata || null,
    });
    return this.messageRepo.save(msg);
  }

  async getMessages(chatId: string): Promise<MessageEntity[]> {
    return this.messageRepo.find({
      where: { taskId: chatId },
      order: { createdAt: 'ASC' },
    });
  }

  async remove(id: string): Promise<void> {
    const chat = await this.findById(id);
    await this.chatRepo.remove(chat);
  }
}
