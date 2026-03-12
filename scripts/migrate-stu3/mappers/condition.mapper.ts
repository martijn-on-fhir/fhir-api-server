import { ResourceMapper, MapperResult } from '../mapper.interface';
import { applyCommonTransforms } from '../transforms/common';
import { conditionClinicalStatus, conditionVerificationStatus } from '../transforms/clinical-status';

/** Maps STU3 Condition to R4. Key changes: assertedDate→recordedDate, status strings→CodeableConcepts, abatementBoolean removal. */
export class ConditionMapper implements ResourceMapper {
  readonly sourceType = 'Condition';

  map(stu3: any): MapperResult {
    const warnings: string[] = [];
    const resource = { ...stu3 };

    // assertedDate → recordedDate
    if (resource.assertedDate) {
      resource.recordedDate = resource.assertedDate;
      delete resource.assertedDate;
    }

    // clinicalStatus: string → CodeableConcept
    if (resource.clinicalStatus != null) {
      resource.clinicalStatus = conditionClinicalStatus(resource.clinicalStatus);
    }

    // verificationStatus: string → CodeableConcept
    if (resource.verificationStatus != null) {
      resource.verificationStatus = conditionVerificationStatus(resource.verificationStatus);
    }

    // abatementBoolean is not valid in R4
    if (resource.abatementBoolean != null) {
      if (resource.abatementBoolean === true) {
        resource.abatementString = 'Resolved';
        warnings.push(`Condition/${resource.id}: converted abatementBoolean=true to abatementString="Resolved"`);
      } else {
        warnings.push(`Condition/${resource.id}: removed abatementBoolean=false (not valid in R4)`);
      }
      delete resource.abatementBoolean;
    }

    applyCommonTransforms(resource);
    return { resources: [resource], warnings };
  }
}
