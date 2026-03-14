/** Possible lifecycle states for a tenant. */
export type TenantStatus = 'active' | 'suspended' | 'decommissioned';

/** Per-tenant configuration overrides. */
export interface TenantConfig {
  smartEnabled?: boolean;
  jwksUri?: string;
  issuer?: string;
  rateLimitOverride?: { ttl: number; limit: number };
}

/** Core tenant information stored in the master database. */
export interface TenantInfo {
  id: string;
  name: string;
  status: TenantStatus;
  contactEmail?: string;
  config?: TenantConfig;
  createdAt: Date;
  updatedAt: Date;
}

/** Regex pattern for valid tenant IDs (hex segments separated by dashes). */
export const TENANT_ID_PATTERN = /^[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+$/;

/**
 * Converts a tenant ID to a safe database name by replacing dashes with underscores.
 * @param tenantId - The tenant ID, e.g. '6edb-752-09a51b-4'.
 * @returns The database name, e.g. 'fhir_tenant_6edb_752_09a51b_4'.
 */
export function tenantDatabaseName(tenantId: string): string {
  return `fhir_tenant_${tenantId.replace(/-/g, '_')}`;
}
