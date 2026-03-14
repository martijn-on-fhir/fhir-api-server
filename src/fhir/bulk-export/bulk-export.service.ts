import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, HttpException } from '@nestjs/common';
import { Model } from 'mongoose';
import { config } from '../../config/app-config';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { FhirResource } from '../fhir-resource.schema';
import { FHIR_RESOURCE_MODEL } from '../fhir.constants';
import { BulkExportJob } from './bulk-export.types';

/** Maximum concurrent bulk export jobs. Configured via centralized config. */
const MAX_CONCURRENT_EXPORTS = config.bulkExport.maxConcurrent;

/** Bulk export job timeout in ms. Configured via centralized config. Default 10 minutes. */
const EXPORT_TIMEOUT_MS = config.bulkExport.timeoutMs;

/**
 * Service for FHIR Bulk Data Export ($export).
 * Uses the persistent JobQueueService for job storage and lifecycle management.
 * Jobs survive server restarts and are automatically recovered.
 */
@Injectable()
export class BulkExportService implements OnModuleInit {
  private readonly logger = new Logger(BulkExportService.name);

  constructor(@Inject(FHIR_RESOURCE_MODEL) private readonly resourceModel: Model<FhirResource>, private readonly jobQueue: JobQueueService) {}

  /** On startup, recover any accepted jobs that were not yet processed. */
  async onModuleInit(): Promise<void> {
    const pendingJobs = await this.jobQueue.findAcceptedJobs('bulk-export');

    for (const job of pendingJobs) {
      this.logger.log(`Recovering bulk export job ${job.jobId}`);
      setImmediate(() => this.processJob(job.jobId));
    }
  }

  /** Create a new bulk export job and start async processing. */
  async kickOff(baseUrl: string, types?: string[], since?: string, groupId?: string): Promise<BulkExportJob> {
    const active = await this.jobQueue.countActiveJobs('bulk-export');

    if (active >= MAX_CONCURRENT_EXPORTS) {
      throw new HttpException('Too many concurrent export jobs. Please try again later.', 429);
    }

    const params = { transactionTime: new Date().toISOString(), request: `${baseUrl}/fhir/$export`, requiresAccessToken: false, types, since, groupId };
    const job = await this.jobQueue.createJob('bulk-export', params, EXPORT_TIMEOUT_MS);

    setImmediate(() => this.processJob(job.jobId));

    return this.toExportJob(job);
  }

  /** Get a bulk export job by id. */
  async getJob(id: string): Promise<BulkExportJob | undefined> {
    const job = await this.jobQueue.getJob(id);

    return job ? this.toExportJob(job) : undefined;
  }

  /** Cancel a running or pending bulk export job. */
  async cancelJob(id: string): Promise<void> {
    const cancelled = await this.jobQueue.cancelJob(id);

    if (!cancelled) {
      throw new NotFoundException(`Bulk export job ${id} not found or already completed`);
    }
  }

  /** Get NDJSON data for a specific job and resource type. */
  async getNdjson(jobId: string, resourceType: string): Promise<string | undefined> {
    const job = await this.jobQueue.getJob(jobId);

    if (!job || job.status !== 'complete') {
      return undefined;
    }

    return job.result?.output?.[resourceType];
  }

  /** Main processing: query MongoDB, generate NDJSON per type. */
  private async processJob(jobId: string): Promise<void> {
    const claimed = await this.jobQueue.claimJob(jobId);

    if (!claimed) {
      return;
    }

    const job = await this.jobQueue.getJob(jobId);

    if (!job) {
      return;
    }

    try {
      const { types, since, groupId } = job.params;

      let resourceTypes: string[];

      if (types?.length) {
        resourceTypes = types;
      } else {
        resourceTypes = await this.resourceModel.distinct('resourceType').exec();
      }

      let patientIds: string[] | undefined;

      if (groupId) {
        patientIds = await this.resolveGroupMembers(groupId);

        if (!patientIds) {
          await this.jobQueue.failJob(jobId, [{ type: 'OperationOutcome', diagnostics: `Group ${groupId} not found` }]);

          return;
        }
      }

      const totalTypes = resourceTypes.length;
      const output: Record<string, string> = {};
      let processed = 0;

      for (const type of resourceTypes) {
        // Check for cancellation periodically
        if (await this.jobQueue.isCancelled(jobId)) {
          return;
        }

        const filter: Record<string, any> = { resourceType: type, 'meta.deleted': { $ne: true } };

        if (since) {
          filter['meta.lastUpdated'] = { $gte: since };
        }

        if (patientIds) {
          if (type === 'Patient') {
            filter.id = { $in: patientIds };
          } else {
            filter['subject.reference'] = { $in: patientIds.map((pid) => `Patient/${pid}`) };
          }
        }

        const docs = await this.resourceModel.find(filter).lean().exec();

        if (docs.length > 0) {
          output[type] = docs.map((doc) => {
 const { _id, __v, ...resource } = doc as any;

 return JSON.stringify(resource); 
}).join('\n');
        }

        processed++;
        await this.jobQueue.updateProgress(jobId, Math.round((processed / totalTypes) * 100));
      }

      await this.jobQueue.completeJob(jobId, { output });
      const totalResources = Object.values(output).reduce((sum, v) => sum + v.split('\n').length, 0);
      this.logger.log(`Bulk export ${jobId} complete: ${Object.keys(output).length} types, ${totalResources} resources`);
    } catch (err) {
      this.logger.error(`Bulk export ${jobId} failed: ${(err as Error).message}`, (err as Error).stack);
      await this.jobQueue.failJob(jobId, [{ type: 'OperationOutcome', diagnostics: (err as Error).message }]);
    }
  }

  /** Resolve Group members to a list of Patient IDs. */
  private async resolveGroupMembers(groupId: string): Promise<string[] | undefined> {
    const group = await this.resourceModel.findOne({ resourceType: 'Group', id: groupId, 'meta.deleted': { $ne: true } }).lean().exec() as any;

    if (!group) {
      return undefined;
    }

    return (group.member || []).map((m: any) => m.entity?.reference?.replace('Patient/', '')).filter(Boolean);
  }

  /** Map a Job document to the BulkExportJob interface. */
  private toExportJob(job: any): BulkExportJob {
    return {
      id: job.jobId, status: job.status, progress: job.progress, errors: job.jobErrors || [],
      transactionTime: job.params?.transactionTime || '', request: job.params?.request || '',
      requiresAccessToken: job.params?.requiresAccessToken || false,
      types: job.params?.types, since: job.params?.since, groupId: job.params?.groupId,
      output: job.result?.output || {}, createdAt: job.createdAt, completedAt: job.completedAt,
    };
  }
}
