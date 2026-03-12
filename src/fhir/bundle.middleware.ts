import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { BundleProcessorService } from './bundle-processor.service';
import { fhirJsonToXml } from './xml/fhir-xml.utils';

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
      const outcome = {
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'invalid', diagnostics: 'POST to FHIR base requires a Bundle of type batch or transaction' }],
      };
      this.sendFhirResponse(res, req, outcome, 400);

      return;
    }

    try {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${proto}://${host}/fhir`;
      const result = await this.bundleProcessor.process(body, baseUrl);

      this.sendFhirResponse(res, req, result);
    } catch (error: any) {
      const status = error.status || error.getStatus?.() || 500;
      const outcome = {
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'exception', diagnostics: error.message || 'Internal error' }],
      };
      this.sendFhirResponse(res, req, outcome, status);
    }
  }

  /** Sends a FHIR response in JSON or XML based on _format or Accept header. */
  private sendFhirResponse(res: Response, req: Request, resource: any, statusCode = 200): void {
    const format = (req.query as any)?._format;
    const isXml = format ? String(format).toLowerCase().includes('xml') : (req.headers.accept || '').includes('xml');

    if (isXml) {
      res.status(statusCode).set('Content-Type', 'application/fhir+xml').send(fhirJsonToXml(resource));
    } else {
      res.status(statusCode).set('Content-Type', 'application/fhir+json').json(resource);
    }
  }
}
