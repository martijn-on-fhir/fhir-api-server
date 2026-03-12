import { createHash } from 'crypto';
import { ResourceMapper, MapperResult } from '../mapper.interface';
import { applyCommonTransforms } from '../transforms/common';

/** Generate a deterministic ID for a PractitionerRole based on practitioner ID + role code + organization. */
function generateRoleId(practitionerId: string, roleCode: string, orgRef: string): string {
  const input = `${practitionerId}|${roleCode}|${orgRef}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 36);
}

/** Maps STU3 Practitioner (with embedded roles) to R4 Practitioner + separate PractitionerRole resources. */
export class PractitionerMapper implements ResourceMapper {
  readonly sourceType = 'Practitioner';

  map(stu3: any): MapperResult {
    const warnings: string[] = [];
    const practitioner = { ...stu3 };
    const roles: any[] = practitioner.role || practitioner.practitionerRole || [];
    delete practitioner.role;
    delete practitioner.practitionerRole;

    practitioner.resourceType = 'Practitioner';
    applyCommonTransforms(practitioner);

    const results: any[] = [practitioner];

    for (const role of roles) {
      try {
        const codeStr = role.code?.coding?.[0]?.code || role.code?.text || 'unknown';
        const orgRef = role.organization?.reference || '';
        const prRole: any = {
          resourceType: 'PractitionerRole',
          id: generateRoleId(practitioner.id, codeStr, orgRef),
          meta: { versionId: '1', lastUpdated: new Date().toISOString() },
          practitioner: { reference: `Practitioner/${practitioner.id}` },
        };
        if (role.code) prRole.code = Array.isArray(role.code) ? role.code : [role.code];
        if (role.specialty) prRole.specialty = Array.isArray(role.specialty) ? role.specialty : [role.specialty];
        if (role.organization) prRole.organization = role.organization;
        if (role.location) prRole.location = Array.isArray(role.location) ? role.location : [role.location];
        if (role.identifier) prRole.identifier = Array.isArray(role.identifier) ? role.identifier : [role.identifier];
        if (role.period) prRole.period = role.period;
        results.push(prRole);
      } catch (e) {
        warnings.push(`Failed to convert role for Practitioner/${practitioner.id}: ${e.message}`);
      }
    }

    return { resources: results, warnings };
  }
}
