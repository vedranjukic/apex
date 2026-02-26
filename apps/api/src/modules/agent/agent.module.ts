import { Module } from '@nestjs/common';
import { AgentGateway } from './agent.gateway';
import { ProjectsModule } from '../projects/projects.module';
import { ChatsModule } from '../tasks/tasks.module';

@Module({
  imports: [ProjectsModule, ChatsModule],
  providers: [AgentGateway],
})
export class AgentModule {}
