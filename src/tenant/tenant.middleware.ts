import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TENANT_ID_PATTERN } from './tenant.interfaces';

/**
 * Middleware that extracts the tenant ID from URL paths matching `/t/:tenantId/fhir/...`.
 * Rewrites `req.url` to strip the tenant prefix so downstream controllers see `/fhir/...`.
 * Sets `req['tenantId']` for use by guards, services and logging.
 *
 * Only active when MULTI_TENANT_ENABLED=true; otherwise this middleware is not registered.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  /** Regex to match /t/:tenantId/ at the start of the URL path. */
  private readonly tenantUrlPattern = /^\/t\/([a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+)(\/.*)?$/;

  use(req: Request, _res: Response, next: NextFunction) {
    const match = req.url.match(this.tenantUrlPattern);

    if (match) {
      const tenantId = match[1];

      if (TENANT_ID_PATTERN.test(tenantId)) {
        req['tenantId'] = tenantId;
        // Rewrite URL to strip tenant prefix: /t/abc-123-def-4/fhir/Patient → /fhir/Patient
        req.url = match[2] || '/';
      }
    }

    // No tenant prefix → req['tenantId'] stays undefined → default database
    next();
  }
}
