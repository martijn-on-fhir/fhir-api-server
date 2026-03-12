/** CLI configuration for the STU3 → R4 migration script. */
export interface MigrateConfig {
  source: string;
  target: string;
  types: string[] | null;
  sourceCollection: string;
  batchSize: number;
  dryRun: boolean;
}

/** Parse CLI arguments from process.argv into a MigrateConfig. */
export function parseArgs(argv: string[]): MigrateConfig {
  const args = argv.slice(2);
  const config: MigrateConfig = {source: '', target: 'mongodb://localhost:27017/fhir', types: null, sourceCollection: 'fhir_resources', batchSize: 500, dryRun: false};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
        config.source = args[++i];
        break;
      case '--target':
        config.target = args[++i];
        break;
      case '--types':
        config.types = args[++i].split(',').map(t => t.trim());
        break;
      case '--source-collection':
        config.sourceCollection = args[++i];
        break;
      case '--batch-size':
        config.batchSize = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!config.source) {
    console.error('Usage: npx ts-node scripts/migrate-stu3/index.ts --source <mongodb-uri> [--target <uri>] [--types Type1,Type2] [--source-collection name] [--batch-size 500] [--dry-run]');
    process.exit(1);
  }

  return config;
}
