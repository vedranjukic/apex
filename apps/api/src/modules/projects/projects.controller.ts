import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ProjectsService } from './projects.service';
import { UsersService } from '../users/users.service';

class CreateProjectBody {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  agentType?: string;

  @IsOptional()
  @IsString()
  sandboxSnapshot?: string;

  @IsOptional()
  @IsString()
  gitRepo?: string;

  @IsOptional()
  @IsObject()
  agentConfig?: Record<string, unknown>;
}

class ForkProjectBody {
  @IsString()
  @IsNotEmpty()
  branchName!: string;
}

class UpdateProjectBody {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  agentConfig?: Record<string, unknown>;
}

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async list() {
    const userId = this.usersService.getDefaultUserId();
    return this.projectsService.findAllByUser(userId);
  }

  @Post()
  async create(@Body() body: CreateProjectBody) {
    const userId = this.usersService.getDefaultUserId();
    return this.projectsService.create(userId, body);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.projectsService.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProjectBody) {
    return this.projectsService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.projectsService.remove(id);
    return { ok: true };
  }

  @Post(':id/fork')
  async fork(@Param('id') id: string, @Body() body: ForkProjectBody) {
    return this.projectsService.forkProject(id, body.branchName);
  }

  @Get(':id/forks')
  async forks(@Param('id') id: string) {
    return this.projectsService.findForkFamily(id);
  }

  /** POST /api/projects/:id/ssh-access – creates a 24h SSH access token for the sandbox */
  @Post(':id/ssh-access')
  async createSshAccess(@Param('id') id: string) {
    const project = await this.projectsService.findById(id);
    if (!project.sandboxId) {
      throw new HttpException('Sandbox not ready', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const sm = this.projectsService.getSandboxManager();
    if (!sm) {
      throw new HttpException('Sandbox manager not available', HttpStatus.SERVICE_UNAVAILABLE);
    }
    try {
      return await sm.createSshAccess(project.sandboxId);
    } catch (err) {
      throw new HttpException(
        `Failed to create SSH access: ${err}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** GET /api/projects/:id/vscode-url – returns a signed Daytona preview URL for code-server */
  @Get(':id/vscode-url')
  async getVscodeUrl(@Param('id') id: string) {
    const project = await this.projectsService.findById(id);
    if (!project.sandboxId) {
      throw new HttpException('Sandbox not ready', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const sm = this.projectsService.getSandboxManager();
    if (!sm) {
      throw new HttpException('Sandbox manager not available', HttpStatus.SERVICE_UNAVAILABLE);
    }
    try {
      const { url, token } = await sm.getVscodeUrl(project.sandboxId);
      return { url, token };
    } catch (err) {
      throw new HttpException(
        `Failed to get VS Code URL: ${err}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
