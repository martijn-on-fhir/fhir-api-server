import { CallHandler, ExecutionContext, Injectable, NestInterceptor, RequestTimeoutException } from '@nestjs/common';
import { Observable, throwError, timeout, catchError, TimeoutError } from 'rxjs';
import { config } from '../../config/app-config';

/** Interceptor that aborts requests exceeding the configured timeout (default 30s). */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  /** Request timeout in milliseconds, configured via centralized config. */
  private readonly timeoutMs = config.requestTimeout;

  /** @inheritdoc */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(timeout(this.timeoutMs), catchError(err => {
      if (err instanceof TimeoutError) {
return throwError(() => new RequestTimeoutException('Request timeout'));
}

      return throwError(() => err);
    }));
  }
}