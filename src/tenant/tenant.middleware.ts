import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TENANT_ID_PATTERN } from './tenant.interfaces';

/**
 * Middleware that extracts the tenant ID from:
 * 1. URL paths matching `/t/:tenantId/fhir/...` — rewrites URL to strip prefix
 * 2. `X-Tenant-Id` header on `/fhir/...` routes — no URL rewrite needed
 *
 * Sets `req['tenantId']` for use by guards, services and logging.
 * Only active when MULTI_TENANT_ENABLED=true; otherwise this middleware is not registered.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  /** Regex to match /t/:tenantId/ at the start of the URL path. */
  private readonly tenantUrlPattern = /^\/t\/([a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+)(\/.*)?$/;

  use(req: Request, _res: Response, next: NextFunction) {
    // 1. Check URL-based tenant prefix: /t/:tenantId/fhir/...
    const match = req.url.match(this.tenantUrlPattern);

    if (match) {
      const tenantId = match[1];

      if (TENANT_ID_PATTERN.test(tenantId)) {
        req['tenantId'] = tenantId;
        // Rewrite URL to strip tenant prefix: /t/abc-123-def-4/fhir/Patient → /fhir/Patient
        req.url = match[2] || '/';
      }

      return next();
    }

    // 2. Check X-Tenant-Id header for /fhir/... routes
    const headerTenantId = req.headers['x-tenant-id'] as string;

    if (headerTenantId && TENANT_ID_PATTERN.test(headerTenantId)) {
      req['tenantId'] = headerTenantId;
    }

    next();
  }
}
