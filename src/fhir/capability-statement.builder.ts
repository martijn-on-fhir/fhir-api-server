/* eslint-disable max-len */
import { CapabilityStatement, CapabilityStatementImplementation, CapabilityStatementKind, CapabilityStatementRest, CapabilityStatementRestResource, CapabilityStatementRestResourceInteraction, CapabilityStatementRestResourceOperation, CapabilityStatementRestResourceSearchParam, CapabilityStatementSoftware, PublicationStatus, RestfulCapabilityMode, SearchParamType } from 'fhir-models-r4';
/* eslint-enable max-len */


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

const SEARCH_PARAMS = [
  new CapabilityStatementRestResourceSearchParam({ name: '_id', type: SearchParamType.Token, documentation: 'Logical id of the resource' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_sort', type: SearchParamType.String, documentation: 'Sort order for results' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_count', type: SearchParamType.Number, documentation: 'Maximum number of results per page' }),
  new CapabilityStatementRestResourceSearchParam({ name: '_offset', type: SearchParamType.Number, documentation: 'Offset for pagination' }),
];

const VALIDATE_OPERATION = new CapabilityStatementRestResourceOperation({ name: 'validate', definition: 'http://hl7.org/fhir/OperationDefinition/Resource-validate' });

/**
 * Builds a FHIR CapabilityStatement for this server based on the resource types currently stored.
 * @param baseUrl - The absolute FHIR base URL (e.g. http://localhost:3000/fhir).
 * @param resourceTypes - The list of resource types currently available in the database.
 */
export const buildCapabilityStatement = (baseUrl: string, resourceTypes: string[]): CapabilityStatement => {

  const resources = resourceTypes.sort().map((type) => {
    const resource = new CapabilityStatementRestResource({
      type,
      interaction: INTERACTIONS.map((code) => new CapabilityStatementRestResourceInteraction({ code })),
      searchParam: SEARCH_PARAMS,
      operation: [VALIDATE_OPERATION],
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
