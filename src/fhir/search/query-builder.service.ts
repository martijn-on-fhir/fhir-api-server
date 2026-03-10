import { Injectable, Logger } from '@nestjs/common';
import { CompositeQueryBuilder } from './builders/composite-query.builder';
import { DateQueryBuilder } from './builders/date-query.builder';
import { NumberQueryBuilder } from './builders/number-query.builder';
import { QuantityQueryBuilder } from './builders/quantity-query.builder';
import { SearchQueryBuilder } from './builders/query-builder.interface';
import { ReferenceQueryBuilder } from './builders/reference-query.builder';
import { StringQueryBuilder } from './builders/string-query.builder';
import { TokenQueryBuilder } from './builders/token-query.builder';
import { UriQueryBuilder } from './builders/uri-query.builder';
import { SearchParameterRegistry } from './search-parameter-registry.service';
import { SearchParamType } from './search-parameter.types';

/** Search result parameters that are handled separately (not translated to MongoDB filters). */
const RESULT_PARAMS = new Set(['_sort', '_count', '_offset', '_include', '_revinclude', '_summary', '_total', '_elements', '_contained', '_containedType', '_format', '_pretty']);

/** Pattern to detect chained search params (e.g. subject:Patient.name or subject.name). */
const CHAIN_PATTERN = /^[a-zA-Z_-]+(?::[A-Za-z]+)?\./;

/** Common search parameters with hardcoded MongoDB paths (not from the registry). */
const COMMON_PARAM_PATHS: Record<string, { path: string; type: SearchParamType }> = {
  _id: { path: 'id', type: 'token' },
  _lastUpdated: { path: 'meta.lastUpdated', type: 'date' },
  _tag: { path: 'meta.tag', type: 'token' },
  _profile: { path: 'meta.profile', type: 'uri' },
  _security: { path: 'meta.security', type: 'token' },
};

/**
 * Central service that translates FHIR search parameters into MongoDB filter queries.
 * Dispatches to type-specific query builders based on the parameter definition from the registry.
 */
@Injectable()
export class QueryBuilderService {

  private readonly logger = new Logger(QueryBuilderService.name);
  private readonly builders: Record<string, SearchQueryBuilder>;

  private initBuilders(): Record<string, SearchQueryBuilder> {

    const simple: Record<string, SearchQueryBuilder> = {
      string: new StringQueryBuilder(),
      token: new TokenQueryBuilder(),
      date: new DateQueryBuilder(),
      reference: new ReferenceQueryBuilder(),
      number: new NumberQueryBuilder(),
      quantity: new QuantityQueryBuilder(),
      uri: new UriQueryBuilder(),
    };

    simple.composite = new CompositeQueryBuilder(
      (type) => simple[type],
      (rt, code) => this.registry.resolvePaths(rt, code),
      (rt, code) => this.registry.getParam(rt, code) as any,
    );

    return simple;
  }

  constructor(private readonly registry: SearchParameterRegistry) {
    this.builders = this.initBuilders();
  }

  /**
   * Builds a MongoDB filter from FHIR search parameters.
   * @param resourceType - The FHIR resource type being searched.
   * @param params - Raw query parameters from the HTTP request.
   * @returns A MongoDB filter object suitable for Mongoose .find().
   */
  buildFilter(resourceType: string, params: Record<string, string>): Record<string, any> {

    const filter: Record<string, any> = { resourceType };
    const andConditions: Record<string, any>[] = [];

    for (const [rawKey, value] of Object.entries(params)) {

      // Skip result parameters
      if (RESULT_PARAMS.has(rawKey) || RESULT_PARAMS.has(rawKey.split(':')[0])) {
        continue;
      }

      // Skip chained params (handled by ChainingService)
      if (CHAIN_PATTERN.test(rawKey)) {
        continue;
      }

      // Skip _has params (handled by ChainingService)
      if (rawKey.startsWith('_has:')) {
        continue;
      }

      // Skip _include:iterate and _include:recurse
      if (rawKey.startsWith('_include:') || rawKey.startsWith('_revinclude:')) {
        continue;
      }

      // Parse modifier from parameter name (e.g. "name:exact" → code="name", modifier="exact")
      const colonIndex = rawKey.indexOf(':');
      const code = colonIndex >= 0 ? rawKey.substring(0, colonIndex) : rawKey;
      const modifier = colonIndex >= 0 ? rawKey.substring(colonIndex + 1) : undefined;

      const condition = this.buildCondition(resourceType, code, value, modifier);

      if (condition) {
        andConditions.push(condition);
      }
    }

    if (andConditions.length > 0) {
      Object.assign(filter, andConditions.length === 1 ? andConditions[0] : { $and: andConditions });
    }

    return filter;
  }

  private buildCondition(resourceType: string, code: string, value: string, modifier?: string): Record<string, any> | null {

    // Full-text search: _text searches narrative, _content searches full resource JSON
    if (code === '_text') {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      return { 'text.div': { $regex: escaped, $options: 'i' } };
    }

    if (code === '_content') {
      // Search across the entire resource as serialized JSON — use $where for flexibility
      // This is not performant on large datasets but correct; MongoDB text index can be added for production
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      return { $or: [{ 'text.div': { $regex: escaped, $options: 'i' } }, { $where: `JSON.stringify(this).match(/${escaped}/i) !== null` }] };
    }

    // Common parameters with hardcoded paths
    const common = COMMON_PARAM_PATHS[code];

    if (common) {
      const builder = this.builders[common.type];

      if (builder) {
        return builder.buildQuery({ paramDef: { code, type: common.type, expression: '', base: [] }, resolvedPaths: { paths: [common.path], isPolymorphic: false }, resourceType }, value, modifier);
      }
    }

    // Look up from registry
    const paramDef = this.registry.getParam(resourceType, code);

    if (!paramDef) {
      this.logger.debug(`Unknown search parameter '${code}' for ${resourceType}, ignoring`);

      return null;
    }

    const builder = this.builders[paramDef.type];

    if (!builder) {
      this.logger.debug(`No query builder for type '${paramDef.type}' (parameter '${code}'), ignoring`);

      return null;
    }

    const resolvedPaths = this.registry.resolvePaths(resourceType, code);

    if (!resolvedPaths || resolvedPaths.paths.length === 0) {
      return null;
    }

    return builder.buildQuery({ paramDef, resolvedPaths, resourceType }, value, modifier);
  }
}
