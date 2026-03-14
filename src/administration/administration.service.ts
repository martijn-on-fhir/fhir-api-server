import {randomUUID} from 'crypto';
import {Injectable, Logger, NotFoundException} from '@nestjs/common';
import {InjectModel} from '@nestjs/mongoose';
import {OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType} from 'fhir-models-r4';
import {Model} from 'mongoose';
import {CacheService} from '../cache/cache.service';
import {ConformanceResource} from './conformance-resource.schema';

const ALLOWED_TYPES = new Set(['StructureDefinition', 'ValueSet', 'CodeSystem', 'SearchParameter', 'CompartmentDefinition', 'OperationDefinition', 'NamingSystem', 'ConceptMap', 'ImplementationGuide']);

/**
 * Service for managing FHIR conformance resources (StructureDefinition, ValueSet, CodeSystem, etc.).
 * Provides CRUD operations, search with filtering/pagination, and bulk upsert for seeding.
 * All operations are scoped to the allowed conformance resource types defined in {@link ALLOWED_TYPES}.
 */
@Injectable()
export class AdministrationService {

  private readonly logger = new Logger(AdministrationService.name);

  constructor(@InjectModel(ConformanceResource.name) private readonly model: Model<ConformanceResource>, private readonly cacheService: CacheService) {
  }

  /**
   * Searches conformance resources by type with optional filtering on `url`, `name`, `version`, `status`, and `_id`.
   * Supports pagination via `_count` (default 100) and `_offset` (default 0).
   * @param resourceType - The FHIR resource type to search (must be an allowed conformance type).
   * @param params - Query parameters for filtering and pagination.
   * @returns The matching resources and total count.
   */
  async search(resourceType: string, params: Record<string, string>): Promise<{ resources: ConformanceResource[]; total: number }> {

    this.assertAllowedType(resourceType);
    const filter: Record<string, any> = {resourceType};

    if (params.url) {
      filter.url = params.url;
    }

    if (params.name) {
      const safeName = params.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = {$regex: safeName, $options: 'i'};
    }

    if (params.version) {
      filter.version = params.version;
    }

    if (params.status) {
      filter.status = params.status;
    }

    if (params._id) {
      filter.id = params._id;
    }

    const count = params._count ? parseInt(params._count, 10) : 100;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;
    const total = await this.model.countDocuments(filter).exec();
    const resources = await this.model.find(filter).sort({'meta.lastUpdated': -1}).skip(offset).limit(count).exec();

    this.logger.log(`Search ${resourceType}: ${total} results (params: ${JSON.stringify(params)})`);

    return {resources, total};
  }

  /**
   * Retrieves a single conformance resource by its resource type and logical id.
   * @param resourceType - The FHIR resource type (must be an allowed conformance type).
   * @param id - The logical id of the resource.
   * @returns The matching conformance resource.
   * @throws {NotFoundException} With an OperationOutcome if the resource does not exist.
   */
  async findById(resourceType: string, id: string): Promise<ConformanceResource> {
    this.assertAllowedType(resourceType);
    const cacheKey = `conformance:${resourceType}:${id}`;
    const cached = await this.cacheService.get<ConformanceResource>(cacheKey);

    if (cached) {
return cached;
}

    const resource = await this.model.findOne({resourceType, id}).exec();

    if (!resource) {
      this.logger.warn(`Read ${resourceType}/${id}: not found`);
      throw new NotFoundException(new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.NotFound, diagnostics: `${resourceType}/${id} not found`})]}));
    }

    this.logger.log(`Read ${resourceType}/${id} (url: ${resource.url || 'n/a'})`);
    await this.cacheService.set(cacheKey, resource);

    return resource;
  }

  /**
   * Creates a new conformance resource. Assigns a random UUID if no `id` is provided,
   * and initializes `meta.versionId` to `'1'` with the current timestamp.
   * @param resourceType - The FHIR resource type (must be an allowed conformance type).
   * @param body - The resource payload.
   * @returns The persisted conformance resource.
   */
  async create(resourceType: string, body: any): Promise<ConformanceResource> {

    this.assertAllowedType(resourceType);
    const id = body.id || randomUUID();
    const now = new Date().toISOString();
    const meta = {...body.meta, versionId: '1', lastUpdated: now};
    const resource = new this.model({...body, resourceType, id, meta});
    const saved = await resource.save();

    this.logger.log(`Created ${resourceType}/${id} (url: ${body.url || 'n/a'})`);
    await this.invalidateConformanceCache(resourceType);

    return saved;
  }

  /**
   * Updates an existing conformance resource or creates it if it doesn't exist (upsert).
   * Increments `meta.versionId` based on the current version.
   * @param resourceType - The FHIR resource type (must be an allowed conformance type).
   * @param id - The logical id of the resource.
   * @param body - The updated resource payload.
   * @returns The updated (or newly created) conformance resource.
   */
  async update(resourceType: string, id: string, body: any): Promise<ConformanceResource> {

    this.assertAllowedType(resourceType);
    const existing = await this.model.findOne({resourceType, id}).exec();
    const now = new Date().toISOString();
    const currentVersion = existing ? parseInt(existing.meta.versionId, 10) : 0;
    const newVersionId = String(currentVersion + 1);
    const meta = {...body.meta, versionId: newVersionId, lastUpdated: now};

    const updated = await this.model.findOneAndUpdate({resourceType, id}, {...body, resourceType, id, meta}, {returnDocument: 'after', upsert: true}).exec();
    this.logger.log(`Updated ${resourceType}/${id} to version ${newVersionId} (url: ${body.url || 'n/a'})`);
    await this.invalidateConformanceCache(resourceType, id);

    return updated;
  }

  /**
   * Deletes a conformance resource by its resource type and logical id.
   * @param resourceType - The FHIR resource type (must be an allowed conformance type).
   * @param id - The logical id of the resource to delete.
   * @throws {NotFoundException} With an OperationOutcome if the resource does not exist.
   */
  async delete(resourceType: string, id: string): Promise<void> {

    this.assertAllowedType(resourceType);
    const result = await this.model.deleteOne({resourceType, id}).exec();

    if (result.deletedCount === 0) {
      this.logger.warn(`Delete ${resourceType}/${id}: not found`);
      throw new NotFoundException(new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.NotFound, diagnostics: `${resourceType}/${id} not found`})]}));
    }

    this.logger.log(`Deleted ${resourceType}/${id}`);
    await this.invalidateConformanceCache(resourceType, id);
  }

  /**
   * Bulk upserts conformance resources for seeding purposes. Matches existing resources by
   * `resourceType + url + version` (or `resourceType + id` if no URL). Uses `$setOnInsert`
   * so existing resources are never overwritten. Processes in batches of 500.
   * @param resources - Array of FHIR conformance resources to upsert.
   * @returns The number of newly inserted documents.
   */
  async bulkUpsert(resources: any[]): Promise<number> {
    if (resources.length === 0) {
      return 0;
    }

    const now = new Date().toISOString();
    const ops = resources.map((r) => {
      const filter = r.url ? {resourceType: r.resourceType, url: r.url, version: r.version || null} : {resourceType: r.resourceType, id: r.id};
      const id = r.id || randomUUID();
      const meta = {...r.meta, versionId: '1', lastUpdated: r.meta?.lastUpdated || now};

      return {updateOne: {filter, update: {$setOnInsert: {...r, id, meta}}, upsert: true}};
    });

    const batchSize = 500;
    let upserted = 0;

    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);
      const result = await this.model.bulkWrite(batch, {ordered: false});
      upserted += result.upsertedCount;
      this.logger.log(`Bulk upsert batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ops.length / batchSize)}: ${result.upsertedCount} inserted, ${batch.length - result.upsertedCount} skipped`);
    }

    return upserted;
  }

  /**
   * Returns the stored seed version hash used for change detection, or `null` if no seed has been performed yet.
   */
  async getSeedVersion(): Promise<string | null> {
    const marker = await this.model.findOne({resourceType: '_SeedMarker', id: 'seed-version'}).lean().exec();

    return marker ? (marker as any).version : null;
  }

  /**
   * Persists the seed version hash so subsequent startups can skip re-importing unchanged files.
   * @param version - The MD5 hash representing the current state of the import directory.
   */
  async setSeedVersion(version: string): Promise<void> {
    await this.model.updateOne({resourceType: '_SeedMarker', id: 'seed-version'}, {resourceType: '_SeedMarker', id: 'seed-version', version, meta: {versionId: '1', lastUpdated: new Date().toISOString()}}, {upsert: true}).exec();
  }

  /**
   * Guards that the given resource type is a supported conformance type.
   * @param resourceType - The resource type to validate.
   * @throws {NotFoundException} With an OperationOutcome listing supported types if the type is not allowed.
   */
  private assertAllowedType(resourceType: string): void {
    if (!ALLOWED_TYPES.has(resourceType)) {
      throw new NotFoundException(new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.NotSupported, diagnostics: `Resource type '${resourceType}' is not a conformance resource. Supported: ${[...ALLOWED_TYPES].join(', ')}`})]}));
    }
  }

  /** Invalidates conformance-related caches after a mutation. Also clears CapabilityStatement and terminology caches. */
  private async invalidateConformanceCache(resourceType: string, id?: string): Promise<void> {
    await this.cacheService.invalidateByPrefix(`conformance:${resourceType}`);

    if (id) {
await this.cacheService.delete(`conformance:${resourceType}:${id}`);
}

    await this.cacheService.invalidateByPrefix('capability:');
    await this.cacheService.invalidateByPrefix('terminology:');
  }
}