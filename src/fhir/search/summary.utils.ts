/**
 * Utilities for FHIR _summary and _elements result parameters.
 * Applies post-query filtering to limit which elements are returned in search results.
 */

/** Elements that are always included regardless of _summary or _elements settings. */
const MANDATORY_ELEMENTS = ['resourceType', 'id', 'meta'];

/**
 * Summary elements per resource type. These are elements marked as isSummary=true in R4 StructureDefinitions.
 * Fallback list for the most common resource types; others will include all top-level elements that are commonly summary.
 */
const SUMMARY_ELEMENTS: Record<string, string[]> = {
  Patient: ['identifier', 'active', 'name', 'telecom', 'gender', 'birthDate', 'deceasedBoolean', 'deceasedDateTime', 'address', 'managingOrganization', 'link'],
  Practitioner: ['identifier', 'active', 'name', 'telecom', 'address', 'gender', 'birthDate', 'qualification'],
  Organization: ['identifier', 'active', 'type', 'name', 'alias', 'telecom', 'address', 'partOf', 'endpoint'],
  Observation: ['identifier', 'status', 'category', 'code', 'subject', 'encounter', 'effectiveDateTime', 'effectivePeriod', 'issued', 'valueQuantity', 'valueCodeableConcept', 'valueString', 'valuePeriod', 'dataAbsentReason', 'interpretation', 'hasMember'],
  Condition: ['identifier', 'clinicalStatus', 'verificationStatus', 'category', 'severity', 'code', 'bodySite', 'subject', 'encounter', 'onsetDateTime', 'onsetPeriod', 'abatementDateTime', 'abatementPeriod', 'recordedDate'],
  AllergyIntolerance: ['identifier', 'clinicalStatus', 'verificationStatus', 'type', 'category', 'criticality', 'code', 'patient', 'onsetDateTime', 'recordedDate', 'recorder', 'lastOccurrence'],
  Encounter: ['identifier', 'status', 'statusHistory', 'class', 'type', 'serviceType', 'priority', 'subject', 'participant', 'period', 'location'],
  MedicationRequest: ['identifier', 'status', 'statusReason', 'intent', 'category', 'priority', 'medicationCodeableConcept', 'medicationReference', 'subject', 'encounter', 'authoredOn', 'requester'],
  Procedure: ['identifier', 'status', 'code', 'subject', 'encounter', 'performedDateTime', 'performedPeriod'],
  DiagnosticReport: ['identifier', 'status', 'category', 'code', 'subject', 'encounter', 'effectiveDateTime', 'effectivePeriod', 'issued', 'performer', 'conclusion'],
  Consent: ['identifier', 'status', 'scope', 'category', 'patient', 'dateTime', 'performer', 'organization', 'sourceAttachment', 'sourceReference', 'policyRule'],
  CareTeam: ['identifier', 'status', 'category', 'name', 'subject', 'encounter', 'period', 'participant', 'managingOrganization'],
  CarePlan: ['identifier', 'status', 'intent', 'category', 'title', 'subject', 'encounter', 'period', 'author'],
};

/**
 * Applies _summary filtering to a resource.
 * @param resource - Plain FHIR resource object.
 * @param summary - The _summary parameter value: 'true', 'text', 'data', 'false', or 'count'.
 * @returns The filtered resource, or null if _summary=count (no resource data returned).
 */
export const applySummary = (resource: any, summary: string): any | null => {

  switch (summary) {
    case 'count':
      return null; // No resource data

    case 'text':
      // Return only text, id, meta, resourceType
      return pickElements(resource, ['text']);

    case 'data':
      // Return everything except text narrative
      return omitElements(resource, ['text']);

    case 'true': {
      // Return summary elements + mandatory
      const summaryFields = SUMMARY_ELEMENTS[resource.resourceType];

      if (summaryFields) {
        const result = pickElements(resource, summaryFields);
        result.meta = { ...result.meta, tag: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue', code: 'SUBSETTED', display: 'subsetted' }] };

        return result;
      }

      // Unknown type — just strip text as minimal summary
      return omitElements(resource, ['text']);
    }

    case 'false':
    default:
      return resource;
  }
};

/**
 * Applies _elements filtering to a resource.
 * @param resource - Plain FHIR resource object.
 * @param elements - Comma-separated list of element names to include.
 * @returns The filtered resource with only the requested elements plus mandatory ones.
 */
export const applyElements = (resource: any, elements: string): any => {

  const requested = elements.split(',').map((e) => e.trim()).filter(Boolean);
  const result = pickElements(resource, requested);
  result.meta = { ...result.meta, tag: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue', code: 'SUBSETTED', display: 'subsetted' }] };

  return result;
};

/** Picks only specified elements (plus mandatory) from a resource. */
const pickElements = (resource: any, elements: string[]): any => {

  const allowed = new Set([...MANDATORY_ELEMENTS, ...elements]);
  const result: any = {};

  for (const key of Object.keys(resource)) {
    if (allowed.has(key)) {
      result[key] = resource[key];
    }
  }

  return result;
};

/** Omits specified elements from a resource, keeping everything else. */
const omitElements = (resource: any, elements: string[]): any => {

  const excluded = new Set(elements);
  const result: any = {};

  for (const key of Object.keys(resource)) {
    if (!excluded.has(key)) {
      result[key] = resource[key];
    }
  }

  return result;
};
