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

/** Loads SMART config from app-config.json with env var overrides. */
export const loadSmartConfig = (): SmartConfig => {
  let fileConfig: any = {};

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fileConfig = require('../../../config/app-config.json').smart || {};
  } catch {
    // Config file not found — rely on env vars
  }

  return {
    enabled: process.env.SMART_ENABLED === 'true' || fileConfig.enabled === true,
    issuer: process.env.SMART_ISSUER || fileConfig.issuer || '',
    audience: process.env.SMART_AUDIENCE || fileConfig.audience || '',
    jwksUri: process.env.SMART_JWKS_URI || fileConfig.jwksUri || '',
    scopeClaim: process.env.SMART_SCOPE_CLAIM || fileConfig.scopeClaim || 'scope',
    authorizeUrl: process.env.SMART_AUTHORIZE_URL || fileConfig.authorizeUrl || '',
    tokenUrl: process.env.SMART_TOKEN_URL || fileConfig.tokenUrl || '',
  };
};
