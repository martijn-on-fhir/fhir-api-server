import { writeFile, readFile } from 'fs/promises';
import { basename, join } from 'path';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { FhirResourceHistory } from '../fhir/fhir-resource-history.schema';
import { FhirResource } from '../fhir/fhir-resource.schema';

const FIXTURES_DIR = join(process.cwd(), 'fixtures');

/** Service for creating and restoring database snapshots of FHIR health data. */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(@InjectConnection() private readonly connection: Connection, @InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>, @InjectModel(FhirResourceHistory.name) private readonly historyModel: Model<FhirResourceHistory>) {}

  /** Exports all FHIR resources and history, writes to fixtures/ and returns a summary. */
  async snapshot(): Promise<{ filename: string; exportedAt: string; resources: number; history: number; resourceTypes: Record<string, number> }> {
    const [rawResources, rawHistory] = await Promise.all([this.resourceModel.find({}).lean().exec(), this.historyModel.find({}).lean().exec()]);
    const strip = ({ _id, __v, ...rest }: any) => rest;
    const resources = rawResources.map(strip);
    const history = rawHistory.map(strip);
    const exportedAt = new Date().toISOString();

    // Count per resourceType
    const resourceTypes: Record<string, number> = {};

    for (const r of resources) {
      resourceTypes[r.resourceType] = (resourceTypes[r.resourceType] || 0) + 1;
    }

    // Write to fixtures/ (fixed name, overwrites previous snapshot)
    const filename = 'test-data.json';
    const filePath = join(FIXTURES_DIR, filename);
    await writeFile(filePath, JSON.stringify({ resources, history, exportedAt }, null, 2), 'utf-8');
    this.logger.log(`Snapshot saved to ${filePath} (${resources.length} resources, ${history.length} history)`);

    return { filename, exportedAt, resources: resources.length, history: history.length, resourceTypes };
  }

  /** Wipes all FHIR health data and imports from a snapshot file in fixtures/. Returns counts of imported documents. */
  async restore(filename: string): Promise<{ resources: number; history: number }> {
    const sanitized = basename(filename);
    const filePath = join(FIXTURES_DIR, sanitized);
    let data: any;

    try {
      const raw = await readFile(filePath, 'utf-8');
      data = JSON.parse(raw);
    } catch (error) {
      throw new BadRequestException(`Cannot read snapshot file "${filename}": ${(error as Error).message}`);
    }

    if (!data || !Array.isArray(data.resources)) {
      throw new BadRequestException(`Snapshot file "${filename}" does not contain a valid "resources" array`);
    }

    try {
      await Promise.all([this.resourceModel.deleteMany({}).exec(), this.historyModel.deleteMany({}).exec()]);
      const resourceCount = data.resources.length > 0 ? (await this.resourceModel.insertMany(data.resources, { ordered: false })).length : 0;
      const historyCount = Array.isArray(data.history) && data.history.length > 0 ? (await this.historyModel.insertMany(data.history, { ordered: false })).length : 0;
      this.logger.log(`Restore complete from ${filename}: ${resourceCount} resources, ${historyCount} history entries`);

      return { resources: resourceCount, history: historyCount };
    } catch (error) {
      this.logger.error('Restore failed', error);
      throw new InternalServerErrorException('Database restore failed: ' + (error as Error).message);
    }
  }

  /** Returns index usage statistics for all FHIR collections. */
  async getIndexStats(): Promise<Record<string, any[]>> {
    const db = this.connection.db;
    const collections = ['fhir_resources', 'fhir_resource_history', 'conformance_resources'];
    const result: Record<string, any[]> = {};

    for (const name of collections) {
      try {
        const stats = await db.collection(name).aggregate([{ $indexStats: {} }]).toArray();
        result[name] = stats.map((s) => ({ name: s.name, key: s.key, accesses: s.accesses }));
      } catch {
        result[name] = [];
      }
    }

    return result;
  }

  /** Returns database-level statistics (collection sizes, counts, storage). */
  async getDbStats(): Promise<Record<string, any>> {
    const db = this.connection.db;
    const collections = ['fhir_resources', 'fhir_resource_history', 'conformance_resources'];
    const result: Record<string, any> = {};

    for (const name of collections) {
      try {
        const stats = await db.command({ collStats: name });
        result[name] = { count: stats.count, size: stats.size, avgObjSize: stats.avgObjSize, storageSize: stats.storageSize, totalIndexSize: stats.totalIndexSize, nindexes: stats.nindexes };
      } catch {
        result[name] = { error: 'Collection not found' };
      }
    }

    return result;
  }
}
