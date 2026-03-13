import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { CircuitBreakerService } from '../../resilience/circuit-breaker.service';
import { SmartConfig, SMART_CONFIG } from '../smart/smart-config';
import { extractScopes, hasRequiredScope, resolveAction } from '../smart/smart-scopes';

/**
 * Guard that validates SMART on FHIR Bearer tokens (JWT) and enforces scopes.
 * When SMART is disabled in config, all requests are allowed through.
 * JWKS key fetching is protected by a circuit breaker to prevent cascading failures.
 */
@Injectable()
export class SmartAuthGuard implements CanActivate {
  private readonly logger = new Logger(SmartAuthGuard.name);
  private jwksClient: JwksClient | null = null;
  private jwksBreaker: CircuitBreaker | null = null;

  constructor(@Inject(SMART_CONFIG) private readonly config: SmartConfig, @Optional() private readonly cbService?: CircuitBreakerService) {
    if (config.enabled && config.jwksUri) {
      this.jwksClient = new JwksClient({ jwksUri: config.jwksUri, cache: true, cacheMaxAge: 36_000_000, rateLimit: true });
      if (cbService) {
        this.jwksBreaker = cbService.create((kid: string) => this.jwksClient!.getSigningKey(kid), { name: 'jwks', timeout: 5000, errorThresholdPercentage: 50, resetTimeout: 30_000 });
        this.jwksBreaker.fallback(() => { throw new UnauthorizedException('JWKS service temporarily unavailable'); });
      }
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();

    // Public endpoints — always accessible without auth
    if (this.isPublicRoute(req)) {
      return true;
    }

    // Extract and validate Bearer token
    const token = this.extractBearerToken(req);

    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header. Expected: Bearer <token>');
    }

    const payload = await this.verifyToken(token);
    // Attach decoded JWT to request for downstream use (launch context etc.)
    (req as any).user = payload;

    // Extract resource type from URL path — /fhir/:resourceType/...
    const resourceType = this.extractResourceType(req.path);

    if (!resourceType) {
      // Non-resource routes (like /health) — allow if token is valid
      return true;
    }

    // Check SMART scopes
    const scopes = extractScopes(payload, this.config.scopeClaim);
    const action = resolveAction(req.method, req.path);

    if (!hasRequiredScope(scopes, resourceType, action)) {
      this.logger.warn(`Scope denied: ${req.method} ${req.path} requires ${resourceType}.${action}, token has: [${scopes.join(', ')}]`);
      throw new ForbiddenException(`Insufficient scope. Required: ${resourceType}.${action}`);
    }

    return true;
  }

  /** Routes that never require authentication. */
  private isPublicRoute(req: Request): boolean {
    const path = req.path;

    return path === '/fhir/metadata' || path === '/.well-known/smart-configuration' || path.startsWith('/health') || path === '/metrics';
  }

  /** Extracts the Bearer token from the Authorization header. */
  private extractBearerToken(req: Request): string | null {
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith('Bearer ')) {
      return null;
    }

    return auth.slice(7);
  }

  /** Verifies the JWT signature, issuer, audience and expiry via JWKS. */
  private async verifyToken(token: string): Promise<any> {
    try {
      // Decode header to get kid
      const decoded = jwt.decode(token, { complete: true });

      if (!decoded || typeof decoded === 'string') {
        throw new UnauthorizedException('Invalid token format');
      }

      const kid = decoded.header.kid;

      if (!kid || !this.jwksClient) {
        throw new UnauthorizedException('Token missing kid header or JWKS not configured');
      }

      const signingKey: any = this.jwksBreaker ? await this.jwksBreaker.fire(kid) : await this.jwksClient.getSigningKey(kid);
      const publicKey = signingKey.getPublicKey();

      return jwt.verify(token, publicKey, { issuer: this.config.issuer || undefined, audience: this.config.audience || undefined, algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'] });
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) {
        throw err;
      }

      this.logger.warn(`Token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException(`Token verification failed: ${(err as Error).message}`);
    }
  }

  /** Extracts the FHIR resource type from the request path. */
  private extractResourceType(path: string): string | null {
    // Match /fhir/:resourceType patterns — skip system-level operations
    const match = path.match(/^\/fhir\/([A-Z][a-zA-Z]+)/);

    return match ? match[1] : null;
  }
}
