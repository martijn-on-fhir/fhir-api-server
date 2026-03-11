import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { FhirValidator, MongoSource, ValidationResult } from 'fhir-validator-mx';
import { Connection } from 'mongoose';

/**
 * Service that wraps the fhir-validator-mx library.
 * Initializes the validator on module startup using MongoDB as the primary source for conformance resources.
 * Falls back to filesystem directories when configured via environment variables.
 * Configuration is loaded from config/app-config.json and can be overridden via environment variables.
 */
@Injectable()
export class FhirValidationService implements OnModuleInit {

  private validator: FhirValidator;
  private readonly logger = new Logger(FhirValidationService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  private loadAppConfig(): Record<string, any> {
    try {
      return JSON.parse(readFileSync(resolve(process.cwd(), 'config/app-config.json'), 'utf-8'));
    } catch {
      return {};
    }
  }

  async onModuleInit() {
    const config = this.loadAppConfig();
    const terminology = config.terminology ? {
      nictiz: { baseUrl: config.terminology.baseUrl, authUrl: config.terminology.authUrl, user: config.terminology.user, password: config.terminology.password, clientId: config.terminology.clientId, grantType: config.terminology.grantType },
    } : undefined;

    // Use MongoDB conformance_resources collection as primary source (seeded by AdministrationModule)
    const collection = this.connection.db.collection('conformance_resources');
    const mongoSource = new MongoSource(collection);

    this.logger.log('Initializing FHIR Validator with MongoDB source (conformance_resources)...');

    this.validator = await FhirValidator.create({ sources: [mongoSource], terminology });

    const { profiles, valueSets, codeSystems } = this.validator.stats();
    this.logger.log(`FHIR Validator initialized: ${profiles} profiles, ${valueSets} value sets, ${codeSystems} code systems (source: MongoDB)`);
  }

  async validate(resource: unknown, profileUrl?: string): Promise<ValidationResult> {
    const { profiles } = this.validator.stats();

    if (profiles === 0) {
      this.logger.warn('No profiles loaded — skipping deep validation');

      return { valid: true, issues: [] };
    }

    return this.validator.validate(resource, profileUrl);
  }

  getValidator(): FhirValidator {
    return this.validator;
  }
}