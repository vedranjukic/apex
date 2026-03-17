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
import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ThreadsService } from './tasks.service';

class CreateThreadBody {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsOptional()
  agentType?: string;
}

class UpdateStatusBody {
  @IsString()
  @IsIn(['running', 'waiting_for_input', 'completed', 'error'])
  status!: string;
}

@Controller()
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  /** GET /api/projects/:projectId/threads */
  @Get('projects/:projectId/threads')
  async listByProject(
    @Param('projectId') projectId: string,
    @Query('search') search?: string,
  ) {
    const threads = await this.threadsService.findByProject(projectId);
    if (search) {
      const q = search.toLowerCase();
      return threads.filter((c) => c.title.toLowerCase().includes(q));
    }
    return threads;
  }

  /** POST /api/projects/:projectId/threads */
  @Post('projects/:projectId/threads')
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateThreadBody,
  ) {
    return this.threadsService.create(projectId, body);
  }

  /** GET /api/threads/:id – includes messages */
  @Get('threads/:id')
  async findOne(@Param('id') id: string) {
    return this.threadsService.findById(id);
  }

  /** GET /api/threads/:id/messages */
  @Get('threads/:id/messages')
  async messages(@Param('id') id: string) {
    return this.threadsService.getMessages(id);
  }

  /** PATCH /api/threads/:id/status */
  @Patch('threads/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateStatusBody,
  ) {
    return this.threadsService.updateStatus(id, body.status);
  }

  /** DELETE /api/threads/:id */
  @Delete('threads/:id')
  async remove(@Param('id') id: string) {
    await this.threadsService.remove(id);
    return { ok: true };
  }
}
