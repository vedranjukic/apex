import { Module } from '@nestjs/common';
import { ConfigAppController } from './config-app.controller';

@Module({
  controllers: [ConfigAppController],
})
export class ConfigAppModule {}
