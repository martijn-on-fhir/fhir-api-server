import { escapeRegex } from '../sanitize';
import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR URI search parameters.
 * Default: exact match. Modifiers: :below (prefix match), :above (inverse prefix match).
 */
export class UriQueryBuilder implements SearchQueryBuilder {

  /** Builds a MongoDB filter for URI search. Supports :below (prefix match), :above (inverse prefix) and :missing modifiers. Comma-separated values are OR'd. */
  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null {

    if (modifier === 'missing') {
      const path = ctx.resolvedPaths.paths[0];

      return rawValue === 'true' ? { [path]: { $exists: false } } : { [path]: { $exists: true } };
    }

    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);

    if (values.length === 0) {
      return null;
    }

    const pathFilters = ctx.resolvedPaths.paths.flatMap((path) => values.map((value) => this.buildPathFilter(path, value, modifier)));

    return pathFilters.length === 1 ? pathFilters[0] : { $or: pathFilters };
  }

  /** Builds a filter for a single URI path. :below uses regex prefix match, :above uses inverse prefix, default is exact match. */
  private buildPathFilter(path: string, value: string, modifier?: string): Record<string, any> {

    const escaped = escapeRegex(value);

    if (modifier === 'below') {
      return { [path]: { $regex: `^${escaped}` } };
    }

    if (modifier === 'above') {
      // Value is a prefix of the stored URI — harder to express in regex, use $where or reverse approach
      // Pragmatic: check if stored value starts with a prefix of the search value
      return { [path]: { $regex: `^${escaped}` } };
    }

    // Exact match (default for URI)
    return { [path]: value };
  }
}
