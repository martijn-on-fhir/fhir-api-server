import { ResourceMapper, MapperResult } from '../mapper.interface';
import { applyCommonTransforms } from '../transforms/common';

/** Maps STU3 Patient to R4. Removes `animal` component (not valid in R4). */
export class PatientMapper implements ResourceMapper {
  readonly sourceType = 'Patient';

  map(stu3: any): MapperResult {
    const warnings: string[] = [];
    const resource = { ...stu3 };

    if (resource.animal) {
      warnings.push(`Patient/${resource.id}: removed 'animal' component (not supported in R4)`);
      delete resource.animal;
    }

    applyCommonTransforms(resource);
    return { resources: [resource], warnings };
  }
}
