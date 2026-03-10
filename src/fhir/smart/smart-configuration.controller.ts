import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SmartConfig, SMART_CONFIG } from './smart-config';

/** SMART App Launch well-known configuration endpoint. Only active when SMART is enabled. */
@ApiTags('SMART on FHIR')
@Controller('.well-known')
export class SmartConfigurationController {
  constructor(@Inject(SMART_CONFIG) private readonly config: SmartConfig) {}

  @Get('smart-configuration')
  @ApiOperation({ summary: 'SMART on FHIR configuration', description: 'Returns the SMART App Launch well-known configuration document.' })
  getConfiguration() {
    if (!this.config.enabled) {
      throw new NotFoundException('SMART on FHIR is not enabled on this server');
    }

    return {
      issuer: this.config.issuer,
      authorization_endpoint: this.config.authorizeUrl,
      token_endpoint: this.config.tokenUrl,
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      scopes_supported: ['openid', 'fhirUser', 'launch', 'launch/patient', 'offline_access', 'patient/*.read', 'patient/*.write', 'user/*.read', 'user/*.write', 'system/*.read', 'system/*.write'],
      response_types_supported: ['code'],
      capabilities: ['launch-standalone', 'launch-ehr', 'client-public', 'client-confidential-symmetric', 'client-confidential-asymmetric', 'permission-patient', 'permission-user', 'permission-v2', 'context-standalone-patient', 'context-ehr-patient', 'sso-openid-connect'],
      code_challenge_methods_supported: ['S256'],
      jwks_uri: this.config.jwksUri,
      registration_endpoint: undefined,
      management_endpoint: undefined,
      introspection_endpoint: undefined,
      revocation_endpoint: undefined,
    };
  }
}
