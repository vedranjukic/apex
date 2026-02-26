import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ChatsService } from './tasks.service';

class CreateChatBody {
  @IsString()
  @IsNotEmpty()
  prompt!: string;
}

class UpdateStatusBody {
  @IsString()
  @IsIn(['idle', 'running', 'completed', 'error'])
  status!: string;
}

@Controller()
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  /** GET /api/projects/:projectId/chats */
  @Get('projects/:projectId/chats')
  async listByProject(
    @Param('projectId') projectId: string,
    @Query('search') search?: string,
  ) {
    const chats = await this.chatsService.findByProject(projectId);
    if (search) {
      const q = search.toLowerCase();
      return chats.filter((c) => c.title.toLowerCase().includes(q));
    }
    return chats;
  }

  /** POST /api/projects/:projectId/chats */
  @Post('projects/:projectId/chats')
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateChatBody,
  ) {
    return this.chatsService.create(projectId, body);
  }

  /** GET /api/chats/:id – includes messages */
  @Get('chats/:id')
  async findOne(@Param('id') id: string) {
    return this.chatsService.findById(id);
  }

  /** GET /api/chats/:id/messages */
  @Get('chats/:id/messages')
  async messages(@Param('id') id: string) {
    return this.chatsService.getMessages(id);
  }

  /** PATCH /api/chats/:id/status */
  @Patch('chats/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateStatusBody,
  ) {
    return this.chatsService.updateStatus(id, body.status);
  }

  /** DELETE /api/chats/:id */
  @Delete('chats/:id')
  async remove(@Param('id') id: string) {
    await this.chatsService.remove(id);
    return { ok: true };
  }
}
