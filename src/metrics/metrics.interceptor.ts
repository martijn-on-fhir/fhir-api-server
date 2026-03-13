import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Request, Response } from 'express';
import { Counter, Histogram } from 'prom-client';
import { Observable, tap } from 'rxjs';

/**
 * Global interceptor that records HTTP request count and duration as Prometheus metrics.
 * Route is normalized to the Express route pattern (e.g. /fhir/:resourceType/:id) to prevent high cardinality.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {

  constructor(
    @InjectMetric('fhir_requests_total') private readonly requestCounter: Counter,
    @InjectMetric('fhir_request_duration_seconds') private readonly requestDuration: Histogram,
  ) {}

  /** Records request count and duration after the response is sent. */
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = process.hrtime.bigint();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const method = req.method;

    return next.handle().pipe(tap({
      next: () => this.record(method, req, res.statusCode, start),
      error: (err) => this.record(method, req, err.status || err.getStatus?.() || 500, start),
    }));
  }

  /** Records metrics with normalized route label. */
  private record(method: string, req: Request, status: number, start: bigint): void {
    const route = (req as any).route?.path || req.path;
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method, route, status: String(status) };
    this.requestCounter.inc(labels);
    this.requestDuration.observe(labels, duration);
  }
}
