import { SearchPrefix, ParsedPrefixValue } from '../search-parameter.types';
import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR date/dateTime search parameters.
 * Supports partial dates, implicit ranges and comparison prefixes (eq, ne, gt, lt, ge, le, sa, eb, ap).
 */
export class DateQueryBuilder implements SearchQueryBuilder {

  /** Builds a MongoDB filter for date/dateTime search. Supports :missing modifier. Comma-separated values are OR'd. */
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

  /** Builds a date range filter for a single path. Parses the prefix and computes the implicit range for partial dates. */
  private buildPathFilter(path: string, rawValue: string): Record<string, any> {

    const { prefix, value } = this.parsePrefix(rawValue);
    const { lower, upper } = this.getDateRange(value);

    switch (prefix) {
      case 'eq': return { [path]: { $gte: lower, $lt: upper } };
      case 'ne': return { $or: [{ [path]: { $lt: lower } }, { [path]: { $gte: upper } }] };
      case 'gt': return { [path]: { $gte: upper } };
      case 'lt': return { [path]: { $lt: lower } };
      case 'ge': return { [path]: { $gte: lower } };
      case 'le': return { [path]: { $lt: upper } };
      case 'sa': return { [path]: { $gte: upper } };
      case 'eb': return { [path]: { $lt: lower } };

      case 'ap': {
        // Approximately: ±10% of the range duration or ±1 day for dates
        const lowerDate = new Date(lower);
        const upperDate = new Date(upper);
        const duration = upperDate.getTime() - lowerDate.getTime();
        const margin = Math.max(duration * 0.1, 86400000); // at least 1 day
        const apLower = new Date(lowerDate.getTime() - margin).toISOString();
        const apUpper = new Date(upperDate.getTime() + margin).toISOString();

        return { [path]: { $gte: apLower, $lt: apUpper } };
      }

      default: return { [path]: { $gte: lower, $lt: upper } };
    }
  }

  /** Extracts a comparison prefix (eq, ne, gt, lt, ge, le, sa, eb, ap) from the raw value. Defaults to 'eq'. */
  private parsePrefix(value: string): ParsedPrefixValue {

    const prefixMatch = value.match(/^(eq|ne|gt|lt|ge|le|sa|eb|ap)(.+)$/);

    if (prefixMatch) {
      return { prefix: prefixMatch[1] as SearchPrefix, value: prefixMatch[2] };
    }

    return { prefix: 'eq', value };
  }

  /** Computes the implicit range for a partial date value. */
  private getDateRange(value: string): { lower: string; upper: string } {

    // Year only: 2024
    if (/^\d{4}$/.test(value)) {
      return { lower: `${value}-01-01T00:00:00.000Z`, upper: `${parseInt(value, 10) + 1}-01-01T00:00:00.000Z` };
    }

    // Year-month: 2024-03
    if (/^\d{4}-\d{2}$/.test(value)) {
      const [y, m] = value.split('-').map(Number);
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

      return { lower: `${value}-01T00:00:00.000Z`, upper: `${nextMonth}-01T00:00:00.000Z` };
    }

    // Full date: 2024-03-15
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const nextDay = new Date(value);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      return { lower: `${value}T00:00:00.000Z`, upper: nextDay.toISOString() };
    }

    // DateTime with time component — treat as instant (point in time)
    const instant = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;

    return { lower: instant, upper: new Date(new Date(instant).getTime() + 1).toISOString() };
  }
}
