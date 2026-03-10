import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that assigns a correlation ID to each request and logs request/response details.
 * The correlation ID is taken from the `X-Correlation-ID` header if present, otherwise generated.
 * It is returned in the response header and available on `req['correlationId']`.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {

  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {

    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    req['correlationId'] = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;

      this.logger.log(JSON.stringify({
        correlationId,
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
