import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

/** Job status lifecycle: accepted → in-progress → complete | error | cancelled */
export type JobStatus = 'accepted' | 'in-progress' | 'complete' | 'error' | 'cancelled';

/**
 * Mongoose schema for persistent async jobs.
 * Stores job metadata, parameters and results in a single `jobs` collection.
 * Used for bulk export, reindex and other long-running operations.
 */
@Schema({ timestamps: true, collection: 'jobs' })
export class Job extends Document {
  @Prop({ required: true, unique: true })
  jobId: string;

  @Prop({ required: true })
  jobType: string;

  @Prop({ required: true, default: 'accepted' })
  status: JobStatus;

  /** Job-specific input parameters (e.g. types, since, groupId for bulk-export). */
  @Prop({ type: Object, default: {} })
  params: Record<string, any>;

  /** Job-specific output data (e.g. NDJSON output for bulk-export). */
  @Prop({ type: Object, default: {} })
  result: Record<string, any>;

  @Prop({ default: 0 })
  progress: number;

  /** Error details for failed jobs. Named jobErrors to avoid conflict with Document.errors. */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  jobErrors: any[];

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  /** Job timeout in milliseconds. Default 5 minutes. */
  @Prop({ default: 300_000 })
  timeoutMs: number;

  /** Instance ID that claimed this job for processing. */
  @Prop()
  lockedBy?: string;

  /** Last heartbeat from the processing instance. Used to detect stalled jobs vs active processing. */
  @Prop()
  lastHeartbeat?: Date;
}

export const JobSchema: MongooseSchema = SchemaFactory.createForClass(Job);

JobSchema.index({ jobType: 1, status: 1 });
JobSchema.index({ status: 1, completedAt: 1 });
