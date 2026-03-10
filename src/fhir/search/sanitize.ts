/**
 * Input sanitization utilities to prevent NoSQL injection attacks.
 * Ensures all user-provided search parameter values remain plain strings
 * and cannot inject MongoDB operators ($gt, $ne, $where, etc.).
 */

/**
 * Ensures a value is a plain string. If it's an object (e.g. a parsed JSON with MongoDB operators),
 * it is coerced to a string representation. Null/undefined returns empty string.
 */
export const sanitizeValue = (value: unknown): string => {
  if (value === null || value === undefined) {
return '';
}

  if (typeof value === 'string') {
return value;
}

  return String(value);
};

/**
 * Recursively strips keys starting with '$' from an object to prevent MongoDB operator injection.
 * Returns a cleaned copy; primitives and arrays are passed through safely.
 */
export const stripDollarKeys = (obj: unknown): unknown => {
  if (obj === null || obj === undefined) {
return obj;
}

  if (typeof obj !== 'object') {
return obj;
}

  if (Array.isArray(obj)) {
return obj.map(stripDollarKeys);
}

  const cleaned: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (!key.startsWith('$')) {
      cleaned[key] = stripDollarKeys(val);
    }
  }

  return cleaned;
};

/**
 * Sanitizes all values in a search parameter record to plain strings.
 * Protects against Express query parsing producing objects from bracket notation (e.g. ?param[$gt]=value).
 */
export const sanitizeSearchParams = (params: Record<string, any>): Record<string, string> => {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'object' && value !== null) {
      // Express can parse ?key[$gt]=val into { key: { $gt: 'val' } } — flatten to string
      sanitized[key] = String(value);
    } else {
      sanitized[key] = sanitizeValue(value);
    }
  }

  return sanitized;
};

/**
 * Escapes a string for safe use in a MongoDB $regex, including forward slashes.
 * This is stricter than the standard regex escape — it also escapes '/' to prevent
 * regex delimiter breakout in interpolated patterns.
 */
export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
