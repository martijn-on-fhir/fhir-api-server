import {parseArgs} from './config';
import {connect, disconnect} from './db';
import {mapperRegistry, getSupportedTypes} from './mappers';
import {migrateResourceType, MigrateStats} from './migrate';

const main = async () => {

  const config = parseArgs(process.argv);
  const types = config.types || getSupportedTypes();
  const unsupported = types.filter(t => !mapperRegistry.has(t));

  if (unsupported.length > 0) {
    console.error(`Unsupported resource types: ${unsupported.join(', ')}`);
    console.error(`Supported types: ${getSupportedTypes().join(', ')}`);
    process.exit(1);
  }

  console.log(`\nSTU3 → R4 Migration`);
  console.log(`  Source:     ${config.source}`);
  console.log(`  Target:     ${config.target}`);
  console.log(`  Collection: ${config.sourceCollection}`);
  console.log(`  Types:      ${types.join(', ')}`);
  console.log(`  Batch size: ${config.batchSize}`);
  console.log(`  Dry run:    ${config.dryRun}\n`);

  const conns = await connect(config.source, config.target);
  const allStats: MigrateStats[] = [];

  try {
    for (const type of types) {

      const mapper = mapperRegistry.get(type)!;
      console.log(`Migrating ${type}...`);
      const stats = await migrateResourceType(conns.sourceDb, conns.targetDb, config.sourceCollection, mapper, config.batchSize, config.dryRun);
      allStats.push(stats);
      console.log(`  ✓ ${stats.succeeded} succeeded, ${stats.failed} failed (${stats.processed} processed)`);

      if (stats.warnings.length > 0) {
        stats.warnings.forEach(w => console.log(`    ⚠ ${w}`));
      }
    }

    // Summary
    console.log('\n--- Summary ---');
    const totalProcessed = allStats.reduce((sum, s) => sum + s.processed, 0);
    const totalSucceeded = allStats.reduce((sum, s) => sum + s.succeeded, 0);
    const totalFailed = allStats.reduce((sum, s) => sum + s.failed, 0);
    const totalWarnings = allStats.reduce((sum, s) => sum + s.warnings.length, 0);
    console.log(`Total: ${totalProcessed} processed, ${totalSucceeded} succeeded, ${totalFailed} failed, ${totalWarnings} warnings`);

    if (config.dryRun) {
      console.log('(Dry run — no data was written)');
    }
  }
  finally {
    await disconnect(conns);
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
