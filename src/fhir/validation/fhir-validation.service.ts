import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { FhirValidator, ValidationResult } from 'fhir-validator-mx';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Service that wraps the fhir-validator-mx library.
 * Initializes the validator on module startup and provides a simple `validate()` interface.
 * Configuration is loaded from config/app-config.json and can be overridden via environment variables.
 */
@Injectable()
export class FhirValidationService implements OnModuleInit {

  /** The underlying FhirValidator instance, initialized during module init. */
  private validator: FhirValidator;

  /** Logger scoped to this service. */
  private readonly logger = new Logger(FhirValidationService.name);

  /** Loads app config from config/app-config.json. */
  private loadAppConfig(): Record<string, any> {
    try {
      return JSON.parse(readFileSync(resolve(process.cwd(), 'config/app-config.json'), 'utf-8'));
    } catch { return {}; }
  }

  /**
   * Lifecycle hook that creates and initializes the FHIR validator.
   * Loads profiles from directories, terminology from local files + remote Nictiz server.
   */
  async onModuleInit() {

    const config = this.loadAppConfig();
    const profilesDirs = process.env.FHIR_PROFILES_DIR ? [process.env.FHIR_PROFILES_DIR] : [resolve(process.cwd(), 'profiles/r4-core'), resolve(process.cwd(), 'profiles/nl-core')];
    const terminologyDirs = process.env.FHIR_TERMINOLOGY_DIR ? [process.env.FHIR_TERMINOLOGY_DIR] : undefined;
    const terminology = config.terminology ? {
      nictiz: { baseUrl: config.terminology.baseUrl, authUrl: config.terminology.authUrl, user: config.terminology.user, password: config.terminology.password, clientId: config.terminology.clientId, grantType: config.terminology.grantType },
      artDecor: { cacheDir: resolve(process.cwd(), 'profiles/.art-decor-cache') },
    } : undefined;


    this.validator = await FhirValidator.create({ profilesDirs, terminologyDirs, terminology, indexCachePath: resolve(process.cwd(), 'profiles/.fhir-index.json') });

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
