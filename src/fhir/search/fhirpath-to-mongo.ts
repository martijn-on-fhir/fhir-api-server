import { ResolvedPaths } from './search-parameter.types';

/**
 * Known FHIR choice type suffixes for polymorphic [x] fields.
 * When a FHIRPath uses `(X.value as Quantity)` or `X.valueQuantity`, these are the possible concrete types.
 */
const CHOICE_TYPE_SUFFIXES = [
  'Address', 'Age', 'Annotation', 'Attachment', 'Base64Binary', 'Boolean', 'Canonical', 'Code',
  'CodeableConcept', 'Coding', 'ContactDetail', 'ContactPoint', 'Count', 'DataRequirement', 'Date',
  'DateTime', 'Decimal', 'Distance', 'Dosage', 'Duration', 'Expression', 'HumanName', 'Id',
  'Identifier', 'Instant', 'Integer', 'Markdown', 'Meta', 'Money', 'Oid', 'ParameterDefinition',
  'Period', 'Quantity', 'Range', 'Ratio', 'Reference', 'RelatedArtifact', 'SampledData', 'Signature',
  'String', 'Time', 'Timing', 'TriggerDefinition', 'UnsignedInt', 'Uri', 'Url', 'UsageContext', 'Uuid',
];

/**
 * Known FHIR choice type base field names (the [x] part).
 * When a FHIRPath expression ends in one of these, expand to commonly used concrete types.
 */
const KNOWN_CHOICE_BASES = new Set([
  'effective', 'onset', 'abatement', 'value', 'deceased', 'multipleBirth', 'occurrence',
  'performed', 'serviced', 'collected', 'timing', 'reported', 'medication', 'product',
  'defaultValue', 'fixed', 'pattern', 'minValue', 'maxValue', 'born', 'age',
  'used', 'allowed', 'rate', 'diagnosed',
]);

/** Most commonly used choice type suffixes in FHIR R4. Avoids 67-way $or by only expanding to practical types. */
const COMMON_CHOICE_SUFFIXES = [
  'DateTime', 'Period', 'String', 'Quantity', 'CodeableConcept', 'Boolean', 'Integer',
  'Range', 'Ratio', 'Reference', 'Instant', 'Date', 'Time', 'Age', 'Duration',
  'Timing', 'Identifier', 'Coding', 'Address', 'HumanName', 'Annotation', 'Attachment',
  'Decimal', 'Uri', 'Url', 'Canonical', 'Code', 'Markdown', 'Id', 'Oid', 'Uuid',
  'UnsignedInt', 'Money', 'Count', 'Distance', 'SampledData', 'Dosage',
];

/**
 * Converts a FHIR SearchParameter expression to MongoDB dot-notation paths.
 *
 * Handles:
 * - Simple paths: `Patient.name.family` → `name.family`
 * - `as` casts: `(Observation.value as Quantity)` → `valueQuantity`
 * - `ofType()`: `Observation.value.ofType(Quantity)` → `valueQuantity`
 * - `where()` filters: `Patient.name.where(use='official')` → `name` (filter handled at query level)
 * - `resolve()`: stripped (used for chaining, not direct queries)
 * - Pipe-separated alternatives: `expr1 | expr2` → multiple paths
 */
export const fhirPathToMongo = (expression: string, resourceType?: string): ResolvedPaths => {

  const alternatives = expression.split('|').map((s) => s.trim()).filter(Boolean);
  const paths: string[] = [];
  let isPolymorphic = false;

  for (const alt of alternatives) {
    const resolved = resolveSingleExpression(alt, resourceType);

    if (resolved.isPolymorphic) {
      isPolymorphic = true;
    }

    paths.push(...resolved.paths);
  }

  return { paths: [...new Set(paths)], isPolymorphic };
};

const resolveSingleExpression = (expr: string, resourceType?: string): ResolvedPaths => {

  let cleaned = expr.trim();

  // Handle `(Resource.field as Type)` → `Resource.fieldType`
  const asMatch = cleaned.match(/^\((.+?)\s+as\s+(\w+)\)(.*)$/);

  if (asMatch) {
    const basePath = asMatch[1].trim();
    const castType = asMatch[2];
    const suffix = asMatch[3].trim();
    const mongoPath = stripResourcePrefix(basePath, resourceType);
    const lastDot = mongoPath.lastIndexOf('.');
    const parentPath = lastDot >= 0 ? mongoPath.substring(0, lastDot) : '';
    const fieldName = lastDot >= 0 ? mongoPath.substring(lastDot + 1) : mongoPath;
    const resolvedField = `${fieldName}${castType}`;
    const fullPath = parentPath ? `${parentPath}.${resolvedField}` : resolvedField;

    if (suffix && suffix.startsWith('.')) {
      return { paths: [`${fullPath}${suffix}`], isPolymorphic: true };
    }

    return { paths: [fullPath], isPolymorphic: true };
  }

  // Strip .resolve()
  cleaned = cleaned.replace(/\.resolve\(\)/g, '');

  // Handle .ofType(Type) → fieldType
  const ofTypeMatch = cleaned.match(/^(.+?)\.ofType\((\w+)\)(.*)$/);

  if (ofTypeMatch) {
    const basePath = stripResourcePrefix(ofTypeMatch[1].trim(), resourceType);
    const castType = ofTypeMatch[2];
    const suffix = ofTypeMatch[3].trim();
    const lastDot = basePath.lastIndexOf('.');
    const parentPath = lastDot >= 0 ? basePath.substring(0, lastDot) : '';
    const fieldName = lastDot >= 0 ? basePath.substring(lastDot + 1) : basePath;
    const resolvedField = `${fieldName}${castType}`;
    const fullPath = parentPath ? `${parentPath}.${resolvedField}` : resolvedField;

    if (suffix && suffix.startsWith('.')) {
      return { paths: [`${fullPath}${suffix}`], isPolymorphic: true };
    }

    return { paths: [fullPath], isPolymorphic: true };
  }

  // Strip .where(...) — keep the path before it, filter is applied at query level
  cleaned = cleaned.replace(/\.where\([^)]*\)/g, '');

  // Strip .exists() and similar functions
  cleaned = cleaned.replace(/\.(exists|empty|not|first|last|count)\(\)/g, '');

  const mongoPath = stripResourcePrefix(cleaned, resourceType);

  // Check if the final segment is a known choice type base name (e.g. "effective" → effectiveDateTime, effectivePeriod, etc.)
  const lastDot = mongoPath.lastIndexOf('.');
  const lastSegment = lastDot >= 0 ? mongoPath.substring(lastDot + 1) : mongoPath;

  if (KNOWN_CHOICE_BASES.has(lastSegment)) {
    const prefix = lastDot >= 0 ? mongoPath.substring(0, lastDot + 1) : '';
    const expanded = COMMON_CHOICE_SUFFIXES.map((suffix) => `${prefix}${lastSegment}${suffix}`);

    return { paths: expanded, isPolymorphic: true };
  }

  return { paths: [mongoPath], isPolymorphic: false };
};

/** Removes the leading `ResourceType.` prefix to get a MongoDB document path. */
const stripResourcePrefix = (path: string, resourceType?: string): string => {

  if (resourceType && path.startsWith(`${resourceType}.`)) {
    return path.substring(resourceType.length + 1);
  }

  // Generic: strip first segment if it looks like a resource type (starts with uppercase)
  const firstDot = path.indexOf('.');

  if (firstDot > 0 && /^[A-Z]/.test(path)) {
    return path.substring(firstDot + 1);
  }

  return path;
};

/** Returns all possible concrete field names for a choice type base name (e.g. "value" → ["valueQuantity", "valueString", ...]). */
export const expandChoiceType = (fieldName: string): string[] => CHOICE_TYPE_SUFFIXES.map((suffix) => `${fieldName}${suffix}`);
