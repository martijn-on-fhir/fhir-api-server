import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { CacheService } from '../cache/cache.service';
import { config } from '../config/app-config';
import { TenantService } from './tenant.service';

/** In-memory counters for per-tenant rate limiting (fallback when Redis is unavailable). */
const tenantCounters = new Map<string, { count: number; resetAt: number }>();

/**
 * Guard that validates tenant requests when multi-tenancy is enabled.
 * - FHIR routes require a tenant ID (via URL prefix or X-Tenant-Id header).
 * - Non-FHIR routes (admin, health, etc.) pass through without tenant context.
 * - Validates that the tenant exists and has 'active' status.
 * - Enforces per-tenant rate limit overrides from tenant config.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly tenantService: TenantService,
    private readonly cacheService: CacheService,
  ) {}

  /** Whether multi-tenancy is enabled. */
  private readonly multiTenantEnabled = config.tenant.enabled;

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

    // Enforce per-tenant rate limit if configured
    if (tenant.config?.rateLimitOverride) {
      await this.checkTenantRateLimit(tenantId, tenant.config.rateLimitOverride);
    }

    return true;
  }

  /** Checks per-tenant rate limit using Redis (via cache) or in-memory fallback. */
  private async checkTenantRateLimit(tenantId: string, limit: { ttl: number; limit: number }): Promise<void> {
    const key = `tenant-rl:${tenantId}`;
    const redis = this.cacheService.getRedisClient();

    if (redis) {
      // Redis: atomic increment with TTL
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, limit.ttl);
      }

      if (count > limit.limit) {
        throw new HttpException(`Tenant rate limit exceeded (${limit.limit} requests per ${limit.ttl}s)`, 429);
      }

      return;
    }

    // In-memory fallback
    const now = Date.now();
    const entry = tenantCounters.get(tenantId);

    if (!entry || now > entry.resetAt) {
      tenantCounters.set(tenantId, { count: 1, resetAt: now + limit.ttl * 1000 });

      return;
    }

    entry.count++;

    if (entry.count > limit.limit) {
      throw new HttpException(`Tenant rate limit exceeded (${limit.limit} requests per ${limit.ttl}s)`, 429);
    }
  }
}
