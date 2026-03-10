import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, GoneException, ConflictException, PreconditionFailedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { Model, ClientSession } from 'mongoose';
import { FhirResourceHistory } from './fhir-resource-history.schema';
import { FhirResource } from './fhir-resource.schema';
import { ChainingService } from './search/chaining.service';
import { IncludeService } from './search/include.service';
import { QueryBuilderService } from './search/query-builder.service';
import { sanitizeValue } from './search/sanitize';
import { SearchParameterRegistry } from './search/search-parameter-registry.service';
import { FhirResourceEvent } from './subscriptions/subscription.types';

/**
 * Service responsible for all FHIR resource persistence operations.
 * Handles CRUD, search, version history and meta operations against MongoDB.
 */
@Injectable()
export class FhirService {

  constructor(
    @InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>,
    @InjectModel(FhirResourceHistory.name) private readonly historyModel: Model<FhirResourceHistory>,
    private readonly queryBuilder: QueryBuilderService, private readonly searchRegistry: SearchParameterRegistry,
    private readonly includeService: IncludeService, private readonly chainingService: ChainingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Creates a new FHIR resource with a server-assigned id and meta.
   * Also writes the initial version to the history collection.
   */
  async create(resourceType: string, body: any, session?: ClientSession): Promise<FhirResource> {

    const id = randomUUID();
    const now = new Date().toISOString();
    const meta = { ...body.meta, versionId: '1', lastUpdated: now };
    const resource = new this.resourceModel({ ...body, resourceType, id, meta });
    const saved = await resource.save({ session });

    // Write version 1 to history
    const snapshot = this.toPlainResource(saved);
    await new this.historyModel({ ...snapshot, request: { method: 'POST', url: resourceType }, response: { status: '201 Created', etag: `W/"1"`, lastModified: now } }).save({ session });

    this.emitResourceEvent('create', resourceType, id, snapshot);

    return saved;
  }

  /**
   * Searches for resources matching the given type and FHIR search parameters.
   */
  async search(resourceType: string, params: Record<string, string>): Promise<{ resources: FhirResource[]; total: number; included: FhirResource[] }> {

    const filter = this.queryBuilder.buildFilter(resourceType, params);

    // Resolve chained search params and _has reverse chaining
    const [chainConditions, hasConditions] = await Promise.all([
      this.chainingService.resolveChainedParams(resourceType, params),
      this.chainingService.resolveHasParams(resourceType, params),
    ]);

    const extraConditions = [...chainConditions, ...hasConditions].filter((c) => !('_impossible' in c));

    // If any chain/has resolved to impossible (no matches), return empty
    if ([...chainConditions, ...hasConditions].some((c) => '_impossible' in c)) {
      return { resources: [], total: 0, included: [] };
    }

    if (extraConditions.length > 0) {
      const existing = filter.$and || [];
      filter.$and = [...existing, ...extraConditions];
    }

    const query = this.resourceModel.find(filter);

    // Sort: resolve FHIR parameter names to MongoDB paths via registry
    if (params._sort) {
      const sortObj: Record<string, 1 | -1> = {};

      for (const field of params._sort.split(',')) {
        const descending = field.startsWith('-');
        const paramCode = descending ? field.substring(1) : field;
        const resolved = this.searchRegistry.resolvePaths(resourceType, paramCode);
        const mongoPath = resolved?.paths[0] || paramCode;
        sortObj[mongoPath] = descending ? -1 : 1;
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

    // Resolve _include and _revinclude
    const included = await this.includeService.resolveIncludes(resources, resourceType, params);

    return { resources, total, included };
  }

  /**
   * Retrieves a single resource by type and logical id.
   * @throws NotFoundException if the resource does not exist.
   */
  async findById(resourceType: string, id: string): Promise<FhirResource> {

    const resource = await this.resourceModel.findOne({ resourceType, id }).exec();

    if (!resource) {
      throw new NotFoundException(this.createOutcome(IssueSeverity.Error, IssueType.NotFound, `${resourceType}/${id} not found`));
    }

    return resource;
  }

  /**
   * FHIR vRead: retrieves a specific version of a resource from history.
   * @throws NotFoundException if the version does not exist.
   * @throws GoneException if the version is a deleted tombstone.
   */
  async vRead(resourceType: string, id: string, versionId: string): Promise<any> {

    const entry = await this.historyModel.findOne({ resourceType, id, 'meta.versionId': versionId }).lean().exec();

    if (!entry) {
      throw new NotFoundException(this.createOutcome(IssueSeverity.Error, IssueType.NotFound, `${resourceType}/${id}/_history/${versionId} not found`));
    }

    if ((entry as any)._deleted) {
      throw new GoneException(this.createOutcome(IssueSeverity.Error, IssueType.Deleted, `${resourceType}/${id} was deleted at version ${versionId}`));
    }

    // Strip history-specific fields, return clean FHIR resource
    const { _id, __v, request: _req, response: _resp, _deleted: _del, ...resource } = entry as any;

    return resource;
  }

  /**
   * Returns version history for a specific resource instance.
   * Returns entries sorted by lastUpdated descending with Bundle-compatible request/response.
   */
  async instanceHistory(resourceType: string, id: string, params: Record<string, string>): Promise<{ entries: any[]; total: number }> {

    const filter: Record<string, any> = { resourceType, id };

    if (params._since) {
filter['meta.lastUpdated'] = { $gte: sanitizeValue(params._since) };
}

    if (params._at) {
filter['meta.lastUpdated'] = { $eq: sanitizeValue(params._at) };
}

    const total = await this.historyModel.countDocuments(filter).exec();
    const count = params._count ? parseInt(params._count, 10) : 100;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    const entries = await this.historyModel.find(filter).sort({ 'meta.lastUpdated': -1 }).skip(offset).limit(count).lean().exec();

    return { entries, total };
  }

  /**
   * Returns version history for all resources of a given type.
   */
  async typeHistory(resourceType: string, params: Record<string, string>): Promise<{ entries: any[]; total: number }> {

    const filter: Record<string, any> = { resourceType };

    if (params._since) {
filter['meta.lastUpdated'] = { $gte: sanitizeValue(params._since) };
}

    if (params._at) {
filter['meta.lastUpdated'] = { $eq: sanitizeValue(params._at) };
}

    const total = await this.historyModel.countDocuments(filter).exec();
    const count = params._count ? parseInt(params._count, 10) : 100;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    const entries = await this.historyModel.find(filter).sort({ 'meta.lastUpdated': -1 }).skip(offset).limit(count).lean().exec();

    return { entries, total };
  }

  /**
   * Returns version history across all resource types (system-level).
   */
  async systemHistory(params: Record<string, string>): Promise<{ entries: any[]; total: number }> {

    const filter: Record<string, any> = {};

    if (params._since) {
filter['meta.lastUpdated'] = { $gte: sanitizeValue(params._since) };
}

    if (params._at) {
filter['meta.lastUpdated'] = { $eq: sanitizeValue(params._at) };
}

    const total = await this.historyModel.countDocuments(filter).exec();
    const count = params._count ? parseInt(params._count, 10) : 100;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    const entries = await this.historyModel.find(filter).sort({ 'meta.lastUpdated': -1 }).skip(offset).limit(count).lean().exec();

    return { entries, total };
  }

  /**
   * Updates an existing resource. Increments versionId and sets a new lastUpdated timestamp.
   * Writes both the pre-update and new version to history.
   */
  async update(resourceType: string, id: string, body: any, session?: ClientSession): Promise<FhirResource> {

    const existing = await this.findById(resourceType, id);
    const currentVersion = parseInt(existing.meta.versionId, 10);
    const now = new Date().toISOString();
    const newVersionId = String(currentVersion + 1);

    const updated = await this.resourceModel.findOneAndUpdate(
      { resourceType, id },
      { ...body, resourceType, id, meta: { ...body.meta, versionId: newVersionId, lastUpdated: now } },
      { returnDocument: 'after', session },
    ).exec();

    // Write new version to history
    const snapshot = this.toPlainResource(updated);
    await new this.historyModel({ ...snapshot, request: { method: 'PUT', url: `${resourceType}/${id}` }, response: { status: '200 OK', etag: `W/"${newVersionId}"`, lastModified: now } }).save({ session });

    this.emitResourceEvent('update', resourceType, id, snapshot);

    return updated;
  }

  /**
   * Deletes a resource by type and logical id.
   * Writes a tombstone entry to history before removing from the main collection.
   */
  async delete(resourceType: string, id: string, session?: ClientSession): Promise<void> {

    const existing = await this.resourceModel.findOne({ resourceType, id }).exec();

    if (!existing) {
      throw new NotFoundException(this.createOutcome(IssueSeverity.Error, IssueType.NotFound, `${resourceType}/${id} not found`));
    }

    const currentVersion = parseInt(existing.meta.versionId, 10);
    const now = new Date().toISOString();
    const deleteVersionId = String(currentVersion + 1);

    // Write tombstone to history
    await new this.historyModel({
      resourceType, id, meta: { versionId: deleteVersionId, lastUpdated: now, profile: existing.meta.profile, tag: existing.meta.tag, security: existing.meta.security },
      request: { method: 'DELETE', url: `${resourceType}/${id}` }, response: { status: '204 No Content' }, _deleted: true,
    }).save({ session });

    await this.resourceModel.deleteOne({ resourceType, id }, { session }).exec();

    this.emitResourceEvent('delete', resourceType, id, null);
  }

  /**
   * Conditional create: only creates if no existing resource matches the search criteria.
   * Uses the If-None-Exist header value as search params.
   * @returns { resource, created } — created=true if new, false if existing match found.
   * @throws ConflictException if multiple matches found.
   */
  async conditionalCreate(resourceType: string, body: any, searchParams: Record<string, string>, session?: ClientSession): Promise<{ resource: FhirResource; created: boolean }> {

    const filter = this.queryBuilder.buildFilter(resourceType, searchParams);
    const matches = await this.resourceModel.find(filter).limit(2).exec();

    if (matches.length === 1) {
      return { resource: matches[0], created: false };
    }

    if (matches.length > 1) {
      throw new ConflictException(this.createOutcome(IssueSeverity.Error, IssueType.Duplicate, `Conditional create matched ${matches.length} resources — cannot determine which to return`));
    }

    const resource = await this.create(resourceType, body, session);

    return { resource, created: true };
  }

  /**
   * Conditional update: PUT /ResourceType?search-params
   * Creates if 0 matches, updates if 1 match, errors if multiple matches.
   * @returns { resource, created } — created=true if new resource was created.
   * @throws ConflictException if multiple matches found.
   */
  async conditionalUpdate(resourceType: string, body: any, searchParams: Record<string, string>, session?: ClientSession): Promise<{ resource: FhirResource; created: boolean }> {

    const filter = this.queryBuilder.buildFilter(resourceType, searchParams);
    const matches = await this.resourceModel.find(filter).limit(2).exec();

    if (matches.length > 1) {
      throw new ConflictException(this.createOutcome(IssueSeverity.Error, IssueType.Duplicate, `Conditional update matched ${matches.length} resources — cannot determine which to update`));
    }

    if (matches.length === 1) {
      const resource = await this.update(resourceType, matches[0].id, body, session);

      return { resource, created: false };
    }

    // No match → create
    const resource = await this.create(resourceType, body, session);

    return { resource, created: true };
  }

  /**
   * Conditional delete: DELETE /ResourceType?search-params
   * Deletes all matching resources (FHIR allows single or multiple conditional delete).
   * @returns The number of deleted resources.
   */
  async conditionalDelete(resourceType: string, searchParams: Record<string, string>, session?: ClientSession): Promise<number> {

    const filter = this.queryBuilder.buildFilter(resourceType, searchParams);
    const matches = await this.resourceModel.find(filter).exec();

    for (const match of matches) {
      await this.delete(resourceType, match.id, session);
    }

    return matches.length;
  }

  /**
   * Checks If-Match header against current resource version for optimistic locking.
   * @throws PreconditionFailedException if the version doesn't match.
   */
  async checkIfMatch(resourceType: string, id: string, ifMatch: string): Promise<void> {

    const resource = await this.findById(resourceType, id);
    const currentEtag = `W/"${resource.meta.versionId}"`;

    if (ifMatch !== currentEtag) {
      throw new PreconditionFailedException(this.createOutcome(IssueSeverity.Error, IssueType.Conflict, `Version conflict: current is ${currentEtag}, request has ${ifMatch}`));
    }
  }

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

  /** Converts a Mongoose document to a plain object without MongoDB internals. */
  private toPlainResource(doc: any): any {

    const obj = doc.toObject ? doc.toObject() : doc;
    const { _id, __v, ...resource } = obj;

    return resource;
  }

  /** Emits a fhir.resource.changed event for subscription evaluation. */
  private emitResourceEvent(action: FhirResourceEvent['action'], resourceType: string, id: string, resource: any): void {
    this.eventEmitter.emit('fhir.resource.changed', { action, resourceType, id, resource } as FhirResourceEvent);
  }

  private createOutcome(severity: IssueSeverity, code: IssueType, diagnostics: string): OperationOutcome {
    return new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity, code, diagnostics })] });
  }
}
