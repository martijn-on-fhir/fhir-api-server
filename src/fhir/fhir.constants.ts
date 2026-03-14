/** Injection token for the active FhirResource model (tenant-aware when multi-tenancy is enabled). */
export const FHIR_RESOURCE_MODEL = 'FHIR_RESOURCE_MODEL';

/** Injection token for the active FhirResourceHistory model (tenant-aware when multi-tenancy is enabled). */
export const FHIR_HISTORY_MODEL = 'FHIR_HISTORY_MODEL';

/** FHIR R4 Patient compartment definition: maps resource types to their reference search parameters that link to Patient. */
export const COMPARTMENT_PARAMS: Record<string, Record<string, string[]>> = {
  Patient: {
    AllergyIntolerance: ['patient', 'recorder', 'asserter'], Condition: ['patient', 'asserter'], Observation: ['subject', 'performer'],
    Encounter: ['patient'], Procedure: ['patient', 'performer'], Immunization: ['patient'], CareTeam: ['patient', 'participant'],
    MedicationRequest: ['subject'], MedicationStatement: ['subject'], DiagnosticReport: ['subject'], CarePlan: ['subject'],
    EpisodeOfCare: ['patient'], Consent: ['patient'], Coverage: ['beneficiary'], Claim: ['patient'],
    DocumentReference: ['subject', 'author'], Composition: ['subject', 'author'], ServiceRequest: ['subject'],
    Appointment: ['actor'], Communication: ['subject', 'sender', 'recipient'], QuestionnaireResponse: ['subject', 'author'],
    Flag: ['patient'], Goal: ['patient'], NutritionOrder: ['patient'], DeviceRequest: ['subject'],
    RiskAssessment: ['subject'], ClinicalImpression: ['subject'], DetectedIssue: ['patient'],
    FamilyMemberHistory: ['patient'], List: ['subject', 'source'], Media: ['subject'],
    MedicationAdministration: ['patient', 'performer', 'subject'], MedicationDispense: ['subject', 'patient', 'receiver'],
    RelatedPerson: ['patient'], Schedule: ['actor'], Specimen: ['subject'], SupplyDelivery: ['patient'],
    SupplyRequest: ['requester'], Task: ['owner', 'focus'], VisionPrescription: ['patient'],
  },
  Practitioner: {
    Appointment: ['actor'], Encounter: ['practitioner', 'participant'], Observation: ['performer'],
    Procedure: ['performer'], DiagnosticReport: ['performer'], EpisodeOfCare: ['care-manager'],
    MedicationRequest: ['requester'], CarePlan: ['performer'], CareTeam: ['participant'],
    ServiceRequest: ['performer', 'requester'], DocumentReference: ['author'], Composition: ['author'],
    Communication: ['sender', 'recipient'], Schedule: ['actor'], Task: ['owner'],
  },
  Encounter: {
    Observation: ['encounter'], Condition: ['encounter'], Procedure: ['encounter'],
    DiagnosticReport: ['encounter'], MedicationRequest: ['encounter'], CarePlan: ['encounter'],
    ServiceRequest: ['encounter'], Communication: ['encounter'], Composition: ['encounter'],
    DocumentReference: ['context'], ClinicalImpression: ['encounter'], NutritionOrder: ['encounter'],
    QuestionnaireResponse: ['encounter'], RiskAssessment: ['encounter'],
  },
};
