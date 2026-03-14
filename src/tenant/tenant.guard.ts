import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { TenantService } from './tenant.service';

/**
 * Guard that validates tenant requests when multi-tenancy is enabled.
 * - FHIR routes (`/fhir/...`) require a tenant ID (via URL prefix or X-Tenant-Id header).
 * - Non-FHIR routes (admin, health, etc.) pass through without tenant context.
 * - Validates that the tenant exists and has 'active' status.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenantService: TenantService) {}

  /** Whether multi-tenancy is enabled. */
  private readonly multiTenantEnabled = process.env.MULTI_TENANT_ENABLED === 'true';

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.multiTenantEnabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = req['tenantId'];

    // Check original URL for FHIR routes: /fhir/... or /t/:tenantId/fhir/...
    const originalPath = (req.originalUrl || '').split('?')[0];
    const isFhirRoute = originalPath.startsWith('/fhir') || /^\/t\/[^/]+\/fhir/.test(originalPath);

    // FHIR routes require a tenant ID when multi-tenancy is enabled
    if (!tenantId && isFhirRoute) {
      throw new BadRequestException('Missing tenant identifier. Use /t/:tenantId/fhir/... or set the X-Tenant-Id header.');
    }

    // Non-FHIR routes without tenantId (admin, health, etc.) pass through
    if (!tenantId) {
      return true;
    }

    const tenant = await this.tenantService.findById(tenantId);

    if (tenant.status === 'suspended') {
      throw new ForbiddenException(`Tenant ${tenantId} is suspended`);
    }

    if (tenant.status === 'decommissioned') {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    return true;
  }
}
