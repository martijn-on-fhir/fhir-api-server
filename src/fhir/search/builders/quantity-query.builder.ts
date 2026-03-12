import { SearchPrefix, ParsedPrefixValue } from '../search-parameter.types';
import { getUcumEquivalents } from '../ucum-conversions';
import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR quantity search parameters.
 * Format: [prefix]number|system|code
 * All three parts are optional. Number uses prefix semantics like NumberQueryBuilder.
 * Supports UCUM unit conversion: searching for "1|http://unitsofmeasure.org|kg" also matches "1000|...|g", "1000000|...|mg", etc.
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

    const pathFilters = ctx.resolvedPaths.paths.flatMap((path) => values.flatMap((value) => this.buildPathFilters(path, value)));

    return pathFilters.length === 1 ? pathFilters[0] : { $or: pathFilters };
  }

  /**
   * Builds one or more MongoDB filters for a single quantity search value on a single path.
   * When UCUM conversion is possible, returns filters for all equivalent unit representations.
   */
  private buildPathFilters(path: string, rawValue: string): Record<string, any>[] {

    const parts = rawValue.split('|');
    const numberPart = parts[0] || '';
    const system = parts.length > 1 ? parts[1] : undefined;
    const code = parts.length > 2 ? parts[2] : undefined;

    // Try UCUM conversion if we have a number and a code (system is optional — default to UCUM when code is provided)
    if (numberPart && code) {
      const { prefix, value } = this.parsePrefix(numberPart);
      const num = parseFloat(value);
      const equivalents = getUcumEquivalents(num, code, system || undefined);

      if (equivalents && equivalents.length > 1) {
        return equivalents.map((eq) => this.buildSingleFilter(path, prefix, value, eq.value, system, eq.code));
      }
    }

    // Fallback: no UCUM conversion, build a single literal filter
    return [this.buildLiteralFilter(path, numberPart, system, code)];
  }

  /** Builds a single quantity filter with an already-resolved numeric value and unit code. */
  private buildSingleFilter(path: string, prefix: SearchPrefix, originalValue: string, num: number, system?: string, code?: string): Record<string, any> {
    const conditions: Record<string, any> = {};
    const valuePath = `${path}.value`;

    // For converted values, recompute delta based on the converted number's significant digits
    switch (prefix) {
      case 'eq': { const delta = this.getImplicitDeltaForConverted(num, originalValue); Object.assign(conditions, { [valuePath]: { $gte: num - delta, $lt: num + delta } }); break; }

      case 'ne': { const delta = this.getImplicitDeltaForConverted(num, originalValue); conditions.$or = [{ [valuePath]: { $lt: num - delta } }, { [valuePath]: { $gte: num + delta } }]; break; }

      case 'gt': conditions[valuePath] = { $gt: num }; break;
      case 'lt': conditions[valuePath] = { $lt: num }; break;
      case 'ge': conditions[valuePath] = { $gte: num }; break;
      case 'le': conditions[valuePath] = { $lte: num }; break;
      case 'sa': conditions[valuePath] = { $gt: num }; break;
      case 'eb': conditions[valuePath] = { $lt: num }; break;
      case 'ap': conditions[valuePath] = { $gte: num * 0.9, $lte: num * 1.1 }; break;
    }

    if (system) {
      conditions[`${path}.system`] = { $eq: system };
    }

    if (code) {
      conditions[`${path}.code`] = { $eq: code };
    }

    return conditions;
  }

  /** Builds a single literal filter without UCUM conversion (original behavior). */
  private buildLiteralFilter(path: string, numberPart: string, system?: string, code?: string): Record<string, any> {
    const conditions: Record<string, any> = {};

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

  /** Implicit delta for literal search values (based on string precision). */
  private getImplicitDelta(value: string): number {

    const decimalIndex = value.indexOf('.');
    const precision = decimalIndex === -1 ? 0 : value.length - decimalIndex - 1;

    return 0.5 * Math.pow(10, -precision);
  }

  /**
   * Implicit delta for converted values. Preserves the relative precision of the original search value
   * by scaling the delta proportionally to the conversion ratio.
   */
  private getImplicitDeltaForConverted(convertedNum: number, originalValue: string): number {
    const originalNum = parseFloat(originalValue);

    if (originalNum === 0) {
      return this.getImplicitDelta(originalValue);
    }

    const originalDelta = this.getImplicitDelta(originalValue);

    return Math.abs(originalDelta * (convertedNum / originalNum));
  }
}
