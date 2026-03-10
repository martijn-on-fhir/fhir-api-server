import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FhirResource } from '../fhir-resource.schema';
import { BulkExportJob } from './bulk-export.types';

/**
 * Service for FHIR Bulk Data Export ($export).
 * Stores jobs in-memory (POC) and processes them asynchronously via setTimeout.
 * Generates NDJSON (newline-delimited JSON) per resource type.
 */
@Injectable()
export class BulkExportService {
  private readonly logger = new Logger(BulkExportService.name);
  private readonly jobs = new Map<string, BulkExportJob>();

  constructor(@InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>) {}

  /** Create a new bulk export job and start async processing. */
  kickOff(baseUrl: string, types?: string[], since?: string, groupId?: string): BulkExportJob {
    const id = randomUUID();
    const job: BulkExportJob = {
      id, status: 'accepted', transactionTime: new Date().toISOString(),
      request: `${baseUrl}/fhir/$export`, requiresAccessToken: false,
      types, since, groupId, output: new Map(), errors: [], progress: 0, createdAt: new Date(),
    };
    this.jobs.set(id, job);
    // Fire and forget — async processing
    setTimeout(() => this.processJob(id), 0);

    return job;
  }

  getJob(id: string): BulkExportJob | undefined {
    return this.jobs.get(id);
  }

  /** Cancel a running or pending job. */
  cancelJob(id: string): void {
    const job = this.jobs.get(id);

    if (!job) {
throw new NotFoundException(`Bulk export job ${id} not found`);
}

    job.status = 'cancelled';
  }

  /** Get NDJSON data for a specific job and resource type. */
  getNdjson(jobId: string, resourceType: string): string | undefined {
    const job = this.jobs.get(jobId);

    if (!job || job.status !== 'complete') {
return undefined;
}

    return job.output.get(resourceType);
  }

  /** Main processing: query MongoDB, generate NDJSON per type. */
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);

    if (!job || job.status === 'cancelled') {
return;
}

    job.status = 'in-progress';

    try {
      // Determine which resource types to export
      let resourceTypes: string[];

      if (job.types?.length) {
        resourceTypes = job.types;
      } else {
        resourceTypes = await this.resourceModel.distinct('resourceType').exec();
      }

      // For group-level export, only include resources linked to the group's members
      let patientIds: string[] | undefined;

      if (job.groupId) {
        patientIds = await this.resolveGroupMembers(job.groupId);

        if (!patientIds) {
          job.status = 'error';
          job.errors.push({ type: 'OperationOutcome', url: '' });

          return;
        }
      }

      const totalTypes = resourceTypes.length;
      let processed = 0;

      for (const type of resourceTypes) {
        if ((job as BulkExportJob).status === 'cancelled') {
return;
}

        const filter: Record<string, any> = { resourceType: type };
        // Exclude deleted resources (soft deletes have meta.deleted = true)
        filter['meta.deleted'] = { $ne: true };

        if (job.since) {
filter['meta.lastUpdated'] = { $gte: job.since };
}

        // For group-level: filter patient-linked resources
        if (patientIds) {
          if (type === 'Patient') {
            filter.id = { $in: patientIds };
          } else {
            // Filter by subject.reference matching any of the group's patients
            const refs = patientIds.map((pid) => `Patient/${pid}`);
            filter['subject.reference'] = { $in: refs };
          }
        }

        const docs = await this.resourceModel.find(filter).lean().exec();

        if (docs.length > 0) {
          const ndjson = docs.map((doc) => {
            const { _id, __v, ...resource } = doc as any;

            return JSON.stringify(resource);
          }).join('\n');
          job.output.set(type, ndjson);
        }

        processed++;
        job.progress = Math.round((processed / totalTypes) * 100);
      }

      job.status = 'complete';
      job.completedAt = new Date();
      this.logger.log(`Bulk export ${jobId} complete: ${job.output.size} types, ${[...job.output.values()].reduce((sum, v) => sum + v.split('\n').length, 0)} resources`);
    } catch (err) {
      this.logger.error(`Bulk export ${jobId} failed: ${err.message}`, err.stack);
      job.status = 'error';
      job.errors.push({ type: 'OperationOutcome', url: '' });
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
}
