import {Injectable, OnModuleInit, Logger} from '@nestjs/common';
import {InjectConnection} from '@nestjs/mongoose';
import {Connection} from 'mongoose';
import {fhirPathToMongo} from './fhirpath-to-mongo';
import {SearchParamDef, SearchParamType, ResolvedPaths} from './search-parameter.types';

/**
 * Registry of FHIR R4 SearchParameter definitions.
 * Loads SearchParameter resources from the conformance_resources MongoDB collection at startup.
 */
@Injectable()
export class SearchParameterRegistry implements OnModuleInit {

  private readonly logger = new Logger(SearchParameterRegistry.name);

  /** Map of `resourceType:paramCode` → SearchParamDef for fast lookup. */
  private paramMap = new Map<string, SearchParamDef>();

  /** Cache of resolved MongoDB paths per `resourceType:paramCode`. */
  private pathCache = new Map<string, ResolvedPaths>();

  /** All parameter definitions indexed by resource type. */
  private paramsByType = new Map<string, SearchParamDef[]>();

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit() {
    try {
      const collection = this.connection.db.collection('conformance_resources');
      const docs = await collection.find({resourceType: 'SearchParameter'}).toArray();
      let count = 0;

      for (const r of docs) {
        if (!r.code || !r.expression) {
continue;
}

        const def: SearchParamDef = {code: r.code, type: r.type as SearchParamType, expression: r.expression, base: r.base || [], target: r.target, component: r.component};

        for (const base of def.base) {
          this.paramMap.set(`${base}:${def.code}`, def);

          if (!this.paramsByType.has(base)) {
this.paramsByType.set(base, []);
}

          this.paramsByType.get(base).push(def);
        }

        count++;
      }

      this.logger.log(`Loaded ${count} search parameter definitions for ${this.paramsByType.size} resource types (source: MongoDB)`);
    } catch (e) {
      this.logger.warn(`Could not load search parameters from MongoDB: ${(e as Error).message}`);
    }
  }

  /** Look up a search parameter definition by resource type and parameter code. */
  getParam(resourceType: string, code: string): SearchParamDef | undefined {
    return this.paramMap.get(`${resourceType}:${code}`) || this.paramMap.get(`Resource:${code}`) || this.paramMap.get(`DomainResource:${code}`);
  }

  /** Get all search parameters defined for a resource type (including Resource-level). */
  getParamsForType(resourceType: string): SearchParamDef[] {
    const specific = this.paramsByType.get(resourceType) || [];
    const base = this.paramsByType.get('Resource') || [];
    const domain = this.paramsByType.get('DomainResource') || [];

    return [...specific, ...base, ...domain];
  }

  /** Resolve a search parameter's FHIRPath expression to MongoDB dot-notation paths. Results are cached. */
  resolvePaths(resourceType: string, code: string): ResolvedPaths | undefined {
    const cacheKey = `${resourceType}:${code}`;
    const cached = this.pathCache.get(cacheKey);

    if (cached) {
return cached;
}

    const def = this.getParam(resourceType, code);

    if (!def) {
return undefined;
}

    const resolved = fhirPathToMongo(def.expression, resourceType);
    this.pathCache.set(cacheKey, resolved);

    return resolved;
  }
}