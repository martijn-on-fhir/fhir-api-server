/** List of FHIR R4 resource types supported by this server. Extend this array to enable new resource types. */
export const SUPPORTED_RESOURCE_TYPES = [
  'Patient',
  'Practitioner',
  'Organization',
  'Observation',
  'Condition',
  'Encounter',
  'MedicationRequest',
  'AllergyIntolerance',
  'DiagnosticReport',
  'Procedure',
  'Appointment',
  'Location',
] as const;

/** Union type of all supported FHIR resource type strings. */
export type SupportedResourceType = (typeof SUPPORTED_RESOURCE_TYPES)[number];
