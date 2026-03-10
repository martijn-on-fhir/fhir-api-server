import { SearchPrefix, ParsedPrefixValue } from '../search-parameter.types';
import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR quantity search parameters.
 * Format: [prefix]number|system|code
 * All three parts are optional. Number uses prefix semantics like NumberQueryBuilder.
 */
export class QuantityQueryBuilder implements SearchQueryBuilder {

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

    const parts = rawValue.split('|');
    const numberPart = parts[0] || '';
    const system = parts.length > 1 ? parts[1] : undefined;
    const code = parts.length > 2 ? parts[2] : undefined;

    const conditions: Record<string, any> = {};

    // Number comparison
    if (numberPart) {
      const { prefix, value } = this.parsePrefix(numberPart);
      const num = parseFloat(value);

      const valuePath = `${path}.value`;

      switch (prefix) {
        case 'eq': { const delta = this.getImplicitDelta(value); Object.assign(conditions, { [valuePath]: { $gte: num - delta, $lt: num + delta } }); break; }

        case 'ne': { const delta = this.getImplicitDelta(value); conditions.$or = [{ [valuePath]: { $lt: num - delta } }, { [valuePath]: { $gte: num + delta } }]; break; }

        case 'gt': conditions[valuePath] = { $gt: num }; break;
        case 'lt': conditions[valuePath] = { $lt: num }; break;
        case 'ge': conditions[valuePath] = { $gte: num }; break;
        case 'le': conditions[valuePath] = { $lte: num }; break;
        case 'sa': conditions[valuePath] = { $gt: num }; break;
        case 'eb': conditions[valuePath] = { $lt: num }; break;
        case 'ap': conditions[valuePath] = { $gte: num * 0.9, $lte: num * 1.1 }; break;
      }
    }

    if (system) {
      conditions[`${path}.system`] = { $eq: system };
    }

    if (code) {
      conditions[`${path}.code`] = { $eq: code };
    }

    return conditions;
  }

  private parsePrefix(value: string): ParsedPrefixValue {

    const match = value.match(/^(eq|ne|gt|lt|ge|le|sa|eb|ap)(.+)$/);

    return match ? { prefix: match[1] as SearchPrefix, value: match[2] } : { prefix: 'eq', value };
  }

  private getImplicitDelta(value: string): number {

    const decimalIndex = value.indexOf('.');
    const precision = decimalIndex === -1 ? 0 : value.length - decimalIndex - 1;

    return 0.5 * Math.pow(10, -precision);
  }
}
