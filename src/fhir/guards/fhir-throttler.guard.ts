import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

/**
 * Custom ThrottlerGuard that returns a FHIR-conformant OperationOutcome on rate limit exceeded.
 * Adds Retry-After header to the response.
 */
@Injectable()
export class FhirThrottlerGuard extends ThrottlerGuard {

  protected throwThrottlingException(): Promise<void> {
    throw new ThrottlerException('Rate limit exceeded. Please slow down your requests.');
  }
}
