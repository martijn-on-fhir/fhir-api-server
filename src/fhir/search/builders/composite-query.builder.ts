import { SearchQueryBuilder, QueryBuilderContext } from './query-builder.interface';

/**
 * Builds MongoDB queries for FHIR composite search parameters.
 * Composite parameters combine two or more sub-parameters that must match on the same element.
 * Format: value1$value2 where each component maps to a sub-parameter defined in the SearchParameter.component.
 */
export class CompositeQueryBuilder implements SearchQueryBuilder {

  constructor(
    private readonly builderLookup: (type: string) => SearchQueryBuilder | undefined,
    private readonly pathResolver: (resourceType: string, code: string) => { paths: string[]; isPolymorphic: boolean } | undefined,
    private readonly paramLookup: (resourceType: string, code: string) => { code: string; type: string; expression: string; base: string[] } | undefined,
  ) {}

  buildQuery(ctx: QueryBuilderContext, rawValue: string, modifier?: string): Record<string, any> | null {

    if (modifier === 'missing') {
      const path = ctx.resolvedPaths.paths[0];

      return rawValue === 'true' ? { [path]: { $exists: false } } : { [path]: { $exists: true } };
    }

    const components = ctx.paramDef.component;

    if (!components || components.length === 0) {
      return null;
    }

    // OR across comma-separated values
    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);
    const orFilters = values.map((value) => this.buildSingleComposite(ctx, value, components)).filter(Boolean) as Record<string, any>[];

    if (orFilters.length === 0) {
      return null;
    }

    return orFilters.length === 1 ? orFilters[0] : { $or: orFilters };
  }

  private buildSingleComposite(ctx: QueryBuilderContext, rawValue: string, components: { definition: string; expression: string }[]): Record<string, any> | null {

    // Split composite value by $ separator
    const parts = rawValue.split('$');

    if (parts.length !== components.length) {
      return null;
    }

    const andConditions: Record<string, any>[] = [];

    for (let i = 0; i < components.length; i++) {
      const componentValue = parts[i];

      if (!componentValue) {
        continue;
      }

      const comp = components[i];
      // Extract the sub-parameter code from the definition URL (e.g. "http://hl7.org/fhir/SearchParameter/Observation-code" → "code")
      const defCode = comp.definition.split('-').pop() || comp.definition.split('/').pop() || '';
      const subParam = this.paramLookup(ctx.resourceType, defCode);

      if (!subParam) {
        continue;
      }

      const subBuilder = this.builderLookup(subParam.type);

      if (!subBuilder) {
        continue;
      }

      const subPaths = this.pathResolver(ctx.resourceType, defCode);

      if (!subPaths || subPaths.paths.length === 0) {
        continue;
      }

      const condition = subBuilder.buildQuery({ paramDef: subParam as any, resolvedPaths: subPaths, resourceType: ctx.resourceType }, componentValue);

      if (condition) {
        andConditions.push(condition);
      }
    }

    if (andConditions.length === 0) {
      return null;
    }

    return andConditions.length === 1 ? andConditions[0] : { $and: andConditions };
  }
}
