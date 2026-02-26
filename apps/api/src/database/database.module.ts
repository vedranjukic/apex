import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { ProjectEntity } from './entities/project.entity';
import { TaskEntity } from './entities/task.entity';
import { MessageEntity } from './entities/message.entity';
import { SettingEntity } from '../modules/settings/setting.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH || 'data/apex.sqlite',
      entities: [UserEntity, ProjectEntity, TaskEntity, MessageEntity, SettingEntity],
      synchronize: true,
    }),
  ],
})
export class DatabaseModule {}
