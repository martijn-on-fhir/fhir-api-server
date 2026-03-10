import { SearchPrefix, ParsedPrefixValue } from '../search-parameter.types';
import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR number search parameters.
 * Supports comparison prefixes and implicit precision ranges.
 */
export class NumberQueryBuilder implements SearchQueryBuilder {

  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null {

    if (modifier === 'missing') {
      const path = ctx.resolvedPaths.paths[0];

      return rawValue === 'true' ? { [path]: { $exists: false } } : { [path]: { $exists: true } };
    }

    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);

    if (values.length === 0) {
      return null;
    }

    const pathFilters = ctx.resolvedPaths.paths.flatMap((path) => values.map((value) => this.buildPathFilter(path, value)));

    return pathFilters.length === 1 ? pathFilters[0] : { $or: pathFilters };
  }

  private buildPathFilter(path: string, rawValue: string): Record<string, any> {

    const { prefix, value } = this.parsePrefix(rawValue);
    const num = parseFloat(value);

    // For eq/ne without explicit prefix, use implicit precision range
    if (prefix === 'eq') {
      const { lower, upper } = this.getImplicitRange(value);

      return { [path]: { $gte: lower, $lt: upper } };
    }

    switch (prefix) {
      case 'ne': { const { lower, upper } = this.getImplicitRange(value);

 return { $or: [{ [path]: { $lt: lower } }, { [path]: { $gte: upper } }] }; }

      case 'gt': return { [path]: { $gt: num } };
      case 'lt': return { [path]: { $lt: num } };
      case 'ge': return { [path]: { $gte: num } };
      case 'le': return { [path]: { $lte: num } };
      case 'sa': return { [path]: { $gt: num } };
      case 'eb': return { [path]: { $lt: num } };
      case 'ap': return { [path]: { $gte: num * 0.9, $lte: num * 1.1 } };
      default: return { [path]: num };
    }
  }

  private parsePrefix(value: string): ParsedPrefixValue {

    const match = value.match(/^(eq|ne|gt|lt|ge|le|sa|eb|ap)(.+)$/);

    return match ? { prefix: match[1] as SearchPrefix, value: match[2] } : { prefix: 'eq', value };
  }

  /** Calculates implicit precision range: "100" → [99.5, 100.5), "100.00" → [99.995, 100.005). */
  private getImplicitRange(value: string): { lower: number; upper: number } {

    const num = parseFloat(value);
    const decimalIndex = value.indexOf('.');
    const precision = decimalIndex === -1 ? 0 : value.length - decimalIndex - 1;
    const delta = 0.5 * Math.pow(10, -precision);

    return { lower: num - delta, upper: num + delta };
  }
}
