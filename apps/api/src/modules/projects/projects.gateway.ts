import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { ProjectEntity } from '../../database/entities/project.entity';

@WebSocketGateway({
  namespace: '/ws/projects',
  path: '/ws/socket.io',
  cors: { origin: '*' },
})
export class ProjectsGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ProjectsGateway.name);

  afterInit() {
    this.logger.log('ProjectsGateway initialized');
  }

  notifyCreated(project: ProjectEntity) {
    this.server.emit('project_created', project);
  }

  notifyUpdated(project: ProjectEntity) {
    this.server.emit('project_updated', project);
  }

  notifyDeleted(projectId: string) {
    this.server.emit('project_deleted', { id: projectId });
  }
}
