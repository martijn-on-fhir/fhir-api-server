/** Supported FHIR search parameter types. */
export type SearchParamType = 'number' | 'date' | 'string' | 'token' | 'reference' | 'composite' | 'quantity' | 'uri' | 'special';

/** Parsed search parameter definition from the R4 spec. */
export interface SearchParamDef {

  /** Parameter name (e.g. "name", "gender", "birthdate"). */
  code: string;

  /** Search parameter type determining matching and modifier behavior. */
  type: SearchParamType;

  /** FHIRPath expression to evaluate on the resource (e.g. "Patient.name"). */
  expression: string;

  /** Resource types this parameter applies to. */
  base: string[];

  /** For reference parameters: allowed target resource types. */
  target?: string[];

  /** For composite parameters: the component parameter definitions. */
  component?: { definition: string; expression: string }[];
}

/** Resolved MongoDB paths for a search parameter, handling polymorphic [x] fields. */
export interface ResolvedPaths {

  /** One or more dot-notation MongoDB paths to query against. */
  paths: string[];
  /** Whether any path involves a polymorphic (choice type) field. */
  isPolymorphic: boolean;
}

/** Comparison prefix for number, date and quantity parameters. */
export type SearchPrefix = 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'sa' | 'eb' | 'ap';

/** Parsed search value with optional prefix. */
export interface ParsedPrefixValue {
  prefix: SearchPrefix;
  value: string;
}
