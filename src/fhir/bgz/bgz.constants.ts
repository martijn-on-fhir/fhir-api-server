/**
 * BgZ (Basisgegevensset Zorg) — mapping of the 26 zibs to FHIR R4 resource types and patient reference paths.
 * Consolidated: resource types that appear for multiple zibs (e.g. Observation) are queried once.
 */

export interface BgzQueryDef {
  resourceType: string;
  /** MongoDB field path(s) that hold the patient reference (e.g. 'subject.reference'). */
  refPaths: string[];
}

/**
 * Consolidated BgZ queries — one per resource type, with the reference path(s) to the patient.
 * Covers all 26 zibs:
 *  1. Patient (fetched directly)
 *  2-3. TreatmentDirective + AdvanceDirective → Consent
 *  4. ContactPerson → RelatedPerson
 *  5,12-15,22-26. FunctionalOrMentalStatus, BloodPressure, BodyWeight, BodyHeight, LaboratoryTestResult, TobaccoUse, AlcoholUse, DrugUse, LivingSituation, LifeStance → Observation
 *  6. Problem → Condition
 *  7. AllergyIntolerance → AllergyIntolerance
 *  8. Alert → Flag
 *  9. MedicationUse → MedicationStatement
 *  10. MedicalDevice → DeviceUseStatement
 *  11. Vaccination → Immunization
 *  16. Procedure → Procedure
 *  17. Encounter → Encounter
 *  18. PlannedCareActivity → ServiceRequest + CarePlan
 *  19. Payer → Coverage
 *  20. HealthProfessional → resolved via includes (Practitioner, PractitionerRole)
 *  21. HealthcareProvider → resolved via includes (Organization, Location)
 */
export const BGZ_QUERIES: BgzQueryDef[] = [
  { resourceType: 'Observation', refPaths: ['subject.reference'] },
  { resourceType: 'Condition', refPaths: ['subject.reference'] },
  { resourceType: 'AllergyIntolerance', refPaths: ['patient.reference'] },
  { resourceType: 'Flag', refPaths: ['subject.reference'] },
  { resourceType: 'MedicationStatement', refPaths: ['subject.reference'] },
  { resourceType: 'DeviceUseStatement', refPaths: ['subject.reference'] },
  { resourceType: 'Immunization', refPaths: ['patient.reference'] },
  { resourceType: 'Procedure', refPaths: ['subject.reference'] },
  { resourceType: 'Encounter', refPaths: ['subject.reference'] },
  { resourceType: 'Consent', refPaths: ['patient.reference'] },
  { resourceType: 'RelatedPerson', refPaths: ['patient.reference'] },
  { resourceType: 'Coverage', refPaths: ['beneficiary.reference'] },
  { resourceType: 'ServiceRequest', refPaths: ['subject.reference'] },
  { resourceType: 'CarePlan', refPaths: ['subject.reference'] },
];

/** Reference paths to extract for "include" resources (Practitioner, Organization, Device, Location, Specimen). */
export const BGZ_INCLUDE_PATHS: { resourceType: string; paths: string[] }[] = [
  { resourceType: 'Encounter', paths: ['participant.individual.reference', 'serviceProvider.reference', 'location.location.reference'] },
  { resourceType: 'DeviceUseStatement', paths: ['device.reference'] },
  { resourceType: 'Observation', paths: ['specimen.reference', 'performer.reference'] },
  { resourceType: 'Procedure', paths: ['performer.actor.reference'] },
  { resourceType: 'Coverage', paths: ['payor.reference'] },
  { resourceType: 'ServiceRequest', paths: ['performer.reference', 'requester.reference'] },
  { resourceType: 'CarePlan', paths: ['author.reference', 'careTeam.reference'] },
  { resourceType: 'MedicationStatement', paths: ['informationSource.reference'] },
  { resourceType: 'Immunization', paths: ['performer.actor.reference'] },
  { resourceType: 'Patient', paths: ['generalPractitioner.reference', 'managingOrganization.reference'] },
];
