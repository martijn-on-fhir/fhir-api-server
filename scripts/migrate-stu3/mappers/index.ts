import { ResourceMapper } from '../mapper.interface';
import { AllergyIntoleranceMapper } from './allergy-intolerance.mapper';
import { ConditionMapper } from './condition.mapper';
import { ConsentMapper } from './consent.mapper';
import { LocationMapper } from './location.mapper';
import { OrganizationMapper } from './organization.mapper';
import { PatientMapper } from './patient.mapper';
import { PractitionerMapper } from './practitioner.mapper';

/** Registry of all available STU3→R4 resource mappers, keyed by resource type. */
const mappers: ResourceMapper[] = [
  new PractitionerMapper(),
  new LocationMapper(),
  new OrganizationMapper(),
  new PatientMapper(),
  new ConditionMapper(),
  new ConsentMapper(),
  new AllergyIntoleranceMapper(),
];

export const mapperRegistry = new Map<string, ResourceMapper>(mappers.map(m => [m.sourceType, m]));

/** Get all supported resource types. */
export function getSupportedTypes(): string[] {
  return mappers.map(m => m.sourceType);
}
