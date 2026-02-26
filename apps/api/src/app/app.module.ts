import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../modules/users/users.module';
import { ProjectsModule } from '../modules/projects/projects.module';
import { ChatsModule } from '../modules/tasks/tasks.module';
import { AgentModule } from '../modules/agent/agent.module';
import { ConfigAppModule } from '../modules/config/config-app.module';
import { SettingsModule } from '../modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: process.env.DASHBOARD_DIR || join(__dirname, '../../dashboard/dist'),
      exclude: ['/api/{*path}', '/ws/{*path}'],
    }),
    DatabaseModule,
    SettingsModule,
    UsersModule,
    ProjectsModule,
    ChatsModule,
    AgentModule,
    ConfigAppModule,
  ],
})
export class AppModule {}
