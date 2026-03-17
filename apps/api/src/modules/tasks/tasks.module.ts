import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../../database/entities/task.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { ThreadsService } from './tasks.service';
import { ThreadsController } from './tasks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity, MessageEntity])],
  controllers: [ThreadsController],
  providers: [ThreadsService],
  exports: [ThreadsService],
})
export class ThreadsModule {}
