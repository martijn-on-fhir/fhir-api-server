import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { FhirValidator, ValidationResult } from 'fhir-r4-validator';

/**
 * Service that wraps the fhir-r4-validator library.
 * Initializes the validator on module startup and provides a simple `validate()` interface.
 * Profiles and terminology can be loaded via `FHIR_PROFILES_DIR` and `FHIR_TERMINOLOGY_DIR` env vars.
 */
@Injectable()
export class FhirValidationService implements OnModuleInit {
  /** The underlying FhirValidator instance, initialized during module init. */
  private validator: FhirValidator;

  /** Logger scoped to this service. */
  private readonly logger = new Logger(FhirValidationService.name);

  /**
   * Lifecycle hook that creates and initializes the FHIR validator.
   * Loads profiles and terminology from directories specified by environment variables.
   */
  async onModuleInit() {
    this.validator = await FhirValidator.create({ profilesDir: process.env.FHIR_PROFILES_DIR || undefined, terminologyDir: process.env.FHIR_TERMINOLOGY_DIR || undefined });
    const { profiles, valueSets, codeSystems } = this.validator.stats();
    this.logger.log(`FHIR Validator initialized: ${profiles} profiles, ${valueSets} value sets, ${codeSystems} code systems`);
  }

  /**
   * Validates a FHIR resource against the R4 specification and optionally a specific profile.
   * @param resource - The FHIR resource to validate (plain object).
   * @param profileUrl - Optional StructureDefinition URL to validate against.
   * @returns The validation result containing validity status and any issues found.
   */
  async validate(resource: unknown, profileUrl?: string): Promise<ValidationResult> {
    return this.validator.validate(resource, profileUrl);
  }

  /**
   * Returns the underlying FhirValidator instance for advanced use cases.
   * @returns The initialized FhirValidator.
   */
  getValidator(): FhirValidator {
    return this.validator;
  }
}
