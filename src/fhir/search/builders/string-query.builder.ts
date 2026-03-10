import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR string search parameters.
 * Default: case-insensitive starts-with. Modifiers: :exact, :contains.
 */
export class StringQueryBuilder implements SearchQueryBuilder {

  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null {

    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);

    if (values.length === 0) {
      return null;
    }

    const pathFilters = ctx.resolvedPaths.paths.flatMap((path) => values.map((value) => this.buildPathFilter(path, value, modifier)));

    return pathFilters.length === 1 ? pathFilters[0] : { $or: pathFilters };
  }

  private buildPathFilter(path: string, value: string, modifier?: string): Record<string, any> {

    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (modifier === 'exact') {
      return { [path]: value };
    }

    if (modifier === 'contains') {
      return { [path]: { $regex: escaped, $options: 'i' } };
    }

    // Default: starts-with, case-insensitive
    return { [path]: { $regex: `^${escaped}`, $options: 'i' } };
  }
}
