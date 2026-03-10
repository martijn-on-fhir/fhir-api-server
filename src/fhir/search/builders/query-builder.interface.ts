import { SearchParamDef, ResolvedPaths } from '../search-parameter.types';

/** Context passed to each query builder with the parameter definition and resolved MongoDB paths. */
export interface QueryBuilderContext {
  /** The search parameter definition from the registry. */
  paramDef: SearchParamDef;
  /** Resolved MongoDB paths for the parameter's FHIRPath expression. */
  resolvedPaths: ResolvedPaths;
  /** The resource type being searched. */
  resourceType: string;
}

/** Interface for type-specific FHIR search query builders. */
export interface SearchQueryBuilder {
  /** Builds a MongoDB filter for the given raw search value and optional modifier. */
  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null;
}
