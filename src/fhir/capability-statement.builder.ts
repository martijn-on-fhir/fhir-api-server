/* eslint-disable max-len */
import { CapabilityStatement, CapabilityStatementImplementation, CapabilityStatementKind, CapabilityStatementRest, CapabilityStatementRestResource, CapabilityStatementRestResourceInteraction, CapabilityStatementRestResourceOperation, CapabilityStatementRestResourceSearchParam, CapabilityStatementSoftware, PublicationStatus, RestfulCapabilityMode, SearchParamType as FhirSearchParamType } from 'fhir-models-r4';
/* eslint-enable max-len */
import { SearchParamDef } from './search/search-parameter.types';

/** Map of resource types to their nl-core profile URLs (when applicable). */
const NL_CORE_PROFILES: Record<string, string> = {
  Patient: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-Patient',
  Practitioner: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-HealthProfessional-Practitioner',
  Organization: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-HealthcareProvider-Organization',
  AllergyIntolerance: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-AllergyIntolerance',
  Condition: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-Problem',
  Observation: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-LaboratoryTestResult',
  CareTeam: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-CareTeam',
  Consent: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-AdvanceDirective',
  Encounter: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-Encounter',
  EpisodeOfCare: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-EpisodeOfCare',
  Immunization: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-Vaccination-event',
  Procedure: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-Procedure-event',
};

const INTERACTIONS = ['read', 'create', 'update', 'delete', 'search-type'];

/** Maps internal search param type strings to the fhir-models-r4 SearchParamType enum. */
const TYPE_MAP: Record<string, FhirSearchParamType> = {
  number: FhirSearchParamType.Number, date: FhirSearchParamType.Date, string: FhirSearchParamType.String,
  token: FhirSearchParamType.Token, reference: FhirSearchParamType.Reference, composite: FhirSearchParamType.Composite,
  quantity: FhirSearchParamType.Quantity, uri: FhirSearchParamType.Uri, special: FhirSearchParamType.Special,
};

/** Common search parameters that apply to all resource types. */
const COMMON_SEARCH_PARAMS = [
  new CapabilityStatementRestResourceSearchParam({ name: '_id', type: FhirSearchParamType.Token, documentation: 'Logical id of the resource' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_lastUpdated', type: FhirSearchParamType.Date, documentation: 'When the resource was last updated' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_tag', type: FhirSearchParamType.Token, documentation: 'Tags on the resource' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_profile', type: FhirSearchParamType.Uri, documentation: 'Profiles the resource claims to conform to' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_security', type: FhirSearchParamType.Token, documentation: 'Security labels on the resource' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_text', type: FhirSearchParamType.String, documentation: 'Full-text search on narrative' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_content', type: FhirSearchParamType.String, documentation: 'Full-text search on resource content' }),
];

const OPERATIONS = [
  new CapabilityStatementRestResourceOperation({ name: 'validate', definition: 'http://hl7.org/fhir/OperationDefinition/Resource-validate' }),
  new CapabilityStatementRestResourceOperation({ name: 'meta', definition: 'http://hl7.org/fhir/OperationDefinition/Resource-meta' }),
  new CapabilityStatementRestResourceOperation({ name: 'meta-add', definition: 'http://hl7.org/fhir/OperationDefinition/Resource-meta-add' }),
  new CapabilityStatementRestResourceOperation({ name: 'meta-delete', definition: 'http://hl7.org/fhir/OperationDefinition/Resource-meta-delete' }),
];

/**
 * Builds a FHIR CapabilityStatement for this server based on the resource types currently stored.
 * @param baseUrl - The absolute FHIR base URL (e.g. http://localhost:3000/fhir).
 * @param resourceTypes - The list of resource types currently available in the database.
 * @param searchParamsByType - Optional map of resource type → search parameter definitions from the registry.
 */
export const buildCapabilityStatement = (baseUrl: string, resourceTypes: string[], searchParamsByType?: Map<string, SearchParamDef[]>): CapabilityStatement => {

  const resources = resourceTypes.sort().map((type) => {
    // Build search params: common + type-specific from registry
    const typeSpecificParams: CapabilityStatementRestResourceSearchParam[] = [];

    if (searchParamsByType) {
      const defs = searchParamsByType.get(type) || [];

      for (const def of defs) {
        // Skip params already in common list
        if (def.code.startsWith('_')) {
          continue;
        }

        typeSpecificParams.push(new CapabilityStatementRestResourceSearchParam({
          name: def.code,
          type: TYPE_MAP[def.type] || FhirSearchParamType.String,
          documentation: `Search by ${def.code} (${def.type})`,
        }));
      }
    }

    const searchParams = [...COMMON_SEARCH_PARAMS, ...typeSpecificParams];

    const resource = new CapabilityStatementRestResource({
      type,
      interaction: INTERACTIONS.map((code) => new CapabilityStatementRestResourceInteraction({ code })),
      searchParam: searchParams,
      operation: OPERATIONS,
      searchInclude: ['*'],
      searchRevInclude: ['*'],
    });

    const nlProfile = NL_CORE_PROFILES[type];

    if (nlProfile) {
      resource.supportedProfile = [nlProfile];
    }

    return resource;
  });

  return new CapabilityStatement({
    status: PublicationStatus.Active,
    date: new Date().toISOString(),
    kind: CapabilityStatementKind.Instance,
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    software: new CapabilityStatementSoftware({ name: 'fhir-api-server', version: '0.0.1' }),
    implementation: new CapabilityStatementImplementation({ description: 'FHIR R4 REST API Server with Dutch nl-core profile support', url: baseUrl }),
    rest: [new CapabilityStatementRest({
      mode: RestfulCapabilityMode.Server,
      resource: resources,
    })],
  });
};
