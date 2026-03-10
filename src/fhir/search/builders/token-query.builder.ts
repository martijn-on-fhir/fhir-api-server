import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR token search parameters.
 * Handles CodeableConcept, Coding, Identifier, code, boolean and ContactPoint.
 * Formats: [system]|[code], |[code], [code], [system]|
 * Modifiers: :text, :not, :missing
 */
export class TokenQueryBuilder implements SearchQueryBuilder {

  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null {

    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);

    if (values.length === 0) {
      return null;
    }

    const pathFilters = ctx.resolvedPaths.paths.flatMap((path) => values.map((value) => this.buildPathFilter(path, value, modifier)));
    const combined = pathFilters.length === 1 ? pathFilters[0] : { $or: pathFilters };

    if (modifier === 'not') {
      return { $nor: [combined] };
    }

    return combined;
  }

  private buildPathFilter(path: string, value: string, modifier?: string): Record<string, any> {

    if (modifier === 'text') {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      return { $or: [{ [`${path}.text`]: { $regex: escaped, $options: 'i' } }, { [`${path}.coding.display`]: { $regex: escaped, $options: 'i' } }, { [`${path}.display`]: { $regex: escaped, $options: 'i' } }] };
    }

    if (modifier === 'missing') {
      return value === 'true' ? { [path]: { $exists: false } } : { [path]: { $exists: true } };
    }

    const { system, code, hasBar } = this.parseTokenValue(value);

    // Boolean or simple code field (no system)
    if (!hasBar && (value === 'true' || value === 'false')) {
      return { [path]: value === 'true' };
    }

    // Simple code without system — match on direct code or within coding array
    if (!hasBar) {
      return { $or: [{ [path]: code }, { [`${path}.code`]: code }, { [`${path}.coding.code`]: code }, { [`${path}.value`]: code }] };
    }

    // system| (any code in system)
    if (system && !code) {
      return { $or: [{ [`${path}.system`]: system }, { [`${path}.coding.system`]: system }] };
    }

    // |code (code with no/empty system)
    if (!system && code) {
      return { $or: [
        { [`${path}.code`]: code, [`${path}.system`]: { $exists: false } },
        { [`${path}.coding`]: { $elemMatch: { code, system: { $exists: false } } } },
        { [path]: code },
      ] };
    }

    // system|code (both specified)
    return { $or: [
      { [`${path}.system`]: system, [`${path}.code`]: code },
      { [`${path}.coding`]: { $elemMatch: { system, code } } },
    ] };
  }

  private parseTokenValue(value: string): { system: string; code: string; hasBar: boolean } {

    const barIndex = value.indexOf('|');

    if (barIndex === -1) {
      return { system: '', code: value, hasBar: false };
    }

    return { system: value.substring(0, barIndex), code: value.substring(barIndex + 1), hasBar: true };
  }
}
