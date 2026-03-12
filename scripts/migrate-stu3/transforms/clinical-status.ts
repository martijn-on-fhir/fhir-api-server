/** Lookup tables for converting STU3 string statuses to R4 CodeableConcepts. */

const CONDITION_CLINICAL_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const CONDITION_VERIFICATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';
const ALLERGY_CLINICAL_SYSTEM = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical';
const ALLERGY_VERIFICATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification';

/** Wrap a status string into a CodeableConcept with the given system. */
function toCodeableConcept(system: string, code: string): any {
  return {coding: [{system, code, display: code.charAt(0).toUpperCase() + code.slice(1)}]};
}

/** Convert Condition clinicalStatus string → CodeableConcept. Valid codes: active, recurrence, relapse, inactive, remission, resolved. */
export function conditionClinicalStatus(status: string | any): any {
  if (typeof status !== 'string') {
    return status;
  }

  return toCodeableConcept(CONDITION_CLINICAL_SYSTEM, status.toLowerCase());
}

/** Convert Condition verificationStatus string → CodeableConcept. Valid codes: unconfirmed, provisional, differential, confirmed, refuted, entered-in-error. */
export function conditionVerificationStatus(status: string | any): any {
  if (typeof status !== 'string') {
    return status;
  }

  return toCodeableConcept(CONDITION_VERIFICATION_SYSTEM, status.toLowerCase());
}

/** Convert AllergyIntolerance clinicalStatus string → CodeableConcept. Valid codes: active, inactive, resolved. */
export function allergyClinicalStatus(status: string | any): any {
  if (typeof status !== 'string') {
    return status;
  }

  return toCodeableConcept(ALLERGY_CLINICAL_SYSTEM, status.toLowerCase());
}

/** Convert AllergyIntolerance verificationStatus string → CodeableConcept. Valid codes: unconfirmed, confirmed, refuted, entered-in-error. */
export function allergyVerificationStatus(status: string | any): any {
  if (typeof status !== 'string') {
    return status;
  }

  return toCodeableConcept(ALLERGY_VERIFICATION_SYSTEM, status.toLowerCase());
}
