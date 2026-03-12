import { Db } from 'mongodb';
import { ResourceMapper } from './mapper.interface';

/** Statistics for a single resource type migration. */
export interface MigrateStats {
  resourceType: string;
  processed: number;
  succeeded: number;
  failed: number;
  warnings: string[];
}

/** Migrate all resources of a given type from source to target. */
export async function migrateResourceType(sourceDb: Db, targetDb: Db, sourceCollection: string, mapper: ResourceMapper, batchSize: number, dryRun: boolean): Promise<MigrateStats> {
  const stats: MigrateStats = { resourceType: mapper.sourceType, processed: 0, succeeded: 0, failed: 0, warnings: [] };
  const cursor = sourceDb.collection(sourceCollection).find({ resourceType: mapper.sourceType }).batchSize(batchSize);
  let batch: any[] = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      const ops = batch.map(resource => ({
        updateOne: { filter: { resourceType: resource.resourceType, id: resource.id }, update: { $set: resource }, upsert: true },
      }));
      await targetDb.collection('fhir_resources').bulkWrite(ops, { ordered: false });
    }
    batch = [];
  };

  for await (const doc of cursor) {
    stats.processed++;
    try {
      const result = mapper.map(doc);
      stats.warnings.push(...result.warnings);
      for (const resource of result.resources) {
        stats.succeeded++;
        batch.push(resource);
        if (batch.length >= batchSize) await flushBatch();
      }
    } catch (e) {
      stats.failed++;
      stats.warnings.push(`ERROR ${mapper.sourceType}/${doc.id}: ${e.message}`);
    }
  }

  await flushBatch();
  return stats;
}
