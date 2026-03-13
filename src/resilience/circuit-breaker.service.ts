import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/naming-convention
import CircuitBreaker from 'opossum';

/** Options for creating a circuit breaker. */
export interface CircuitBreakerOptions {
  /** Name for logging and metrics. */
  name: string;
  /** Time in ms before the circuit breaker times out. Default: 10000. */
  timeout?: number;
  /** Error percentage threshold to open the circuit. Default: 50. */
  errorThresholdPercentage?: number;
  /** Time in ms to wait before moving from open to half-open. Default: 30000. */
  resetTimeout?: number;
}

/**
 * Factory service for creating opossum circuit breakers.
 * Centralizes circuit breaker creation with consistent defaults and logging.
 */
@Injectable()
export class CircuitBreakerService implements OnModuleInit {

  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  onModuleInit() {
    this.logger.log('CircuitBreakerService initialized');
  }

  /**
   * Creates a circuit breaker wrapping the given async function.
   * @param fn - The async function to protect.
   * @param options - Circuit breaker configuration.
   * @returns A wrapped circuit breaker instance.
   */
  create<T extends (...args: any[]) => Promise<any>>(fn: T, options: CircuitBreakerOptions): CircuitBreaker {
    const breaker = new CircuitBreaker(fn, {
      timeout: options.timeout ?? 10_000,
      errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
      resetTimeout: options.resetTimeout ?? 30_000,
      name: options.name,
    });

    breaker.on('open', () => this.logger.warn(`Circuit breaker '${options.name}' OPENED — failing fast`));
    breaker.on('halfOpen', () => this.logger.log(`Circuit breaker '${options.name}' HALF-OPEN — testing`));
    breaker.on('close', () => this.logger.log(`Circuit breaker '${options.name}' CLOSED — recovered`));

    this.breakers.set(options.name, breaker);

    return breaker;
  }

  /** Returns the status of all circuit breakers for health checks. */
  getStatuses(): Record<string, { state: string; stats: any }> {
    const result: Record<string, { state: string; stats: any }> = {};

    for (const [name, breaker] of this.breakers) {
      const stats = breaker.stats;
      result[name] = { state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed', stats: { successes: stats.successes, failures: stats.failures, timeouts: stats.timeouts, rejects: stats.rejects } };
    }

    return result;
  }
}
