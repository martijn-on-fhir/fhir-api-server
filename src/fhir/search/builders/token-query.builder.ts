import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR token search parameters.
 * Handles CodeableConcept, Coding, Identifier, code, boolean and ContactPoint.
 * Formats: [system]|[code], |[code], [code], [system]|
 * Modifiers: :text, :not, :missing, :of-type
 *
 * Token search must work across all coded types. The key difference:
 * - CodeableConcept: nested `coding` array with `system`/`code`, plus `text`
 * - Coding: direct `system`/`code`
 * - Identifier: `system`/`value` (NOT `code`)
 * - code/string: direct value match
 * - boolean: true/false
 * - ContactPoint: `value`
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

      return { $or: [
        { [`${path}.text`]: { $regex: escaped, $options: 'i' } },
        { [`${path}.coding.display`]: { $regex: escaped, $options: 'i' } },
        { [`${path}.display`]: { $regex: escaped, $options: 'i' } },
      ] };
    }

    if (modifier === 'missing') {
      return value === 'true' ? { [path]: { $exists: false } } : { [path]: { $exists: true } };
    }

    const { system, code, hasBar } = this.parseTokenValue(value);

    // Boolean
    if (!hasBar && (value === 'true' || value === 'false')) {
      return { [path]: value === 'true' };
    }

    // Simple code/value without system — match on all possible token representations
    if (!hasBar) {
      return { $or: [
        { [path]: code },                            // direct value (code enum, string)
        { [`${path}.code`]: code },                   // Coding.code
        { [`${path}.coding.code`]: code },            // CodeableConcept.coding[].code
        { [`${path}.value`]: code },                  // Identifier.value, ContactPoint.value
      ] };
    }

    // system| (any code/value in system)
    if (system && !code) {
      return { $or: [
        { [`${path}.system`]: system },               // Coding.system or Identifier.system
        { [`${path}.coding.system`]: system },         // CodeableConcept.coding[].system
      ] };
    }

    // |code (code/value with no/empty system)
    if (!system && code) {
      return { $or: [
        { [`${path}.code`]: code, [`${path}.system`]: { $exists: false } },
        { [`${path}.value`]: code, [`${path}.system`]: { $exists: false } },
        { [`${path}.coding`]: { $elemMatch: { code, system: { $exists: false } } } },
        { [path]: code },
      ] };
    }

    // system|code — match across CodeableConcept, Coding and Identifier
    return { $or: [
      { [`${path}.system`]: system, [`${path}.code`]: code },        // Coding
      { [`${path}.system`]: system, [`${path}.value`]: code },       // Identifier, ContactPoint
      { [`${path}.coding`]: { $elemMatch: { system, code } } },      // CodeableConcept
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
