/**
 * SMART on FHIR scope parsing and matching.
 * Scope format: `context/resourceType.permission` (e.g. `patient/Patient.read`, `system/*.write`).
 */

export interface ParsedScope {
  context: string;       // 'patient', 'user', or 'system'
  resourceType: string;  // FHIR resource type or '*' for wildcard
  permission: string;    // 'read', 'write', or '*'
}

/** Parses a SMART scope string into its components. Returns null if format is invalid. */
export const parseSmartScope = (scope: string): ParsedScope | null => {
  const match = scope.match(/^(patient|user|system)\/([A-Za-z*]+)\.(read|write|\*)$/);

  if (!match) {
    return null;
  }

  return { context: match[1], resourceType: match[2], permission: match[3] };
};

/** Maps an HTTP method + path to 'read' or 'write'. POST for _search and $validate count as read. */
export const resolveAction = (method: string, path: string): 'read' | 'write' => {
  const upper = method.toUpperCase();

  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return 'read';
  }

  // POST to _search or $validate is a read operation
  if (upper === 'POST' && (path.includes('_search') || path.includes('$validate'))) {
    return 'read';
  }

  return 'write';
};

/** Checks whether the given scopes grant access for the required resourceType and action. */
export const hasRequiredScope = (scopes: string[], resourceType: string, action: 'read' | 'write'): boolean => {
  for (const raw of scopes) {
    const parsed = parseSmartScope(raw);

    if (!parsed) {
      continue;
    }

    // Resource type must match or be wildcard
    if (parsed.resourceType !== '*' && parsed.resourceType !== resourceType) {
      continue;
    }

    // Permission must match or be wildcard
    if (parsed.permission !== '*' && parsed.permission !== action) {
      continue;
    }

    return true;
  }

  return false;
};

/** Extracts the list of scopes from a JWT payload based on the configured claim name. */
export const extractScopes = (payload: any, scopeClaim: string): string[] => {
  const value = payload[scopeClaim];

  if (typeof value === 'string') {
    return value.split(' ').filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string');
  }

  return [];
};
