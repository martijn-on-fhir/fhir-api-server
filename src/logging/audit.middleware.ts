import {Injectable, NestMiddleware, Logger} from '@nestjs/common';
import {Request, Response, NextFunction} from 'express';

/** HTTP methods that mutate resources and require audit logging. */
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Middleware that logs detailed audit entries for FHIR resource mutations.
 * Captures client IP, method, resource type/id, response status, and correlation ID.
 * Read-only operations (GET, HEAD, OPTIONS) are not logged here (already covered by CorrelationMiddleware).
 */
@Injectable()
export class AuditMiddleware implements NestMiddleware {

  private readonly logger = new Logger('Audit');

  use(req: Request, res: Response, next: NextFunction) {

    if (!MUTATION_METHODS.has(req.method)) {
      next();

      return;
    }

    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const {resourceType, resourceId} = this.parseUrl(req.originalUrl);

      this.logger.log(JSON.stringify({
        event: 'fhir.mutation',
        correlationId: req['correlationId'] || '-',
        tenantId: req['tenantId'] || '-',
        method: req.method,
        url: req.originalUrl,
        resourceType: resourceType || '-',
        resourceId: resourceId || '-',
        status: res.statusCode,
        duration: `${duration}ms`,
        clientIp: req.ip || req.socket.remoteAddress || '-',
        userAgent: req.get('user-agent') || '-',
        contentLength: req.get('content-length') || '0',
      }));
    });

    next();
  }

  /** Extracts resourceType and optional id from a FHIR URL like /fhir/Patient/123. */
  private parseUrl(url: string): { resourceType?: string; resourceId?: string } {

    const path = url.split('?')[0];
    const segments = path.split('/').filter(Boolean);
    const fhirIdx = segments.indexOf('fhir');

    if (fhirIdx < 0) {
      return {};
    }

    return {resourceType: segments[fhirIdx + 1], resourceId: segments[fhirIdx + 2]};
  }
}
