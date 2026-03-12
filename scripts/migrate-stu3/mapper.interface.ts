/** Result of mapping a single STU3 resource to R4. */
export interface MapperResult {
  /** One or more R4 resources (e.g. Practitioner STU3 → Practitioner + PractitionerRole in R4). */
  resources: any[];
  /** Non-fatal warnings encountered during mapping. */
  warnings: string[];
}

/** Maps a single STU3 resource type to R4. */
export interface ResourceMapper {
  /** The FHIR resourceType this mapper handles in the source (STU3) database. */
  readonly sourceType: string;
  /** Convert a single STU3 resource to one or more R4 resources. */
  map(stu3Resource: any): MapperResult;
}
