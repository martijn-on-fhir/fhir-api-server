import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { TenantService } from './tenant.service';

/**
 * Guard that validates tenant requests when multi-tenancy is enabled.
 * Checks that the tenant exists and has 'active' status.
 * Passes through requests without a tenantId (default database).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenantService: TenantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = req['tenantId'];

    // No tenant ID → default database, always allowed
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
