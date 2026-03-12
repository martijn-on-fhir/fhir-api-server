import { ResourceMapper, MapperResult } from '../mapper.interface';
import { allergyClinicalStatus, allergyVerificationStatus } from '../transforms/clinical-status';
import { applyCommonTransforms } from '../transforms/common';

/** Maps STU3 AllergyIntolerance to R4. Key changes: status strings → CodeableConcepts. */
export class AllergyIntoleranceMapper implements ResourceMapper {

  readonly sourceType = 'AllergyIntolerance';

  map(stu3: any): MapperResult {

    const resource = { ...stu3 };

    if (resource.clinicalStatus != null) {
      resource.clinicalStatus = allergyClinicalStatus(resource.clinicalStatus);
    }

    if (resource.verificationStatus != null) {
      resource.verificationStatus = allergyVerificationStatus(resource.verificationStatus);
    }

    applyCommonTransforms(resource);

    return { resources: [resource], warnings: [] };
  }
}
