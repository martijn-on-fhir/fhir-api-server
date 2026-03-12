import {createHash} from 'crypto';
import {readFileSync, readdirSync, statSync, existsSync} from 'fs';
import {resolve, join} from 'path';
import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {AdministrationService} from '../administration.service';

const CONFORMANCE_TYPES = new Set(['StructureDefinition', 'ValueSet', 'CodeSystem', 'SearchParameter', 'CompartmentDefinition',
  'OperationDefinition', 'NamingSystem', 'ConceptMap', 'ImplementationGuide']);

/**
 * Seeds conformance resources (StructureDefinition, ValueSet, CodeSystem, etc.) from JSON files
 * in the `file-import/` directory into the administration database on application startup.
 *
 * Uses MD5 hashing of file paths and sizes for change detection, so imports are skipped
 * when the import directory hasn't changed since the last seed.
 */
@Injectable()
export class ConformanceSeederService implements OnModuleInit {

  private readonly logger = new Logger(ConformanceSeederService.name);
  private readonly importDir = resolve(process.cwd(), 'file-import');

  constructor(private readonly administrationService: AdministrationService) {
  }

  /**
   * NestJS lifecycle hook — triggers the seed process when the module initializes.
   * Logs a warning and skips if the import directory does not exist.
   */
  async onModuleInit() {

    if (!existsSync(this.importDir)) {
      this.logger.warn(`Import directory not found: ${this.importDir} — skipping seed`);

      return;
    }

    try {
      await this.seed();
    } catch (err) {
      this.logger.error(`Seeding failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Reads all JSON files from the import directory, parses conformance resources
   * (including Bundle entries), computes a change-detection hash, and bulk-upserts
   * new or changed resources into the administration store.
   */
  private async seed() {

    const files = this.collectJsonFiles(this.importDir);
    this.logger.log(`Found ${files.length} JSON files in ${this.importDir}`);

    // Compute hash of all file paths + sizes for change detection
    const hashInput = files.map((f) => `${f}:${statSync(f).size}`).sort().join('\n');
    const currentHash = createHash('md5').update(hashInput).digest('hex');
    const storedHash = await this.administrationService.getSeedVersion();

    if (storedHash === currentHash) {
      this.logger.log('Seed hash unchanged — skipping import');

      return;
    }

    // Parse all files and collect conformance resources
    const resources: any[] = [];
    let skipped = 0;

    for (const file of files) {

      try {
        const content = JSON.parse(readFileSync(file, 'utf-8'));

        // Bundle: extract entries
        if (content.resourceType === 'Bundle' && Array.isArray(content.entry)) {
          for (const entry of content.entry) {
            const r = entry.resource || entry;

            if (r.resourceType && CONFORMANCE_TYPES.has(r.resourceType)) {
              resources.push(r);
            }
          }

          continue;
        }

        // Single conformance resource
        if (content.resourceType && CONFORMANCE_TYPES.has(content.resourceType)) {
          resources.push(content);
        } else {
          skipped++;
        }
      } catch {
        this.logger.warn(`Failed to parse: ${file}`);
      }
    }

    this.logger.log(`Parsed ${resources.length} conformance resources (${skipped} non-conformance files skipped)`);

    if (resources.length === 0) {
      return;
    }

    const upserted = await this.administrationService.bulkUpsert(resources);
    await this.administrationService.setSeedVersion(currentHash);

    this.logger.log(`Seeding complete: ${upserted} new resources inserted, ${resources.length - upserted} already existed`);
  }

  /**
   * Recursively collects all `.json` file paths from the given directory.
   * @param dir - The root directory to scan.
   * @returns Array of absolute file paths to JSON files.
   */
  private collectJsonFiles(dir: string): string[] {

    const results: string[] = [];
    const entries = readdirSync(dir, {withFileTypes: true});

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...this.collectJsonFiles(fullPath));
      } else if (entry.name.endsWith('.json')) {
        results.push(fullPath);
      }
    }

    return results;
  }
}