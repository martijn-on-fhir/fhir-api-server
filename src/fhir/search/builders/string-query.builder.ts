import { escapeRegex } from '../sanitize';
import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * FHIR string search sub-fields for complex types.
 * When a string search targets a HumanName or Address, the search must match across the relevant sub-fields.
 * See: https://www.hl7.org/fhir/R4/search.html#string
 */
const STRING_SEARCH_SUBFIELDS: Record<string, string[]> = {
  HumanName: ['family', 'given', 'text', 'prefix', 'suffix'],
  Address: ['line', 'city', 'district', 'state', 'postalCode', 'country', 'text'],
};

/** FHIRPath expression hints that indicate a complex type target. */
const COMPLEX_TYPE_HINTS: Record<string, string> = {
  name: 'HumanName',
  address: 'Address',
};

/**
 * Builds MongoDB queries for FHIR string search parameters.
 * Default: case-insensitive starts-with. Modifiers: :exact, :contains, :missing.
 * Handles complex types (HumanName, Address) by expanding to sub-field searches.
 */
export class StringQueryBuilder implements SearchQueryBuilder {

  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null {

    if (modifier === 'missing') {
      const path = ctx.resolvedPaths.paths[0];

      return rawValue === 'true' ? { [path]: { $exists: false } } : { [path]: { $exists: true } };
    }

    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);

    if (values.length === 0) {
      return null;
    }

    const pathFilters = ctx.resolvedPaths.paths.flatMap((path) => {
      // Determine if this path targets a complex type
      const lastSegment = path.split('.').pop() || '';
      const complexType = COMPLEX_TYPE_HINTS[lastSegment];
      const subFields = complexType ? STRING_SEARCH_SUBFIELDS[complexType] : undefined;

      if (subFields) {
        // Expand to sub-field searches: name.family, name.given, name.text, etc.
        return values.flatMap((value) => subFields.map((sub) => this.buildPathFilter(`${path}.${sub}`, value, modifier)));
      }

      return values.map((value) => this.buildPathFilter(path, value, modifier));
    });

    return pathFilters.length === 1 ? pathFilters[0] : { $or: pathFilters };
  }

  private buildPathFilter(path: string, value: string, modifier?: string): Record<string, any> {

    const escaped = escapeRegex(value);

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
