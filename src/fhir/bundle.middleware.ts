import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { BundleProcessorService } from './bundle-processor.service';

/**
 * Middleware that intercepts POST /fhir for batch/transaction Bundle processing.
 * This bypasses NestJS's route parameter matching which can interfere with
 * the root POST handler when parameterized routes like POST /fhir/:resourceType exist.
 */
@Injectable()
export class BundleMiddleware implements NestMiddleware {

  constructor(private readonly bundleProcessor: BundleProcessorService) {}

  async use(req: Request, res: Response, _next: NextFunction) {

    const body = req.body;

    // Only intercept batch/transaction Bundles
    if (!body || body.resourceType !== 'Bundle' || (body.type !== 'batch' && body.type !== 'transaction')) {
      // Not a batch/transaction Bundle — let the error handler deal with it
      res.status(400).set('Content-Type', 'application/fhir+json').json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'invalid', diagnostics: 'POST to FHIR base requires a Bundle of type batch or transaction' }],
      });

      return;
    }

    try {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${proto}://${host}/fhir`;
      const result = await this.bundleProcessor.process(body, baseUrl);

      res.set('Content-Type', 'application/fhir+json').json(result);
    } catch (error: any) {
      const status = error.status || error.getStatus?.() || 500;

      res.status(status).set('Content-Type', 'application/fhir+json').json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'exception', diagnostics: error.message || 'Internal error' }],
      });
    }
  }
}
