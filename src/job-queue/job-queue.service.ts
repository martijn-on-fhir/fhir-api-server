import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { config } from '../config/app-config';
import { Job, JobStatus } from './job.schema';

/** How often to check for timed-out and reclaimable jobs (ms). */
const TIMEOUT_CHECK_INTERVAL = 60_000;

/** How often to poll for unclaimed jobs (ms). */
const POLL_INTERVAL = 5_000;

/** A job is considered stalled if no heartbeat for this many ms. */
const HEARTBEAT_STALE_MS = 120_000;

/** Default retention for completed/cancelled/error jobs (days). Configured via centralized config. */
const RETENTION_DAYS = config.jobs.retentionDays;

/**
 * Generic MongoDB-backed job queue with stateless, cross-instance support.
 * Handles job lifecycle (create, claim, progress, complete, fail, cancel),
 * heartbeat tracking, stalled job reclamation, timeout detection and cleanup.
 * Any instance can pick up and process unclaimed jobs via polling.
 */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger(JobQueueService.name);
  /** Unique identifier for this server instance, used for job locking. */
  private readonly instanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private timeoutInterval: ReturnType<typeof setInterval>;
  private pollInterval: ReturnType<typeof setInterval>;
  /** Registered processors keyed by jobType. */
  private readonly processors = new Map<string, (jobId: string) => Promise<void>>();

  constructor(@InjectModel(Job.name) private readonly jobModel: Model<Job>) {}

  onModuleInit() {
    this.timeoutInterval = setInterval(() => this.timeoutStalledJobs(), TIMEOUT_CHECK_INTERVAL);
    this.pollInterval = setInterval(() => this.pollForJobs(), POLL_INTERVAL);
    this.logger.log(`Job queue started (instance: ${this.instanceId})`);
  }

  onModuleDestroy() {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  /**
   * Registers a processor function for a specific job type.
   * The processor will be called whenever an unclaimed job of this type is found.
   * @param jobType - The job type to process (e.g. 'bulk-export').
   * @param processor - Async function that processes the job.
   */
  registerProcessor(jobType: string, processor: (jobId: string) => Promise<void>): void {
    this.processors.set(jobType, processor);
    this.logger.log(`Registered processor for job type: ${jobType}`);
  }

  /** Create a new job with status 'accepted'. */
  async createJob(jobType: string, params: Record<string, any> = {}, timeoutMs = 300_000): Promise<Job> {
    const job = await this.jobModel.create({ jobId: randomUUID(), jobType, status: 'accepted' as JobStatus, params, timeoutMs });
    this.logger.log(`Job created: ${job.jobId} (${jobType})`);

    return job;
  }

  /** Find a job by jobId. */
  async getJob(jobId: string): Promise<Job | null> {
    return this.jobModel.findOne({ jobId }).exec();
  }

  /** Atomically claim a job: accepted → in-progress with lock. Returns false if already claimed. */
  async claimJob(jobId: string): Promise<boolean> {
    const result = await this.jobModel.findOneAndUpdate(
      { jobId, status: 'accepted' },
      { $set: { status: 'in-progress', startedAt: new Date(), lockedBy: this.instanceId, lastHeartbeat: new Date() } },
    ).exec();

    return result !== null;
  }

  /** Updates the heartbeat timestamp for an in-progress job to prevent false timeout. */
  async heartbeat(jobId: string): Promise<void> {
    await this.jobModel.updateOne({ jobId, status: 'in-progress' }, { $set: { lastHeartbeat: new Date() } }).exec();
  }

  /** Update job progress and optionally merge partial results. */
  async updateProgress(jobId: string, progress: number, partialResult?: Record<string, any>): Promise<void> {
    const update: Record<string, any> = { progress, lastHeartbeat: new Date() };

    if (partialResult) {
      for (const [key, value] of Object.entries(partialResult)) {
        update[`result.${key}`] = value;
      }
    }

    await this.jobModel.updateOne({ jobId }, { $set: update }).exec();
  }

  /** Mark a job as complete with final result data. */
  async completeJob(jobId: string, result: Record<string, any>): Promise<void> {
    await this.jobModel.updateOne({ jobId }, { $set: { status: 'complete', result, progress: 100, completedAt: new Date() } }).exec();
    this.logger.log(`Job completed: ${jobId}`);
  }

  /** Mark a job as failed with error details. */
  async failJob(jobId: string, jobErrors: any[]): Promise<void> {
    await this.jobModel.updateOne({ jobId }, { $set: { status: 'error', jobErrors, completedAt: new Date() } }).exec();
    this.logger.warn(`Job failed: ${jobId}`);
  }

  /** Atomically cancel a job. Returns false if job is already in a terminal state. */
  async cancelJob(jobId: string): Promise<boolean> {
    const result = await this.jobModel.findOneAndUpdate({ jobId, status: { $in: ['accepted', 'in-progress'] } }, { $set: { status: 'cancelled', completedAt: new Date() } }).exec();

    return result !== null;
  }

  /** Check if a job has been cancelled (used during processing to bail out early). */
  async isCancelled(jobId: string): Promise<boolean> {
    const job = await this.jobModel.findOne({ jobId }, { status: 1 }).lean().exec();

    return job?.status === 'cancelled';
  }

  /** Count active (accepted or in-progress) jobs of a given type. */
  async countActiveJobs(jobType: string): Promise<number> {
    return this.jobModel.countDocuments({ jobType, status: { $in: ['accepted', 'in-progress'] } }).exec();
  }

  /** Polls for unclaimed jobs and dispatches them to registered processors. */
  private async pollForJobs(): Promise<void> {
    for (const [jobType, processor] of this.processors) {
      const job = await this.jobModel.findOneAndUpdate(
        { jobType, status: 'accepted' },
        { $set: { status: 'in-progress', startedAt: new Date(), lockedBy: this.instanceId, lastHeartbeat: new Date() } },
      ).exec();

      if (job) {
        this.logger.log(`Claimed job ${job.jobId} (${jobType}) on instance ${this.instanceId}`);
        processor(job.jobId).catch((err) => {
          this.logger.error(`Processor error for job ${job.jobId}: ${err.message}`);
          this.failJob(job.jobId, [{ type: 'OperationOutcome', diagnostics: err.message }]);
        });
      }
    }

    // Reclaim stalled jobs (in-progress but no heartbeat for HEARTBEAT_STALE_MS)
    const staleCutoff = new Date(Date.now() - HEARTBEAT_STALE_MS);

    for (const [jobType] of this.processors) {
      const stalled = await this.jobModel.findOneAndUpdate(
        { jobType, status: 'in-progress', lastHeartbeat: { $lt: staleCutoff } },
        { $set: { status: 'accepted', lockedBy: null, lastHeartbeat: null, startedAt: null } },
      ).exec();

      if (stalled) {
        this.logger.warn(`Reclaimed stalled job ${stalled.jobId} (no heartbeat since ${staleCutoff.toISOString()})`);
      }
    }
  }

  /** Timeout jobs that have been in-progress longer than their timeoutMs (with recent heartbeat). */
  private async timeoutStalledJobs(): Promise<void> {
    const now = Date.now();
    const stalledJobs = await this.jobModel.find({ status: 'in-progress', startedAt: { $exists: true } }).lean().exec();

    for (const job of stalledJobs) {
      if (job.startedAt && now - job.startedAt.getTime() > job.timeoutMs) {
        await this.jobModel.updateOne({ jobId: job.jobId, status: 'in-progress' }, { $set: { status: 'error', completedAt: new Date(), jobErrors: [{ type: 'OperationOutcome', diagnostics: `Job timed out after ${job.timeoutMs}ms` }] } }).exec();
        this.logger.warn(`Job timed out: ${job.jobId} (${job.jobType})`);
      }
    }

    // Cleanup old completed jobs
    const cutoff = new Date(now - RETENTION_DAYS * 86_400_000);
    const deleted = await this.jobModel.deleteMany({ status: { $in: ['complete', 'error', 'cancelled'] }, completedAt: { $lt: cutoff } }).exec();

    if (deleted.deletedCount > 0) {
      this.logger.log(`Cleaned up ${deleted.deletedCount} old jobs`);
    }
  }
}
