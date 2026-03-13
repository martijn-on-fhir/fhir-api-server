import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobQueueService } from './job-queue.service';
import { Job, JobSchema } from './job.schema';

/** Persistent MongoDB-backed job queue for async operations (bulk export, reindex, etc.). */
@Module({
  imports: [MongooseModule.forFeature([{ name: Job.name, schema: JobSchema }])],
  providers: [JobQueueService],
  exports: [JobQueueService],
})
export class JobQueueModule {}
