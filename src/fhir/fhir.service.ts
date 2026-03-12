import {randomUUID} from 'crypto';
import {Injectable, NotFoundException, GoneException, ConflictException, PreconditionFailedException, BadRequestException} from '@nestjs/common';
import {EventEmitter2} from '@nestjs/event-emitter';
import {InjectModel} from '@nestjs/mongoose';
import * as jsonpatch from 'fast-json-patch';
import {OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType} from 'fhir-models-r4';
import {Model, ClientSession} from 'mongoose';
import {FhirResourceHistory} from './fhir-resource-history.schema';
import {FhirResource} from './fhir-resource.schema';
import {ChainingService} from './search/chaining.service';
import {IncludeService} from './search/include.service';
import {QueryBuilderService} from './search/query-builder.service';
import {sanitizeValue} from './search/sanitize';
import {SearchParameterRegistry} from './search/search-parameter-registry.service';
import {FhirResourceEvent} from './subscriptions/subscription.types';

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
  ) {
  }

  /**
   * Creates a new FHIR resource with a server-assigned id and meta.
   * Also writes the initial version to the history collection.
   */
  async create(resourceType: string, body: any, session?: ClientSession, req?: any): Promise<FhirResource> {

    const id = randomUUID();
    const now = new Date().toISOString();
    const meta = {...body.meta, versionId: '1', lastUpdated: now};
    const resource = new this.resourceModel({...body, resourceType, id, meta});
    const saved = await resource.save({session});

    // Write version 1 to history
    const snapshot = this.toPlainResource(saved);
    await new this.historyModel({...snapshot, request: {method: 'POST', url: resourceType}, response: {status: '201 Created', etag: `W/"1"`, lastModified: now}}).save({session});

    this.emitResourceEvent('create', resourceType, id, snapshot, req);

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
      return {resources: [], total: 0, included: []};
    }

    // Compartment search filter injected by controller
    if (params._compartmentFilter) {
      extraConditions.push(JSON.parse(params._compartmentFilter));
      delete params._compartmentFilter;
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
    const count = params._count ? parseInt(params._count, 10) : 10;
    query.limit(count);
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    if (offset > 0) {
      query.skip(offset);
    }

    const resources = await query.exec();

    // Resolve _include and _revinclude
    const included = await this.includeService.resolveIncludes(resources, resourceType, params);

    return {resources, total, included};
  }

  /**
   * Retrieves a single resource by type and logical id.
   * @throws NotFoundException if the resource does not exist.
   */
  async findById(resourceType: string, id: string): Promise<FhirResource> {

    const resource = await this.resourceModel.findOne({resourceType, id}).exec();

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

    const entry = await this.historyModel.findOne({resourceType, id, 'meta.versionId': versionId}).lean().exec();

    if (!entry) {
      throw new NotFoundException(this.createOutcome(IssueSeverity.Error, IssueType.NotFound, `${resourceType}/${id}/_history/${versionId} not found`));
    }

    if ((entry as any)._deleted) {
      throw new GoneException(this.createOutcome(IssueSeverity.Error, IssueType.Deleted, `${resourceType}/${id} was deleted at version ${versionId}`));
    }

    // Strip history-specific fields, return clean FHIR resource
    const {_id, __v, request: _req, response: _resp, _deleted: _del, ...resource} = entry as any;

    return resource;
  }

  /**
   * Returns version history for a specific resource instance.
   * Returns entries sorted by lastUpdated descending with Bundle-compatible request/response.
   */
  async instanceHistory(resourceType: string, id: string, params: Record<string, string>): Promise<{ entries: any[]; total: number }> {

    const filter: Record<string, any> = {resourceType, id};

    if (params._since) {
      filter['meta.lastUpdated'] = {$gte: sanitizeValue(params._since)};
    }

    if (params._at) {
      filter['meta.lastUpdated'] = {$eq: sanitizeValue(params._at)};
    }

    const total = await this.historyModel.countDocuments(filter).exec();
    const count = params._count ? parseInt(params._count, 10) : 10;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    const entries = await this.historyModel.find(filter).sort({'meta.lastUpdated': -1}).skip(offset).limit(count).lean().exec();

    return {entries, total};
  }

  /**
   * Returns version history for all resources of a given type.
   */
  async typeHistory(resourceType: string, params: Record<string, string>): Promise<{ entries: any[]; total: number }> {

    const filter: Record<string, any> = {resourceType};

    if (params._since) {
      filter['meta.lastUpdated'] = {$gte: sanitizeValue(params._since)};
    }

    if (params._at) {
      filter['meta.lastUpdated'] = {$eq: sanitizeValue(params._at)};
    }

    const total = await this.historyModel.countDocuments(filter).exec();
    const count = params._count ? parseInt(params._count, 10) : 10;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    const entries = await this.historyModel.find(filter).sort({'meta.lastUpdated': -1}).skip(offset).limit(count).lean().exec();

    return {entries, total};
  }

  /**
   * Returns version history across all resource types (system-level).
   */
  async systemHistory(params: Record<string, string>): Promise<{ entries: any[]; total: number }> {

    const filter: Record<string, any> = {};

    if (params._since) {
      filter['meta.lastUpdated'] = {$gte: sanitizeValue(params._since)};
    }

    if (params._at) {
      filter['meta.lastUpdated'] = {$eq: sanitizeValue(params._at)};
    }

    const total = await this.historyModel.countDocuments(filter).exec();
    const count = params._count ? parseInt(params._count, 10) : 10;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    const entries = await this.historyModel.find(filter).sort({'meta.lastUpdated': -1}).skip(offset).limit(count).lean().exec();

    return {entries, total};
  }

  /**
   * Updates an existing resource. Increments versionId and sets a new lastUpdated timestamp.
   * Writes both the pre-update and new version to history.
   */
  async update(resourceType: string, id: string, body: any, session?: ClientSession, req?: any): Promise<FhirResource> {

    const existing = await this.findById(resourceType, id);
    const currentVersion = parseInt(existing.meta.versionId, 10);
    const now = new Date().toISOString();
    const newVersionId = String(currentVersion + 1);

    const updated = await this.resourceModel.findOneAndUpdate(
      {resourceType, id},
      {...body, resourceType, id, meta: {...body.meta, versionId: newVersionId, lastUpdated: now}},
      {returnDocument: 'after', session},
    ).exec();

    // Write new version to history
    const snapshot = this.toPlainResource(updated);
    await new this.historyModel({...snapshot, request: {method: 'PUT', url: `${resourceType}/${id}`}, response: {status: '200 OK', etag: `W/"${newVersionId}"`, lastModified: now}}).save({session});

    this.emitResourceEvent('update', resourceType, id, snapshot, req);

    return updated;
  }

  /**
   * Applies a JSON Patch (RFC 6902) to an existing resource.
   * Validates patch operations, applies them, increments versionId and writes history.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param operations - Array of JSON Patch operations (add, remove, replace, move, copy, test).
   * @returns The patched resource.
   */
  async patch(resourceType: string, id: string, operations: jsonpatch.Operation[], session?: ClientSession, req?: any): Promise<FhirResource> {
    const existing = await this.findById(resourceType, id);
    const obj = this.toPlainResource(existing);

    // Prevent patching immutable fields
    for (const op of operations) {
      if (op.path === '/id' || op.path === '/resourceType' || op.path.startsWith('/meta/versionId') || op.path.startsWith('/meta/lastUpdated')) {
        throw new BadRequestException(this.createOutcome(IssueSeverity.Error, IssueType.BusinessRule, `Cannot patch immutable field: ${op.path}`));
      }
    }

    const validationErrors = jsonpatch.validate(operations, obj);

    if (validationErrors) {
      throw new BadRequestException(this.createOutcome(IssueSeverity.Error, IssueType.Invalid, `Invalid JSON Patch: ${validationErrors.message}`));
    }

    const patched = jsonpatch.applyPatch(jsonpatch.deepClone(obj), operations).newDocument;
    const currentVersion = parseInt(existing.meta.versionId, 10);
    const now = new Date().toISOString();
    const newVersionId = String(currentVersion + 1);
    patched.meta = {...patched.meta, versionId: newVersionId, lastUpdated: now};

    const updated = await this.resourceModel.findOneAndUpdate({resourceType, id}, patched, {returnDocument: 'after', session}).exec();

    const snapshot = this.toPlainResource(updated);
    await new this.historyModel({...snapshot, request: {method: 'PATCH', url: `${resourceType}/${id}`}, response: {status: '200 OK', etag: `W/"${newVersionId}"`, lastModified: now}}).save({session});

    this.emitResourceEvent('update', resourceType, id, snapshot, req);

    return updated;
  }

  /**
   * Applies a FHIRPath Patch (Parameters resource) to an existing resource.
   * Supports add, insert, replace, delete, and move operations.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param parameters - FHIR Parameters resource with patch operations.
   * @returns The patched resource.
   */
  async fhirPathPatch(resourceType: string, id: string, parameters: any, session?: ClientSession, req?: any): Promise<FhirResource> {
    const existing = await this.findById(resourceType, id);
    const obj = this.toPlainResource(existing);

    const ops = (parameters.parameter || []).filter((p: any) => p.name === 'operation');

    for (const op of ops) {
      const parts = op.part || [];
      const type = parts.find((p: any) => p.name === 'type')?.valueCode;
      const path = parts.find((p: any) => p.name === 'path')?.valueString;
      const name = parts.find((p: any) => p.name === 'name')?.valueString;
      const valuePart = parts.find((p: any) => p.name === 'value');
      const value = valuePart ? this.extractFhirPathValue(valuePart) : undefined;
      const source = parts.find((p: any) => p.name === 'source')?.valueString;
      const destination = parts.find((p: any) => p.name === 'destination')?.valueString;

      if (!type || !path) {
        throw new BadRequestException(this.createOutcome(IssueSeverity.Error, IssueType.Required, 'FHIRPath Patch operation requires "type" and "path"'));
      }

      this.applyFhirPathOp(obj, type, path, name, value, source, destination);
    }

    const currentVersion = parseInt(existing.meta.versionId, 10);
    const now = new Date().toISOString();
    const newVersionId = String(currentVersion + 1);
    obj.meta = {...obj.meta, versionId: newVersionId, lastUpdated: now};

    const updated = await this.resourceModel.findOneAndUpdate({resourceType, id}, obj, {returnDocument: 'after', session}).exec();

    const snapshot = this.toPlainResource(updated);
    await new this.historyModel({...snapshot, request: {method: 'PATCH', url: `${resourceType}/${id}`}, response: {status: '200 OK', etag: `W/"${newVersionId}"`, lastModified: now}}).save({session});

    this.emitResourceEvent('update', resourceType, id, snapshot, req);

    return updated;
  }

  /**
   * Applies a single FHIRPath Patch operation to a resource object.
   * Converts simplified FHIRPath expressions (e.g. "Patient.name") to object navigation.
   */
  private applyFhirPathOp(obj: any, type: string, path: string, name?: string, value?: any, source?: string, destination?: string): void {
    // Convert FHIRPath to object path segments: "Patient.name" -> ["name"], "Patient.name.where(use='official').given" -> ["name", { where: "use='official'" }, "given"]
    const segments = this.parseFhirPath(path, obj.resourceType);

    switch (type) {
      case 'add': {
        if (!name) {
throw new BadRequestException(this.createOutcome(IssueSeverity.Error, IssueType.Required, 'FHIRPath Patch "add" requires "name"'));
}

        const target = this.navigatePath(obj, segments);

        if (Array.isArray(target)) {
          for (const item of target) {
            if (Array.isArray(item[name])) {
              item[name].push(value);
            } else {
              item[name] = value;
            }
          }
        } else if (target !== undefined) {
          if (Array.isArray(target[name])) {
            target[name].push(value);
          } else {
            target[name] = value;
          }
        }

        break;
      }

      case 'insert': {
        const parent = this.navigatePath(obj, segments.slice(0, -1));
        const lastSeg = segments[segments.length - 1] as string;
        const container = Array.isArray(parent) ? parent[0] : parent;

        if (container && Array.isArray(container[lastSeg])) {
          container[lastSeg].push(value);
        } else if (container) {
          container[lastSeg] = [value];
        }

        break;
      }

      case 'replace': {
        const parent2 = this.navigatePath(obj, segments.slice(0, -1));
        const lastSeg2 = segments[segments.length - 1] as string;
        const container2 = Array.isArray(parent2) ? parent2[0] : parent2;

        if (container2) {
container2[lastSeg2] = value;
}

        break;
      }

      case 'delete': {
        const parent3 = this.navigatePath(obj, segments.slice(0, -1));
        const lastSeg3 = segments[segments.length - 1] as string;
        const container3 = Array.isArray(parent3) ? parent3[0] : parent3;

        if (container3) {
delete container3[lastSeg3];
}

        break;
      }

      case 'move': {
        if (!source || !destination) {
throw new BadRequestException(this.createOutcome(IssueSeverity.Error, IssueType.Required, 'FHIRPath Patch "move" requires "source" and "destination"'));
}

        const sourceSegs = this.parseFhirPath(source, obj.resourceType);
        const destSegs = this.parseFhirPath(destination, obj.resourceType);
        const srcParent = this.navigatePath(obj, sourceSegs.slice(0, -1));
        const srcKey = sourceSegs[sourceSegs.length - 1] as string;
        const srcContainer = Array.isArray(srcParent) ? srcParent[0] : srcParent;

        if (srcContainer) {
          const val = srcContainer[srcKey];
          delete srcContainer[srcKey];
          const destParent = this.navigatePath(obj, destSegs.slice(0, -1));
          const destKey = destSegs[destSegs.length - 1] as string;
          const destContainer = Array.isArray(destParent) ? destParent[0] : destParent;

          if (destContainer) {
destContainer[destKey] = val;
}
        }

        break;
      }

      default:
        throw new BadRequestException(this.createOutcome(IssueSeverity.Error, IssueType.Invalid, `Unknown FHIRPath Patch operation type: ${type}`));
    }
  }

  /** Parses a simplified FHIRPath expression into path segments, stripping the resource type prefix. */
  private parseFhirPath(path: string, resourceType: string): string[] {
    let normalized = path;

    if (normalized.startsWith(`${resourceType}.`)) {
      normalized = normalized.substring(resourceType.length + 1);
    }

    return normalized.split('.');
  }

  /** Navigates an object along path segments, returning the target value. */
  private navigatePath(obj: any, segments: string[]): any {
    let current = obj;

    for (const seg of segments) {
      if (current === undefined || current === null) {
return undefined;
}

      if (Array.isArray(current)) {
        current = current.map((item) => item[seg]).filter((v) => v !== undefined);
      } else {
        current = current[seg];
      }
    }

    return current;
  }

  /** Extracts the typed value from a FHIRPath Patch value part. */
  private extractFhirPathValue(part: any): any {
    const valueKeys = Object.keys(part).filter((k) => k.startsWith('value'));

    if (valueKeys.length > 0) {
return part[valueKeys[0]];
}

    if (part.part) {
      const result: any = {};

      for (const p of part.part) {
        const val = this.extractFhirPathValue(p);
        result[p.name] = val;
      }

      return result;
    }

    return undefined;
  }

  /**
   * Deletes a resource by type and logical id.
   * Checks referential integrity before deletion — blocks if other resources reference this one.
   * Writes a tombstone entry to history before removing from the main collection.
   */
  async delete(resourceType: string, id: string, session?: ClientSession, req?: any): Promise<void> {

    const existing = await this.resourceModel.findOne({resourceType, id}).exec();

    if (!existing) {
      throw new NotFoundException(this.createOutcome(IssueSeverity.Error, IssueType.NotFound, `${resourceType}/${id} not found`));
    }

    // Referential integrity check: block delete if referenced by other resources
    await this.checkReferentialIntegrity(resourceType, id);

    const currentVersion = parseInt(existing.meta.versionId, 10);
    const now = new Date().toISOString();
    const deleteVersionId = String(currentVersion + 1);

    // Write tombstone to history
    await new this.historyModel({
      resourceType, id, meta: {versionId: deleteVersionId, lastUpdated: now, profile: existing.meta.profile, tag: existing.meta.tag, security: existing.meta.security},
      request: {method: 'DELETE', url: `${resourceType}/${id}`}, response: {status: '204 No Content'}, _deleted: true,
    }).save({session});

    await this.resourceModel.deleteOne({resourceType, id}, {session}).exec();

    this.emitResourceEvent('delete', resourceType, id, null, req);
  }

  /**
   * Conditional create: only creates if no existing resource matches the search criteria.
   * Uses the If-None-Exist header value as search params.
   * @returns { resource, created } — created=true if new, false if existing match found.
   * @throws ConflictException if multiple matches found.
   */
  async conditionalCreate(resourceType: string, body: any, searchParams: Record<string, string>, session?: ClientSession, req?: any): Promise<{ resource: FhirResource; created: boolean }> {

    const filter = this.queryBuilder.buildFilter(resourceType, searchParams);
    const matches = await this.resourceModel.find(filter).limit(2).exec();

    if (matches.length === 1) {
      return {resource: matches[0], created: false};
    }

    if (matches.length > 1) {
      throw new ConflictException(this.createOutcome(IssueSeverity.Error, IssueType.Duplicate, `Conditional create matched ${matches.length} resources — cannot determine which to return`));
    }

    const resource = await this.create(resourceType, body, session, req);

    return {resource, created: true};
  }

  /**
   * Conditional update: PUT /ResourceType?search-params
   * Creates if 0 matches, updates if 1 match, errors if multiple matches.
   * @returns { resource, created } — created=true if new resource was created.
   * @throws ConflictException if multiple matches found.
   */
  async conditionalUpdate(resourceType: string, body: any, searchParams: Record<string, string>, session?: ClientSession, req?: any): Promise<{ resource: FhirResource; created: boolean }> {

    const filter = this.queryBuilder.buildFilter(resourceType, searchParams);
    const matches = await this.resourceModel.find(filter).limit(2).exec();

    if (matches.length > 1) {
      throw new ConflictException(this.createOutcome(IssueSeverity.Error, IssueType.Duplicate, `Conditional update matched ${matches.length} resources — cannot determine which to update`));
    }

    if (matches.length === 1) {
      const resource = await this.update(resourceType, matches[0].id, body, session, req);

      return {resource, created: false};
    }

    // No match → create
    const resource = await this.create(resourceType, body, session, req);

    return {resource, created: true};
  }

  /**
   * Conditional delete: DELETE /ResourceType?search-params
   * Deletes all matching resources (FHIR allows single or multiple conditional delete).
   * @returns The number of deleted resources.
   */
  async conditionalDelete(resourceType: string, searchParams: Record<string, string>, session?: ClientSession, req?: any): Promise<number> {

    const filter = this.queryBuilder.buildFilter(resourceType, searchParams);
    const matches = await this.resourceModel.find(filter).exec();

    for (const match of matches) {
      await this.delete(resourceType, match.id, session, req);
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

    const filter: Record<string, any> = resourceType ? {resourceType} : {};
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

    return {profile: [...profiles], tag: [...tagMap.values()], security: [...securityMap.values()]};
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

    const updated = await this.resourceModel.findOneAndUpdate({resourceType, id}, {meta: merged}, {returnDocument: 'after'}).exec();

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

    const updated = await this.resourceModel.findOneAndUpdate({resourceType, id}, {'meta': merged}, {returnDocument: 'after'}).exec();

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

  /**
   * FHIR $everything operation: returns the patient and all resources referencing it.
   * Searches all reference fields across all resource types for Patient/{id}.
   * Supports _since, _count and _type parameters per the FHIR spec.
   */
  async everything(resourceType: string, id: string, params: Record<string, string>): Promise<{ resources: FhirResource[]; total: number }> {

    // 1. Fetch the focal resource
    const focal = await this.findById(resourceType, id);
    const ref = `${resourceType}/${id}`;

    // 2. Build filter to find all resources referencing this resource
    // Uses a $regex on any nested .reference field (generic approach for schema-free storage)
    const refFilter: Record<string, any> = {resourceType: {$ne: resourceType === 'Patient' ? 'Patient' : '__none__'}};

    // Search for the reference pattern anywhere in the document using a recursive reference scan
    refFilter.$where = undefined; // Explicitly avoid $where — instead we query known reference paths

    // Generic approach: search for the exact reference string in any field ending in .reference
    // MongoDB doesn't support recursive field search natively, so we search common reference patterns
    const referenceFilter: Record<string, any> = {};

    if (params._type) {
      // Limit to specific resource types
      const types = params._type.split(',').map((t) => t.trim()).filter(Boolean);
      referenceFilter.resourceType = {$in: types};
    } else {
      // Exclude the focal resource type and infrastructure resources (AuditEvent, Provenance)
      referenceFilter.resourceType = {$nin: [resourceType, 'AuditEvent', 'Provenance']};
    }

    if (params._since) {
      referenceFilter['meta.lastUpdated'] = {$gte: String(params._since)};
    }

    // Find all resources that contain a reference to the focal resource
    // We search across all documents using a text match on the serialized reference string
    const allDocs = await this.resourceModel.find(referenceFilter).lean().exec();

    // Filter in-memory: check if any reference field contains the target reference
    const matchingDocs = allDocs.filter((doc) => this.containsReference(doc, ref));

    // Apply count/offset
    const count = params._count ? parseInt(params._count, 10) : 1000;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;

    // Combine focal resource + matching resources
    const allResources = [focal, ...matchingDocs.map((d) => {
      const obj = (d as any).toObject ? (d as any).toObject() : d;

      return obj;
    })];

    const total = allResources.length;
    const paged = allResources.slice(offset, offset + count);

    return {resources: paged as FhirResource[], total};
  }

  /** Recursively checks if a document contains a reference to the given target (e.g. "Patient/123"). */
  private containsReference(obj: any, targetRef: string): boolean {
    if (obj === null || obj === undefined) {
      return false;
    }

    if (typeof obj === 'string') {
      return obj === targetRef || obj.endsWith(`/${targetRef}`);
    }

    if (Array.isArray(obj)) {
      return obj.some((item) => this.containsReference(item, targetRef));
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'reference' && typeof value === 'string' && (value === targetRef || value.endsWith(`/${targetRef}`))) {
          return true;
        }

        if (key !== '_id' && key !== '__v' && this.containsReference(value, targetRef)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * FHIR $lastn operation: returns the most recent N Observations per code.
   * Groups by code.coding[0].system + code.coding[0].code and returns max per group, sorted by effectiveDateTime descending.
   * Supports patient, subject, category, and code filters.
   */
  async lastn(params: Record<string, string>, max: number): Promise<{resources: FhirResource[]; total: number}> {
    const filter: Record<string, any> = {resourceType: 'Observation'};

    if (params.patient) {
      const ref = params.patient.includes('/') ? params.patient : `Patient/${params.patient}`;
      filter.$or = [{'subject.reference': ref}, {'subject.reference': {$regex: `/${ref}$`}}];
    }

    if (params.subject) {
      const ref = params.subject.includes('/') ? params.subject : `Patient/${params.subject}`;

      if (filter.$or) {
        filter.$and = [{$or: filter.$or}, {$or: [{'subject.reference': ref}, {'subject.reference': {$regex: `/${ref}$`}}]}];
        delete filter.$or;
      } else {
        filter.$or = [{'subject.reference': ref}, {'subject.reference': {$regex: `/${ref}$`}}];
      }
    }

    if (params.category) {
      const [catSystem, catCode] = params.category.includes('|') ? params.category.split('|', 2) : [undefined, params.category];
      const catFilter: Record<string, any> = {};

      if (catCode) {
catFilter['category.coding.code'] = catCode;
}

      if (catSystem) {
catFilter['category.coding.system'] = catSystem;
}

      Object.assign(filter, catFilter);
    }

    if (params.code) {
      const [codeSystem, codeVal] = params.code.includes('|') ? params.code.split('|', 2) : [undefined, params.code];
      const codeFilter: Record<string, any> = {};

      if (codeVal) {
codeFilter['code.coding.code'] = codeVal;
}

      if (codeSystem) {
codeFilter['code.coding.system'] = codeSystem;
}

      Object.assign(filter, codeFilter);
    }

    // Fetch all matching observations sorted by date descending
    const allObs = await this.resourceModel.find(filter).sort({effectiveDateTime: -1, 'meta.lastUpdated': -1}).lean().exec();

    // Group by code (system|code) and take last N per group
    const groups = new Map<string, any[]>();

    for (const obs of allObs) {
      const coding = (obs as any).code?.coding?.[0];
      const groupKey = coding ? `${coding.system || ''}|${coding.code || ''}` : `unknown|${(obs as any).id}`;
      const group = groups.get(groupKey) || [];

      if (group.length < max) {
        group.push(obs);
        groups.set(groupKey, group);
      }
    }

    const resources = [...groups.values()].flat() as FhirResource[];

    return {resources, total: resources.length};
  }

  /**
   * Cascade delete: deletes the resource and all resources that reference it.
   * Recursively deletes dependent resources depth-first.
   * @returns The total number of deleted resources.
   */
  async cascadeDelete(resourceType: string, id: string, session?: ClientSession, req?: any): Promise<number> {
    const ref = `${resourceType}/${id}`;
    const allDocs = await this.resourceModel.find({resourceType: {$nin: ['AuditEvent', 'Provenance']}}).lean().exec();
    const dependents = allDocs.filter((doc) => this.containsReference(doc, ref) && !((doc as any).resourceType === resourceType && (doc as any).id === id));

    let deleted = 0;

    // Delete dependents first (depth-first)
    for (const dep of dependents) {
      deleted += await this.cascadeDelete((dep as any).resourceType, (dep as any).id, session, req);
    }

    // Delete the focal resource (skip referential integrity check)
    const existing = await this.resourceModel.findOne({resourceType, id}).exec();

    if (existing) {
      const currentVersion = parseInt(existing.meta.versionId, 10);
      const now = new Date().toISOString();
      const deleteVersionId = String(currentVersion + 1);
      const meta = {versionId: deleteVersionId, lastUpdated: now, profile: existing.meta.profile, tag: existing.meta.tag, security: existing.meta.security};
      const historyEntry = {resourceType, id, meta, request: {method: 'DELETE', url: `${resourceType}/${id}`}, response: {status: '204 No Content'}, _deleted: true};
      await new this.historyModel(historyEntry).save({session});
      await this.resourceModel.deleteOne({resourceType, id}, {session}).exec();
      this.emitResourceEvent('delete', resourceType, id, null, req);
      deleted++;
    }

    return deleted;
  }

  /**
   * Checks referential integrity: verifies that no other resource references the given resource.
   * @throws ConflictException if the resource is still referenced by other resources.
   */
  async checkReferentialIntegrity(resourceType: string, id: string): Promise<void> {
    const ref = `${resourceType}/${id}`;
    const allDocs = await this.resourceModel.find({resourceType: {$nin: [resourceType, 'AuditEvent', 'Provenance']}}).lean().exec();
    const referencingDoc = allDocs.find((doc) => this.containsReference(doc, ref));

    if (referencingDoc) {
      const refType = (referencingDoc as any).resourceType;
      const refId = (referencingDoc as any).id;
      throw new ConflictException(this.createOutcome(IssueSeverity.Error, IssueType.Conflict, `Cannot delete ${ref}: referenced by ${refType}/${refId}`));
    }
  }

  /**
   * FHIR $expunge operation: physically removes resources and/or history entries from the database.
   * Unlike regular delete (soft delete with tombstone), expunge permanently purges data — used for GDPR/AVG compliance.
   * @param options.resourceType - Limit to a specific resource type (type-level).
   * @param options.id - Limit to a specific resource instance (instance-level).
   * @param options.expungeDeletedResources - Remove soft-deleted resources and their history tombstones.
   * @param options.expungeOldVersions - Remove non-current history versions (keeps only the latest).
   * @param options.expungeEverything - Hard-purge everything matching the scope (resource + all history).
   * @param options.limit - Maximum number of entries to expunge (default 1000).
   * @returns Count of expunged resources and history entries.
   */
  async expunge(options: {resourceType?: string; id?: string; expungeDeletedResources?: boolean; expungeOldVersions?: boolean; expungeEverything?: boolean; limit?: number}): Promise<{resources: number; versions: number}> {
    const limit = options.limit || 1000;
    let resourcesExpunged = 0;
    let versionsExpunged = 0;
    const baseFilter: Record<string, any> = {};

    if (options.resourceType) {
      baseFilter.resourceType = options.resourceType;
    }

    if (options.id) {
      baseFilter.id = options.id;
    }

    if (options.expungeEverything) {
      // Hard-purge: remove matching resources from both collections
      const resResult = await this.resourceModel.deleteMany(baseFilter).exec();
      resourcesExpunged = resResult.deletedCount || 0;
      const histResult = await this.historyModel.deleteMany(baseFilter).exec();
      versionsExpunged = histResult.deletedCount || 0;

      return {resources: Math.min(resourcesExpunged, limit), versions: Math.min(versionsExpunged, limit)};
    }

    if (options.expungeDeletedResources) {
      // Find soft-deleted tombstones in history and purge them + any remaining main collection entries
      const tombstones = await this.historyModel.find({...baseFilter, _deleted: true}).limit(limit).lean().exec();

      for (const tomb of tombstones) {
        const ref = {resourceType: (tomb as any).resourceType, id: (tomb as any).id};
        // Remove all history for this resource
        const histDel = await this.historyModel.deleteMany(ref).exec();
        versionsExpunged += histDel.deletedCount || 0;
        // Remove from main collection if somehow still there
        const resDel = await this.resourceModel.deleteMany(ref).exec();
        resourcesExpunged += resDel.deletedCount || 0;
      }
    }

    if (options.expungeOldVersions) {
      // Remove non-current versions from history, keeping only the latest per resource
      const histFilter = {...baseFilter, _deleted: {$ne: true}};
      const allHistory = await this.historyModel.find(histFilter).sort({'meta.lastUpdated': -1}).lean().exec();
      const seen = new Set<string>();

      for (const entry of allHistory) {
        const key = `${(entry as any).resourceType}/${(entry as any).id}`;

        if (seen.has(key)) {
          // This is an old version — expunge it
          await this.historyModel.deleteOne({_id: (entry as any)._id}).exec();
          versionsExpunged++;

          if (versionsExpunged >= limit) {
            break;
          }
        } else {
          seen.add(key);
        }
      }
    }

    return {resources: resourcesExpunged, versions: versionsExpunged};
  }

  /** Returns all distinct resourceType values currently stored in the database. */
  async getResourceTypes(): Promise<string[]> {

    return this.resourceModel.distinct('resourceType').exec();
  }

  /** Converts a Mongoose document to a plain object without MongoDB internals. */
  private toPlainResource(doc: any): any {

    const obj = doc.toObject ? doc.toObject() : doc;
    const {_id, __v, ...resource} = obj;

    return resource;
  }

  /** Emits a fhir.resource.changed event for subscription and audit evaluation. */
  private emitResourceEvent(action: FhirResourceEvent['action'], resourceType: string, id: string, resource: any, req?: any): void {
    this.eventEmitter.emit('fhir.resource.changed', {action, resourceType, id, resource, req} as FhirResourceEvent);
  }

  private createOutcome(severity: IssueSeverity, code: IssueType, diagnostics: string): OperationOutcome {
    return new OperationOutcome({issue: [new OperationOutcomeIssue({severity, code, diagnostics})]});
  }
}
