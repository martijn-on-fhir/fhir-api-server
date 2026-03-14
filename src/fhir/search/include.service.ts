import { Inject, Injectable, Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { FhirResource } from '../fhir-resource.schema';
import { FHIR_RESOURCE_MODEL } from '../fhir.constants';
import { SearchParameterRegistry } from './search-parameter-registry.service';

/** Maximum number of included resources returned per search. Configurable via MAX_INCLUDE_RESULTS env var. */
const MAX_INCLUDE_RESULTS = parseInt(process.env.MAX_INCLUDE_RESULTS || '1000', 10);

/** Parsed _include or _revinclude directive. */
interface IncludeDirective {
  sourceType: string;
  searchParam: string;
  targetType?: string;
  iterate?: boolean;
}

/**
 * Service that handles FHIR _include and _revinclude search result parameters.
 * After a primary search, resolves forward and reverse references and fetches the included resources.
 */
@Injectable()
export class IncludeService {

  private readonly logger = new Logger(IncludeService.name);

  constructor(@Inject(FHIR_RESOURCE_MODEL) private readonly resourceModel: Model<FhirResource>, private readonly registry: SearchParameterRegistry) {}

  /**
   * Resolves _include and _revinclude directives for a set of primary search results.
   * @returns Array of included resources (to be added to the Bundle with search.mode='include').
   */
  async resolveIncludes(primaryResults: FhirResource[], resourceType: string, params: Record<string, string>): Promise<FhirResource[]> {

    const includes = this.parseIncludeParams(params._include || params['_include'] || '', resourceType);
    const revIncludes = this.parseIncludeParams(params._revinclude || params['_revinclude'] || '', undefined);
    const iterateIncludes = this.parseIncludeParams(params['_include:iterate'] || params['_include:recurse'] || '', resourceType);

    if (includes.length === 0 && revIncludes.length === 0 && iterateIncludes.length === 0) {
      return [];
    }

    const includedMap = new Map<string, FhirResource>();
    const primaryIds = new Set(primaryResults.map((r) => `${r.resourceType}/${r.id}`));

    // Forward includes
    if (includes.length > 0) {
      const forwardResults = await this.resolveForwardIncludes(primaryResults, includes);

      for (const r of forwardResults) {
        const key = `${r.resourceType}/${r.id}`;

        if (!primaryIds.has(key)) {
          includedMap.set(key, r);
        }
      }
    }

    // Reverse includes
    if (revIncludes.length > 0) {
      const reverseResults = await this.resolveReverseIncludes(primaryResults, revIncludes);

      for (const r of reverseResults) {
        const key = `${r.resourceType}/${r.id}`;

        if (!primaryIds.has(key)) {
          includedMap.set(key, r);
        }
      }
    }

    // Iterate includes (one level of iteration)
    if (iterateIncludes.length > 0) {
      const allResults = [...primaryResults, ...includedMap.values()];
      const iterateResults = await this.resolveForwardIncludes(allResults, iterateIncludes);

      for (const r of iterateResults) {
        const key = `${r.resourceType}/${r.id}`;

        if (!primaryIds.has(key) && !includedMap.has(key)) {
          includedMap.set(key, r);
        }
      }
    }

    const results = [...includedMap.values()];

    if (results.length > MAX_INCLUDE_RESULTS) {
      this.logger.warn(`_include results truncated from ${results.length} to ${MAX_INCLUDE_RESULTS}`);

      return results.slice(0, MAX_INCLUDE_RESULTS);
    }

    return results;
  }

  private parseIncludeParams(raw: string, defaultSourceType?: string): IncludeDirective[] {

    if (!raw) {
      return [];
    }

    return raw.split(',').map((v) => v.trim()).filter(Boolean).map((value) => {
      const parts = value.split(':');

      // Format: SourceType:searchParam[:targetType]
      if (parts.length >= 2) {
        return { sourceType: parts[0], searchParam: parts[1], targetType: parts[2], iterate: false };
      }

      // Wildcard: _include=*
      if (value === '*' && defaultSourceType) {
        return { sourceType: defaultSourceType, searchParam: '*', iterate: false };
      }

      return null;
    }).filter(Boolean) as IncludeDirective[];
  }

  /** Resolves forward _include: follow references from primary results and fetch the referenced resources. */
  private async resolveForwardIncludes(resources: FhirResource[], includes: IncludeDirective[]): Promise<FhirResource[]> {

    const refsToFetch = new Set<string>();

    for (const inc of includes) {
      const matchingResources = resources.filter((r) => r.resourceType === inc.sourceType);

      if (inc.searchParam === '*') {
        // Include all references from the resource
        for (const res of matchingResources) {
          this.extractAllReferences(res.toObject ? res.toObject() : res, refsToFetch);
        }
      } else {
        const resolved = this.registry.resolvePaths(inc.sourceType, inc.searchParam);

        if (!resolved) {
          this.logger.debug(`Cannot resolve _include param '${inc.searchParam}' for ${inc.sourceType}`);
          continue;
        }

        for (const res of matchingResources) {
          const obj = res.toObject ? res.toObject() : res;

          for (const path of resolved.paths) {
            const refs = this.getValuesAtPath(obj, path);

            for (const ref of refs) {
              const refStr = typeof ref === 'string' ? ref : ref?.reference;

              if (refStr && !refStr.startsWith('http')) {
                if (!inc.targetType || refStr.startsWith(`${inc.targetType}/`)) {
                  refsToFetch.add(refStr);
                }
              } else if (refStr) {
                // Absolute URL — extract relative part
                const match = refStr.match(/\/(\w+\/[a-zA-Z0-9._-]+)$/);

                if (match && (!inc.targetType || match[1].startsWith(`${inc.targetType}/`))) {
                  refsToFetch.add(match[1]);
                }
              }
            }
          }
        }
      }
    }

    if (refsToFetch.size === 0) {
      return [];
    }

    // Group by resourceType and use $in for efficient batched lookup
    const byType = new Map<string, string[]>();

    for (const ref of refsToFetch) {
      const [type, id] = ref.split('/');

      if (!byType.has(type)) {
        byType.set(type, []);
      }

      byType.get(type).push(id);
    }

    if (byType.size === 1) {
      const [type, ids] = [...byType.entries()][0];

      return this.resourceModel.find({ resourceType: type, id: { $in: ids } }).exec();
    }

    const orConditions = [...byType.entries()].map(([type, ids]) => ({ resourceType: type, id: { $in: ids } }));

    return this.resourceModel.find({ $or: orConditions }).exec();
  }

  /** Resolves reverse _revinclude: find resources that reference any of the primary results. */
  private async resolveReverseIncludes(primaryResults: FhirResource[], revIncludes: IncludeDirective[]): Promise<FhirResource[]> {

    const allResults: FhirResource[] = [];

    for (const inc of revIncludes) {
      const resolved = this.registry.resolvePaths(inc.sourceType, inc.searchParam);

      if (!resolved) {
        this.logger.debug(`Cannot resolve _revinclude param '${inc.searchParam}' for ${inc.sourceType}`);
        continue;
      }

      // Build filter: find resources of inc.sourceType that reference any primary result
      const targetRefs = primaryResults.map((r) => `${r.resourceType}/${r.id}`);

      if (targetRefs.length === 0) {
        continue;
      }

      const orFilters = resolved.paths.map((path) => ({ [`${path}.reference`]: { $in: targetRefs } }));
      const filter: Record<string, any> = { resourceType: inc.sourceType };

      if (orFilters.length === 1) {
        Object.assign(filter, orFilters[0]);
      } else {
        filter.$or = orFilters;
      }

      const results = await this.resourceModel.find(filter).limit(MAX_INCLUDE_RESULTS).exec();
      allResults.push(...results);
    }

    return allResults;
  }

  /** Recursively extracts all reference strings from a FHIR resource. */
  private extractAllReferences(obj: any, refs: Set<string>): void {

    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractAllReferences(item, refs);
      }

      return;
    }

    if (obj.reference && typeof obj.reference === 'string') {
      const ref = obj.reference;

      if (!ref.startsWith('http')) {
        refs.add(ref);
      } else {
        const match = ref.match(/\/(\w+\/[a-zA-Z0-9._-]+)$/);

        if (match) {
          refs.add(match[1]);
        }
      }
    }

    for (const value of Object.values(obj)) {
      this.extractAllReferences(value, refs);
    }
  }

  /** Gets values at a dot-notation path from an object, supporting arrays at any level. */
  private getValuesAtPath(obj: any, path: string): any[] {

    const parts = path.split('.');
    let current: any[] = [obj];

    for (const part of parts) {
      const next: any[] = [];

      for (const item of current) {
        if (item == null) {
          continue;
        }

        if (Array.isArray(item)) {
          for (const sub of item) {
            if (sub?.[part] !== undefined) {
              next.push(sub[part]);
            }
          }
        } else if (item[part] !== undefined) {
          const val = item[part];
          next.push(...(Array.isArray(val) ? val : [val]));
        }
      }

      current = next;
    }

    return current;
  }
}
