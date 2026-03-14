import { Readable } from 'stream';
import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, HttpException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { config } from '../../config/app-config';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { FhirResource } from '../fhir-resource.schema';
import { FHIR_RESOURCE_MODEL } from '../fhir.constants';
import { BulkExportJob } from './bulk-export.types';

/** Maximum concurrent bulk export jobs. Configured via centralized config. */
const MAX_CONCURRENT_EXPORTS = config.bulkExport.maxConcurrent;

/** Bulk export job timeout in ms. Configured via centralized config. Default 10 minutes. */
const EXPORT_TIMEOUT_MS = config.bulkExport.timeoutMs;

/** Heartbeat interval during processing (ms). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Service for FHIR Bulk Data Export ($export).
 * Uses the persistent JobQueueService for job storage and lifecycle management.
 * NDJSON output is stored in MongoDB GridFS for cross-instance access and to avoid the 16MB document limit.
 * Jobs are picked up by any instance via polling — no single-instance dependency.
 */
@Injectable()
export class BulkExportService implements OnModuleInit {
  private readonly logger = new Logger(BulkExportService.name);
  private gridFSBucket: mongoose.mongo.GridFSBucket;

  constructor(
    @Inject(FHIR_RESOURCE_MODEL) private readonly resourceModel: Model<FhirResource>,
    private readonly jobQueue: JobQueueService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Register as job processor so the polling-based queue picks up bulk-export jobs. */
  async onModuleInit(): Promise<void> {
    this.gridFSBucket = new mongoose.mongo.GridFSBucket(this.connection.db as any, { bucketName: 'bulk_export' });
    this.jobQueue.registerProcessor('bulk-export', (jobId) => this.processJob(jobId));
  }

  /** Create a new bulk export job. Processing starts automatically via queue polling. */
  async kickOff(baseUrl: string, types?: string[], since?: string, groupId?: string): Promise<BulkExportJob> {
    const active = await this.jobQueue.countActiveJobs('bulk-export');

    if (active >= MAX_CONCURRENT_EXPORTS) {
      throw new HttpException('Too many concurrent export jobs. Please try again later.', 429);
    }

    const params = { transactionTime: new Date().toISOString(), request: `${baseUrl}/fhir/$export`, requiresAccessToken: false, types, since, groupId };
    const job = await this.jobQueue.createJob('bulk-export', params, EXPORT_TIMEOUT_MS);

    // Process immediately on this instance (polling is fallback for cross-instance recovery)
    setImmediate(() => this.processJob(job.jobId).catch((err) => {
      this.logger.error(`Immediate processing failed for ${job.jobId}: ${err.message}`);
    }));

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

  /** Get NDJSON data for a specific job and resource type from GridFS. */
  async getNdjson(jobId: string, resourceType: string): Promise<string | undefined> {
    const job = await this.jobQueue.getJob(jobId);

    if (!job || job.status !== 'complete') {
      return undefined;
    }

    // Check if output is stored in GridFS (new) or inline (legacy)
    if (job.result?.gridfsFiles?.[resourceType]) {
      return this.readFromGridFS(job.result.gridfsFiles[resourceType]);
    }

    // Legacy: inline NDJSON in job document
    return job.result?.output?.[resourceType];
  }

  /** Main processing: query MongoDB with cursor streaming, generate NDJSON per type, store in GridFS. */
  private async processJob(jobId: string): Promise<void> {
    // Try to claim if still in accepted state (idempotent — fails silently if already claimed by poller)
    await this.jobQueue.claimJob(jobId);

    const job = await this.jobQueue.getJob(jobId);

    if (!job || job.status !== 'in-progress') {
      return;
    }

    // Start heartbeat to prevent false timeouts
    const heartbeatTimer = setInterval(() => this.jobQueue.heartbeat(jobId), HEARTBEAT_INTERVAL_MS);

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
      const gridfsFiles: Record<string, string> = {};
      const outputCounts: Record<string, number> = {};
      let processed = 0;

      for (const type of resourceTypes) {
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

        // Stream with cursor to avoid loading all documents into memory
        const cursor = this.resourceModel.find(filter).lean().cursor();
        const filename = `${jobId}/${type}.ndjson`;
        let count = 0;
        const lines: string[] = [];

        for await (const doc of cursor) {
          const { _id, __v, ...resource } = doc as any;
          lines.push(JSON.stringify(resource));
          count++;
        }

        if (count > 0) {
          await this.writeToGridFS(filename, lines.join('\n'));
          gridfsFiles[type] = filename;
          outputCounts[type] = count;
        }

        processed++;
        await this.jobQueue.updateProgress(jobId, Math.round((processed / totalTypes) * 100));
      }

      await this.jobQueue.completeJob(jobId, { gridfsFiles, outputCounts });
      const totalResources = Object.values(outputCounts).reduce((sum, v) => sum + v, 0);
      this.logger.log(`Bulk export ${jobId} complete: ${Object.keys(gridfsFiles).length} types, ${totalResources} resources (GridFS)`);
    } catch (err) {
      this.logger.error(`Bulk export ${jobId} failed: ${(err as Error).message}`, (err as Error).stack);
      await this.jobQueue.failJob(jobId, [{ type: 'OperationOutcome', diagnostics: (err as Error).message }]);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  /** Write NDJSON content to GridFS. */
  private async writeToGridFS(filename: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const uploadStream = this.gridFSBucket.openUploadStream(filename);
      const readable = Readable.from([content]);
      readable.pipe(uploadStream);
      uploadStream.on('finish', resolve);
      uploadStream.on('error', reject);
    });
  }

  /** Read NDJSON content from GridFS. */
  private async readFromGridFS(filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const downloadStream = this.gridFSBucket.openDownloadStreamByName(filename);
      downloadStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      downloadStream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      downloadStream.on('error', reject);
    });
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
      output: job.result?.output || {}, outputCounts: job.result?.outputCounts || {},
      gridfsFiles: job.result?.gridfsFiles || {},
      createdAt: job.createdAt, completedAt: job.completedAt,
    };
  }
}
