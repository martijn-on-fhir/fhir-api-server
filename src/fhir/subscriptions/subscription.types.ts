/** Event payload emitted after a FHIR resource is created, updated or deleted. */
export interface FhirResourceEvent {
  action: 'create' | 'update' | 'delete';
  resourceType: string;
  id: string;
  resource: any;
  req?: any;
}

/** Parsed FHIR subscription criteria, e.g. "Observation?code=1234" → { resourceType: 'Observation', searchParams: { code: '1234' } }. */
export interface ParsedCriteria {
  resourceType: string;
  searchParams: Record<string, string>;
}

/** Parses a FHIR Subscription criteria string into resourceType and search params. */
export const parseCriteria = (criteria: string): ParsedCriteria | null => {
  if (!criteria) {
return null;
}

  const [resourceType, queryString] = criteria.split('?');

  if (!resourceType) {
return null;
}

  const searchParams: Record<string, string> = {};

  if (queryString) {
    for (const part of queryString.split('&')) {
      const [key, ...valueParts] = part.split('=');

      if (key) {
searchParams[decodeURIComponent(key)] = decodeURIComponent(valueParts.join('='));
}
    }
  }

  return { resourceType, searchParams };
};
