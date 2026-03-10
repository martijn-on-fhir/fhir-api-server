import { randomUUID } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { Model } from 'mongoose';
import { FhirResource } from './fhir-resource.schema';

/**
 * Service responsible for all FHIR resource persistence operations.
 * Handles CRUD and search against the MongoDB `fhir_resources` collection.
 */
@Injectable()
export class FhirService {

  /** @param resourceModel - Mongoose model injected for the shared FhirResource collection. */
  constructor(@InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>) {}

  /**
   * Creates a new FHIR resource with a server-assigned id and meta.
   * @param resourceType - The FHIR resource type (e.g. "Patient").
   * @param body - The resource payload without id or meta.
   * @returns The persisted resource including server-assigned id, versionId and lastUpdated.
   */
  async create(resourceType: string, body: any): Promise<FhirResource> {

    const id = randomUUID();
    const now = new Date().toISOString();
    const resource = new this.resourceModel({ ...body, resourceType, id, meta: { ...body.meta, versionId: '1', lastUpdated: now } });

    return resource.save();
  }

  /**
   * Searches for resources matching the given type and FHIR search parameters.
   * @param resourceType - The FHIR resource type to search within.
   * @param params - FHIR search parameters: `_id`, `_sort`, `_count`, `_offset`.
   * @returns An object containing the matched resources and the total count (independent of `_count`).
   */
  async search(resourceType: string, params: Record<string, string>): Promise<{ resources: FhirResource[]; total: number }> {

    const filter: Record<string, any> = { resourceType };

    if (params._id) {
      filter.id = params._id;
    }

    const query = this.resourceModel.find(filter);

    if (params._sort) {
      const sortObj: Record<string, 1 | -1> = {};

      for (const field of params._sort.split(',')) {
        if (field.startsWith('-')) {
          sortObj[field.substring(1)] = -1;
        } else {
          sortObj[field] = 1;
        }
      }

      query.sort(sortObj);
    }

    const total = await this.resourceModel.countDocuments(filter).exec();
    const count = params._count ? parseInt(params._count, 10) : 100;
    query.limit(count);
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    if (offset > 0) {
      query.skip(offset);
    }

    const resources = await query.exec();

    return { resources, total };
  }

  /**
   * Retrieves a single resource by type and logical id.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @returns The matching resource.
   * @throws NotFoundException with an OperationOutcome if the resource does not exist.
   */
  async findById(resourceType: string, id: string): Promise<FhirResource> {

    const resource = await this.resourceModel.findOne({ resourceType, id }).exec();

    if (!resource) {
      throw new NotFoundException(this.createOutcome(IssueSeverity.Error, IssueType.NotFound, `${resourceType}/${id} not found`));
    }

    return resource;
  }

  /**
   * Updates an existing resource. Increments versionId and sets a new lastUpdated timestamp.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param body - The updated resource payload.
   * @returns The updated resource with incremented versionId.
   * @throws NotFoundException if the resource does not exist.
   */
  async update(resourceType: string, id: string, body: any): Promise<FhirResource> {

    const existing = await this.findById(resourceType, id);
    const currentVersion = parseInt(existing.meta.versionId, 10);
    const now = new Date().toISOString();

    return this.resourceModel.findOneAndUpdate(
      { resourceType, id },
      { ...body, resourceType, id, meta: { ...body.meta, versionId: String(currentVersion + 1), lastUpdated: now } },
      { returnDocument: 'after' },
    ).exec();
  }

  /**
   * Deletes a resource by type and logical id.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @throws NotFoundException with an OperationOutcome if the resource does not exist.
   */
  async delete(resourceType: string, id: string): Promise<void> {

    const result = await this.resourceModel.deleteOne({ resourceType, id }).exec();

    if (result.deletedCount === 0) {
      throw new NotFoundException(this.createOutcome(IssueSeverity.Error, IssueType.NotFound, `${resourceType}/${id} not found`));
    }
  }

  /**
   * Builds a FHIR OperationOutcome with a single issue.
   * @param severity - Issue severity level.
   * @param code - Issue type code.
   * @param diagnostics - Human-readable diagnostic message.
   * @returns A populated OperationOutcome instance.
   */
  /** Returns aggregated meta (profiles, tags, security) for a resource type or the whole system. */
  async getAggregatedMeta(resourceType?: string): Promise<{ profile: string[]; tag: any[]; security: any[] }> {

    const filter: Record<string, any> = resourceType ? { resourceType } : {};
    const docs = await this.resourceModel.find(filter).select('meta').lean().exec();
    const profiles = new Set<string>();
    const tagMap = new Map<string, any>();
    const securityMap = new Map<string, any>();

    for (const doc of docs) {
      for (const p of doc.meta?.profile || []) {
profiles.add(p);
}

      for (const t of doc.meta?.tag || []) {
tagMap.set(`${t.system}|${t.code}`, t);
}

      for (const s of doc.meta?.security || []) {
securityMap.set(`${s.system}|${s.code}`, s);
}
    }

    return { profile: [...profiles], tag: [...tagMap.values()], security: [...securityMap.values()] };
  }

  /** Adds profiles, tags and security labels to an existing resource's meta. Returns the updated meta. */
  async metaAdd(resourceType: string, id: string, meta: any): Promise<any> {

    const resource = await this.findById(resourceType, id);
    const current: any = resource.meta || {};
    const merged = {
      ...current,
      profile: this.mergeArrays(current.profile, meta.profile),
      tag: this.mergeCoded(current.tag, meta.tag),
      security: this.mergeCoded(current.security, meta.security),
    };

    const updated = await this.resourceModel.findOneAndUpdate({ resourceType, id }, { meta: merged }, { returnDocument: 'after' }).exec();

    return updated.meta;
  }

  /** Removes profiles, tags and security labels from an existing resource's meta. Returns the updated meta. */
  async metaDelete(resourceType: string, id: string, meta: any): Promise<any> {

    const resource = await this.findById(resourceType, id);
    const current: any = resource.meta || {};
    const profilesToRemove = new Set(meta.profile || []);
    const tagsToRemove = new Set((meta.tag || []).map((t: any) => `${t.system}|${t.code}`));
    const securityToRemove = new Set((meta.security || []).map((s: any) => `${s.system}|${s.code}`));

    const merged = {
      ...current,
      profile: (current.profile || []).filter((p: string) => !profilesToRemove.has(p)),
      tag: (current.tag || []).filter((t: any) => !tagsToRemove.has(`${t.system}|${t.code}`)),
      security: (current.security || []).filter((s: any) => !securityToRemove.has(`${s.system}|${s.code}`)),
    };

    const updated = await this.resourceModel.findOneAndUpdate({ resourceType, id }, { 'meta': merged }, { returnDocument: 'after' }).exec();

    return updated.meta;
  }

  /** Merges two string arrays, deduplicating by value. */
  private mergeArrays(existing: string[] = [], additions: string[] = []): string[] {

    const set = new Set(existing);

    for (const item of additions) {
set.add(item);
}

    return [...set];
  }

  /** Merges two coded arrays (tag/security), deduplicating by system|code. */
  private mergeCoded(existing: any[] = [], additions: any[] = []): any[] {

    const map = new Map<string, any>();

    for (const item of existing) {
map.set(`${item.system}|${item.code}`, item);
}

    for (const item of additions) {
map.set(`${item.system}|${item.code}`, item);
}

    return [...map.values()];
  }

  /** Returns all distinct resourceType values currently stored in the database. */
  async getResourceTypes(): Promise<string[]> {

    return this.resourceModel.distinct('resourceType').exec();
  }

  private createOutcome(severity: IssueSeverity, code: IssueType, diagnostics: string): OperationOutcome {
    return new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity, code, diagnostics })] });
  }
}
