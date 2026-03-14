import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Request } from 'express';
import { config } from '../../config/app-config';

/**
 * Custom ThrottlerGuard that returns a FHIR-conformant OperationOutcome on rate limit exceeded.
 * Uses JWT client_id or sub claim as rate limit key when SMART auth is enabled, falls back to IP.
 * Namespaces rate limit buckets by tenant ID when multi-tenancy is enabled.
 */
@Injectable()
export class FhirThrottlerGuard extends ThrottlerGuard {

  /** Extracts a unique tracker key per client, namespaced by tenant: tenant:client > tenant:sub > tenant:IP. */
  protected async getTracker(req: Request): Promise<string> {
    const user = (req as any).user;
    const tenantPrefix = req['tenantId'] ? `t:${req['tenantId']}:` : '';

    if (user?.client_id) {
      return `${tenantPrefix}client:${user.client_id}`;
    }

    if (user?.sub) {
      return `${tenantPrefix}sub:${user.sub}`;
    }

    return `${tenantPrefix}${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  }

  /** Skips rate limiting for health/metrics endpoints and when RATE_LIMIT_DISABLED is set. */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (config.rateLimit.disabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path;

    return path.startsWith('/health') || path === '/metrics';
  }

  protected throwThrottlingException(): Promise<void> {
    throw new ThrottlerException('Rate limit exceeded. Please slow down your requests.');
  }
}
