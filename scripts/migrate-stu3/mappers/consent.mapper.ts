import {ResourceMapper, MapperResult} from '../mapper.interface';
import {applyCommonTransforms} from '../transforms/common';

/** Maps STU3 Consent to R4. Key changes: except[] → provision.provision[], period/actor restructuring. */
export class ConsentMapper implements ResourceMapper {
  readonly sourceType = 'Consent';

  map(stu3: any): MapperResult {
    const warnings: string[] = [];
    const resource = {...stu3};

    // Build provision from STU3 fields
    if (resource.except || resource.period || resource.actor) {
      const provision: any = resource.provision || {};

      // period → provision.period
      if (resource.period) {
        provision.period = resource.period;
        delete resource.period;
      }

      // actor[] → provision.actor[]
      if (resource.actor) {
        provision.actor = resource.actor;
        delete resource.actor;
      }

      // except[] → provision.provision[] (nested provisions)
      if (resource.except) {
        provision.provision = resource.except.map((exc: any) => {
          const nested: any = {type: exc.type || 'deny'};

          if (exc.period) {
            nested.period = exc.period;
          }

          if (exc.actor) {
            nested.actor = exc.actor;
          }

          if (exc.action) {
            nested.action = exc.action;
          }

          if (exc.securityLabel) {
            nested.securityLabel = exc.securityLabel;
          }

          if (exc.purpose) {
            nested.purpose = exc.purpose;
          }

          if (exc.class) {
            nested.class = exc.class;
          }

          if (exc.code) {
            nested.code = exc.code;
          }

          if (exc.data) {
            nested.data = exc.data;
          }

          return nested;
        });
        delete resource.except;
      }

      resource.provision = provision;
    }

    applyCommonTransforms(resource);

    return {resources: [resource], warnings};
  }
}
