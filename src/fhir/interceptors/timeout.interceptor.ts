import { CallHandler, ExecutionContext, Injectable, NestInterceptor, RequestTimeoutException } from '@nestjs/common';
import { Observable, throwError, timeout, catchError, TimeoutError } from 'rxjs';

/** Interceptor that aborts requests exceeding the configured timeout (default 30s). */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  /** Request timeout in milliseconds, configurable via REQUEST_TIMEOUT env var. */
  private readonly timeoutMs = parseInt(process.env.REQUEST_TIMEOUT || '30000', 10);

  /** @inheritdoc */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(timeout(this.timeoutMs), catchError(err => {
      if (err instanceof TimeoutError) return throwError(() => new RequestTimeoutException('Request timeout'));
      return throwError(() => err);
    }));
  }
}