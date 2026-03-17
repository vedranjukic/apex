import { Module } from '@nestjs/common';
import { AgentGateway } from './agent.gateway';
import { ProjectsModule } from '../projects/projects.module';
import { ThreadsModule } from '../tasks/tasks.module';

@Module({
  imports: [ProjectsModule, ThreadsModule],
  providers: [AgentGateway],
})
export class AgentModule {}
