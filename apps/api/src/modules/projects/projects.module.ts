import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../../database/entities/project.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ProjectsGateway } from './projects.gateway';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectEntity]),
    UsersModule,
    forwardRef(() => SettingsModule),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsGateway],
  exports: [ProjectsService, ProjectsGateway],
})
export class ProjectsModule {}
