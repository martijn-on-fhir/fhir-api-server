import { config } from '../../config/app-config';

/** SMART on FHIR configuration for JWT-based OAuth2 token validation. */
export interface SmartConfig {
  enabled: boolean;
  /** JWT issuer (iss claim) — must match the authorization server. */
  issuer: string;
  /** JWT audience (aud claim) — identifies this FHIR server. */
  audience: string;
  /** JWKS endpoint of the authorization server for fetching signing keys. */
  jwksUri: string;
  /** JWT claim containing the SMART scopes (default: 'scope'). */
  scopeClaim: string;
  /** OAuth2 authorization endpoint (for CapabilityStatement and .well-known). */
  authorizeUrl: string;
  /** OAuth2 token endpoint (for CapabilityStatement and .well-known). */
  tokenUrl: string;
}

/** NestJS injection token for SmartConfig. */
export const SMART_CONFIG = 'SMART_CONFIG';

/** Loads SMART config from the centralized config. */
export const loadSmartConfig = (): SmartConfig => config.smart;
