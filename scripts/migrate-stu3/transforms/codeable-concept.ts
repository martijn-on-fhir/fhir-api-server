/** Utility for wrapping plain strings into CodeableConcepts where R4 requires them. */

/** Wrap a string value into a CodeableConcept with text only. Returns the value unchanged if already an object. */
export function ensureCodeableConcept(value: any): any {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return {text: value};
  }

  return value;
}

/** Ensure a value is wrapped in an array (R4 changed some single → array fields like Location.type). */
export function ensureArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value == null) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}
