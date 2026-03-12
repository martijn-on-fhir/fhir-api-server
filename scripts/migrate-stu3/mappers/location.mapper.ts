import {ResourceMapper, MapperResult} from '../mapper.interface';
import {ensureArray} from '../transforms/codeable-concept';
import {applyCommonTransforms} from '../transforms/common';

/** Maps STU3 Location to R4. Main change: type becomes an array in R4. */
export class LocationMapper implements ResourceMapper {
  readonly sourceType = 'Location';

  map(stu3: any): MapperResult {
    const resource = {...stu3};
    resource.type = ensureArray(resource.type);
    applyCommonTransforms(resource);

    return {resources: [resource], warnings: []};
  }
}
