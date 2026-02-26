import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../../database/entities/task.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { ChatsService } from './tasks.service';
import { ChatsController } from './tasks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity, MessageEntity])],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
