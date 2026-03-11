import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { Model } from 'mongoose';
import { ConformanceResource } from './conformance-resource.schema';

const ALLOWED_TYPES = new Set(['StructureDefinition', 'ValueSet', 'CodeSystem', 'SearchParameter', 'CompartmentDefinition', 'OperationDefinition', 'NamingSystem', 'ConceptMap', 'ImplementationGuide']);

@Injectable()
export class AdministrationService {

  private readonly logger = new Logger(AdministrationService.name);

  constructor(@InjectModel(ConformanceResource.name) private readonly model: Model<ConformanceResource>) {}

  async search(resourceType: string, params: Record<string, string>): Promise<{ resources: ConformanceResource[]; total: number }> {
    this.assertAllowedType(resourceType);
    const filter: Record<string, any> = { resourceType };
    if (params.url) filter.url = params.url;
    if (params.name) filter.name = { $regex: params.name, $options: 'i' };
    if (params.version) filter.version = params.version;
    if (params.status) filter.status = params.status;
    if (params._id) filter.id = params._id;

    const count = params._count ? parseInt(params._count, 10) : 100;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;
    const total = await this.model.countDocuments(filter).exec();
    const resources = await this.model.find(filter).sort({ 'meta.lastUpdated': -1 }).skip(offset).limit(count).exec();

    this.logger.log(`Search ${resourceType}: ${total} results (params: ${JSON.stringify(params)})`);
    return { resources, total };
  }

  async findById(resourceType: string, id: string): Promise<ConformanceResource> {
    this.assertAllowedType(resourceType);
    const resource = await this.model.findOne({ resourceType, id }).exec();
    if (!resource) {
      this.logger.warn(`Read ${resourceType}/${id}: not found`);
      throw new NotFoundException(new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.NotFound, diagnostics: `${resourceType}/${id} not found` })] }));
    }
    this.logger.log(`Read ${resourceType}/${id} (url: ${resource.url || 'n/a'})`);
    return resource;
  }

  async create(resourceType: string, body: any): Promise<ConformanceResource> {
    this.assertAllowedType(resourceType);
    const id = body.id || randomUUID();
    const now = new Date().toISOString();
    const meta = { ...body.meta, versionId: '1', lastUpdated: now };
    const resource = new this.model({ ...body, resourceType, id, meta });
    const saved = await resource.save();
    this.logger.log(`Created ${resourceType}/${id} (url: ${body.url || 'n/a'})`);
    return saved;
  }

  async update(resourceType: string, id: string, body: any): Promise<ConformanceResource> {
    this.assertAllowedType(resourceType);
    const existing = await this.model.findOne({ resourceType, id }).exec();
    const now = new Date().toISOString();
    const currentVersion = existing ? parseInt(existing.meta.versionId, 10) : 0;
    const newVersionId = String(currentVersion + 1);
    const meta = { ...body.meta, versionId: newVersionId, lastUpdated: now };

    const updated = await this.model.findOneAndUpdate({ resourceType, id }, { ...body, resourceType, id, meta }, { returnDocument: 'after', upsert: true }).exec();
    this.logger.log(`Updated ${resourceType}/${id} to version ${newVersionId} (url: ${body.url || 'n/a'})`);
    return updated;
  }

  async delete(resourceType: string, id: string): Promise<void> {
    this.assertAllowedType(resourceType);
    const result = await this.model.deleteOne({ resourceType, id }).exec();
    if (result.deletedCount === 0) {
      this.logger.warn(`Delete ${resourceType}/${id}: not found`);
      throw new NotFoundException(new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.NotFound, diagnostics: `${resourceType}/${id} not found` })] }));
    }
    this.logger.log(`Deleted ${resourceType}/${id}`);
  }

  /** Bulk upsert for seeding — upserts by resourceType + url + version. Returns count of upserted documents. */
  async bulkUpsert(resources: any[]): Promise<number> {
    if (resources.length === 0) return 0;
    const now = new Date().toISOString();
    const ops = resources.map((r) => {
      const filter = r.url ? { resourceType: r.resourceType, url: r.url, version: r.version || null } : { resourceType: r.resourceType, id: r.id };
      const id = r.id || randomUUID();
      const meta = { ...r.meta, versionId: '1', lastUpdated: r.meta?.lastUpdated || now };
      return { updateOne: { filter, update: { $setOnInsert: { ...r, id, meta } }, upsert: true } };
    });

    const batchSize = 500;
    let upserted = 0;
    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);
      const result = await this.model.bulkWrite(batch, { ordered: false });
      upserted += result.upsertedCount;
      this.logger.log(`Bulk upsert batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ops.length / batchSize)}: ${result.upsertedCount} inserted, ${batch.length - result.upsertedCount} skipped`);
    }
    return upserted;
  }

  /** Returns seed version marker, or null if not seeded yet. */
  async getSeedVersion(): Promise<string | null> {
    const marker = await this.model.findOne({ resourceType: '_SeedMarker', id: 'seed-version' }).lean().exec();
    return marker ? (marker as any).version : null;
  }

  /** Stores seed version marker. */
  async setSeedVersion(version: string): Promise<void> {
    await this.model.updateOne({ resourceType: '_SeedMarker', id: 'seed-version' }, { resourceType: '_SeedMarker', id: 'seed-version', version, meta: { versionId: '1', lastUpdated: new Date().toISOString() } }, { upsert: true }).exec();
  }

  private assertAllowedType(resourceType: string): void {
    if (!ALLOWED_TYPES.has(resourceType)) {
      throw new NotFoundException(new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.NotSupported, diagnostics: `Resource type '${resourceType}' is not a conformance resource. Supported: ${[...ALLOWED_TYPES].join(', ')}` })] }));
    }
  }
}