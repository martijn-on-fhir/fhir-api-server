import { escapeRegex } from '../sanitize';
import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR reference search parameters.
 * Formats: [id], [type]/[id], absolute URL.
 * Modifier: :[type] restricts to a specific reference target type.
 * Modifier: :identifier searches by identifier on the referenced resource.
 * References are stored as relative paths (e.g. "Patient/123") in MongoDB.
 */
export class ReferenceQueryBuilder implements SearchQueryBuilder {

  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null {

    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);

    if (values.length === 0) {
      return null;
    }

    if (modifier === 'missing') {
      const path = ctx.resolvedPaths.paths[0];

      return rawValue === 'true' ? { [path]: { $exists: false } } : { [path]: { $exists: true } };
    }

    if (modifier === 'identifier') {
      return this.buildIdentifierQuery(ctx, values);
    }

    const pathFilters = ctx.resolvedPaths.paths.flatMap((path) => values.map((value) => this.buildPathFilter(path, value, modifier)));

    return pathFilters.length === 1 ? pathFilters[0] : { $or: pathFilters };
  }

  private buildPathFilter(path: string, value: string, modifier?: string): Record<string, any> {

    const refPath = `${path}.reference`;

    // Absolute URL — strip to relative if it contains a FHIR-like path
    let normalizedValue = value;

    if (value.startsWith('http://') || value.startsWith('https://')) {
      const fhirPathMatch = value.match(/\/(\w+\/[a-zA-Z0-9._-]+)$/);

      if (fhirPathMatch) {
        normalizedValue = fhirPathMatch[1];
      }
    }

    // If modifier specifies type (e.g. :Patient), prepend to bare id
    if (modifier && !normalizedValue.includes('/')) {
      normalizedValue = `${modifier}/${normalizedValue}`;
    }

    // If value contains a slash, it's Type/id — match exact or as suffix of absolute URL
    if (normalizedValue.includes('/')) {
      return { $or: [{ [refPath]: normalizedValue }, { [refPath]: { $regex: `/${escapeRegex(normalizedValue)}$` } }] };
    }

    // Bare id — match any reference ending with /id
    return { [refPath]: { $regex: `/${escapeRegex(normalizedValue)}$` } };
  }

  private buildIdentifierQuery(ctx: QueryBuilderContext, values: string[]): Record<string, any> {

    const filters = ctx.resolvedPaths.paths.flatMap((path) => values.map((value) => {
      const barIndex = value.indexOf('|');

      if (barIndex === -1) {
        return { [`${path}.identifier.value`]: value };
      }

      const system = value.substring(0, barIndex);
      const identifierValue = value.substring(barIndex + 1);

      if (system && identifierValue) {
        return { [`${path}.identifier.system`]: system, [`${path}.identifier.value`]: identifierValue };
      }

      if (identifierValue) {
        return { [`${path}.identifier.value`]: identifierValue };
      }

      return { [`${path}.identifier.system`]: system };
    }));

    return filters.length === 1 ? filters[0] : { $or: filters };
  }
}
