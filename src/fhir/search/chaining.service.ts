import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FhirResource } from '../fhir-resource.schema';
import { QueryBuilderService } from './query-builder.service';
import { SearchParameterRegistry } from './search-parameter-registry.service';

/**
 * Service that handles FHIR chained search and _has (reverse chaining).
 *
 * Chaining: `subject:Patient.name=John` → find Patients with name=John, then find resources referencing those Patients.
 * _has: `_has:Observation:subject:code=1234` → find Observations with code=1234, extract their subject references, match current resources.
 */
@Injectable()
export class ChainingService {

  private readonly logger = new Logger(ChainingService.name);

  constructor(@InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>, private readonly registry: SearchParameterRegistry, private readonly queryBuilder: QueryBuilderService) {}

  /**
   * Processes chained search parameters and returns MongoDB filter conditions.
   * A chained parameter looks like: `subject:Patient.name=John` or `subject.name=John`
   * @returns Array of MongoDB filter conditions to AND with the main query.
   */
  async resolveChainedParams(resourceType: string, params: Record<string, string>): Promise<Record<string, any>[]> {

    const conditions: Record<string, any>[] = [];

    for (const [rawKey, value] of Object.entries(params)) {
      // Detect chained parameters: contains a dot that's part of a chain (not a modifier)
      const chainMatch = rawKey.match(/^([a-zA-Z_-]+)(?::([A-Za-z]+))?\.(.+)$/);

      if (!chainMatch) {
        continue;
      }

      const [, refParam, targetType, chainedRest] = chainMatch;
      const condition = await this.resolveChain(resourceType, refParam, targetType, chainedRest, value);

      if (condition) {
        conditions.push(condition);
      }
    }

    return conditions;
  }

  /**
   * Processes _has parameters and returns MongoDB filter conditions.
   * Format: `_has:TargetType:referenceParam:searchParam=value`
   * @returns Array of MongoDB filter conditions to AND with the main query.
   */
  async resolveHasParams(resourceType: string, params: Record<string, string>): Promise<Record<string, any>[]> {

    const conditions: Record<string, any>[] = [];

    for (const [rawKey, value] of Object.entries(params)) {
      if (!rawKey.startsWith('_has:')) {
        continue;
      }

      // Format: _has:TargetType:referenceParam:searchParam
      const parts = rawKey.substring(5).split(':');

      if (parts.length < 3) {
        this.logger.debug(`Invalid _has format: ${rawKey}`);
        continue;
      }

      const [targetType, referenceParam, searchParam] = parts;
      const condition = await this.resolveHas(resourceType, targetType, referenceParam, searchParam, value);

      if (condition) {
        conditions.push(condition);
      }
    }

    return conditions;
  }

  /**
   * Resolves a single chained search.
   * 1. Search the target type for matching resources
   * 2. Extract their IDs
   * 3. Build a filter matching the reference field to those IDs
   */
  private async resolveChain(resourceType: string, refParam: string, targetType: string | undefined, chainedParamAndValue: string, value: string): Promise<Record<string, any> | null> {

    // Determine target resource type from the reference parameter definition
    const paramDef = this.registry.getParam(resourceType, refParam);

    if (!paramDef || paramDef.type !== 'reference') {
      this.logger.debug(`Chained search: '${refParam}' is not a reference parameter on ${resourceType}`);

      return null;
    }

    // Resolve target type: explicit (:Patient) or from parameter targets
    const resolvedTargetType = targetType || (paramDef.target?.length === 1 ? paramDef.target[0] : undefined);

    if (!resolvedTargetType) {
      this.logger.debug(`Chained search: cannot determine target type for '${refParam}' on ${resourceType}`);

      return null;
    }

    // Parse the chained part — it could itself be chained (multi-level), or have a modifier
    // For now support single-level: chainedRest = "paramName" or "paramName:modifier"
    const chainedColonIdx = chainedParamAndValue.indexOf(':');
    const chainedParam = chainedColonIdx >= 0 ? chainedParamAndValue.substring(0, chainedColonIdx) : chainedParamAndValue;
    const chainedModifier = chainedColonIdx >= 0 ? chainedParamAndValue.substring(chainedColonIdx + 1) : undefined;

    // Build filter for the target type
    const searchParams: Record<string, string> = {};

    if (chainedModifier) {
      searchParams[`${chainedParam}:${chainedModifier}`] = value;
    } else {
      searchParams[chainedParam] = value;
    }

    const { filter: targetFilter } = this.queryBuilder.buildFilter(resolvedTargetType, searchParams);

    // Find matching target resources
    const targetDocs = await this.resourceModel.find(targetFilter).select('resourceType id').lean().exec();

    if (targetDocs.length === 0) {
      // No matches — create an impossible condition
      return { _impossible: true };
    }

    // Build references to match: "TargetType/id"
    const targetRefs = targetDocs.map((d: any) => `${d.resourceType}/${d.id}`);

    // Resolve the reference parameter path
    const resolved = this.registry.resolvePaths(resourceType, refParam);

    if (!resolved || resolved.paths.length === 0) {
      return null;
    }

    // Match any reference field that points to one of the target resources
    const orConditions = resolved.paths.flatMap((path) => targetRefs.map((ref) => ({ [`${path}.reference`]: ref })));

    return orConditions.length === 1 ? orConditions[0] : { $or: orConditions };
  }

  /**
   * Resolves a single _has (reverse chain).
   * 1. Search the target type for resources matching the search param
   * 2. Extract the references from the reference param
   * 3. Match current resource IDs against those references
   */
  private async resolveHas(resourceType: string, targetType: string, referenceParam: string, searchParam: string, value: string): Promise<Record<string, any> | null> {

    // Build filter for the target type with the search param
    const searchParams: Record<string, string> = { [searchParam]: value };
    const { filter: targetFilter } = this.queryBuilder.buildFilter(targetType, searchParams);

    // Resolve the reference parameter path on the target type
    const refPaths = this.registry.resolvePaths(targetType, referenceParam);

    if (!refPaths || refPaths.paths.length === 0) {
      this.logger.debug(`_has: cannot resolve reference param '${referenceParam}' on ${targetType}`);

      return null;
    }

    // Find matching target resources and extract their reference values
    const selectFields = refPaths.paths.map((p) => `${p}`).join(' ');
    const targetDocs = await this.resourceModel.find(targetFilter).select(selectFields).lean().exec();

    if (targetDocs.length === 0) {
      return { _impossible: true };
    }

    // Extract referenced resource IDs
    const referencedIds = new Set<string>();

    for (const doc of targetDocs) {
      for (const path of refPaths.paths) {
        const refs = this.getNestedValues(doc, path);

        for (const ref of refs) {
          const refStr = typeof ref === 'string' ? ref : ref?.reference;

          if (refStr) {
            // Extract the ID part: "Patient/123" → "123" or absolute URL → "123"
            const match = refStr.match(/(?:^|\/)([a-zA-Z0-9._-]+)$/);

            if (match) {
              referencedIds.add(match[1]);
            }
          }
        }
      }
    }

    if (referencedIds.size === 0) {
      return { _impossible: true };
    }

    return { id: { $in: [...referencedIds] } };
  }

  /** Extracts values at a dot-notation path from an object, handling arrays. */
  private getNestedValues(obj: any, path: string): any[] {

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
