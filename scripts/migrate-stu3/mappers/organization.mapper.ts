import { ResourceMapper, MapperResult } from '../mapper.interface';
import { applyCommonTransforms } from '../transforms/common';

/** Maps STU3 Organization to R4. Minimal changes — mainly profile URL rewriting via common transforms. */
export class OrganizationMapper implements ResourceMapper {
  readonly sourceType = 'Organization';

  map(stu3: any): MapperResult {
    const resource = { ...stu3 };
    applyCommonTransforms(resource);
    return { resources: [resource], warnings: [] };
  }
}
