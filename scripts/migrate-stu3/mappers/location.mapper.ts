import { ResourceMapper, MapperResult } from '../mapper.interface';
import { applyCommonTransforms } from '../transforms/common';
import { ensureArray } from '../transforms/codeable-concept';

/** Maps STU3 Location to R4. Main change: type becomes an array in R4. */
export class LocationMapper implements ResourceMapper {
  readonly sourceType = 'Location';

  map(stu3: any): MapperResult {
    const resource = { ...stu3 };
    resource.type = ensureArray(resource.type);
    applyCommonTransforms(resource);
    return { resources: [resource], warnings: [] };
  }
}
