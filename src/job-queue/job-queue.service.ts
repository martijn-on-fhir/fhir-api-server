import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { config } from '../config/app-config';
import { Job, JobStatus } from './job.schema';

/** How often to check for timed-out jobs (ms). */
const TIMEOUT_CHECK_INTERVAL = 60_000;

/** Default retention for completed/cancelled/error jobs (days). Configured via centralized config. */
const RETENTION_DAYS = config.jobs.retentionDays;

/**
 * Generic MongoDB-backed job queue.
 * Handles job lifecycle (create, claim, progress, complete, fail, cancel),
 * timeout detection and cleanup of old jobs.
 */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger(JobQueueService.name);
  private timeoutInterval: ReturnType<typeof setInterval>;

  constructor(@InjectModel(Job.name) private readonly jobModel: Model<Job>) {}

  onModuleInit() {
    this.timeoutInterval = setInterval(() => this.timeoutStalledJobs(), TIMEOUT_CHECK_INTERVAL);
  }

  onModuleDestroy() {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
    }
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

  /** Atomically claim a job: accepted → in-progress. Returns false if already claimed or not found. */
  async claimJob(jobId: string): Promise<boolean> {
    const result = await this.jobModel.findOneAndUpdate({ jobId, status: 'accepted' }, { $set: { status: 'in-progress', startedAt: new Date() } }).exec();

    return result !== null;
  }

  /** Update job progress and optionally merge partial results. */
  async updateProgress(jobId: string, progress: number, partialResult?: Record<string, any>): Promise<void> {
    const update: Record<string, any> = { progress };

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

  /** Find accepted jobs for a given type (used for startup recovery). */
  async findAcceptedJobs(jobType: string): Promise<Job[]> {
    return this.jobModel.find({ jobType, status: 'accepted' }).exec();
  }

  /** Timeout jobs that have been in-progress longer than their timeoutMs. */
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
