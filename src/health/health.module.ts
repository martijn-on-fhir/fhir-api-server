import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MongodbProfilerService } from './mongodb-profiler.service';

@Module({
  controllers: [HealthController],
  providers: [MongodbProfilerService],
})
export class HealthModule {}
