import {randomUUID} from 'crypto';
import {Injectable, NestMiddleware, Logger} from '@nestjs/common';
import {trace, SpanContext} from '@opentelemetry/api';
import {Request, Response, NextFunction} from 'express';

/**
 * Middleware that assigns a correlation ID to each request and logs request/response details.
 * The correlation ID is taken from the `X-Correlation-ID` header if present, otherwise generated.
 * It is returned in the response header and available on `req['correlationId']`.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {

  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {

    const correlationId = (req.headers['X-Correlation-Id'] as string) || (req.headers['x-correlation-id'] as string) || randomUUID();
    const start = Date.now();

    req['correlationId'] = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    // Add OpenTelemetry trace ID to response header when tracing is active
    const spanContext: SpanContext | undefined = trace.getActiveSpan()?.spanContext();

    if (spanContext?.traceId) {
      res.setHeader('X-Trace-ID', spanContext.traceId);
    }

    res.on('finish', () => {

      const duration = Date.now() - start;

      this.logger.log(JSON.stringify({
        correlationId,
        tenantId: req['tenantId'] || '-',
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('content-length') || 0,
        userAgent: req.get('user-agent') || '-',
      }));
    });

    next();
  }
}
