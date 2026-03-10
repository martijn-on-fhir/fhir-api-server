import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';

/**
 * Global exception filter that ensures all errors are returned as FHIR OperationOutcome resources
 * with the `application/fhir+json` content type. Handles both NestJS HttpExceptions and unexpected errors.
 */
@Catch()
export class FhirExceptionFilter implements ExceptionFilter {

  /**
   * Catches any thrown exception and responds with an appropriate OperationOutcome.
   * @param exception - The thrown exception (HttpException or unknown).
   * @param host - The NestJS arguments host providing access to the HTTP context.
   */
  catch(exception: unknown, host: ArgumentsHost) {

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const { status, outcome } = this.buildResponse(exception);

    res.status(status).set('Content-Type', 'application/fhir+json').json(outcome);
  }

  /**
   * Builds the HTTP status and OperationOutcome from the given exception.
   * If the exception already contains an OperationOutcome body, it is passed through.
   * @param exception - The thrown exception.
   * @returns An object with the HTTP status code and the OperationOutcome to return.
   */
  private buildResponse(exception: unknown): { status: number; outcome: OperationOutcome } {

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (this.isOperationOutcome(body)) {
        return { status, outcome: body as OperationOutcome };
      }

      return {
        status,
        outcome: this.createOutcome(IssueSeverity.Error, this.mapStatusToIssueType(status), typeof body === 'string' ? body : (body as any).message || exception.message),
      };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, outcome: this.createOutcome(IssueSeverity.Fatal, IssueType.Exception, 'An unexpected error occurred') };
  }

  /**
   * Checks whether the given response body is already a FHIR OperationOutcome.
   * @param body - The exception response body.
   * @returns True if the body has `resourceType: "OperationOutcome"`.
   */
  private isOperationOutcome(body: any): boolean {
    return body && body.resourceType === 'OperationOutcome';
  }

  /**
   * Maps an HTTP status code to the corresponding FHIR IssueType.
   * @param status - The HTTP status code.
   * @returns The matching FHIR IssueType enum value.
   */
  private mapStatusToIssueType(status: number): IssueType {
    switch (status) {
      case 400: return IssueType.Invalid;
      case 401: return IssueType.Login;
      case 403: return IssueType.Forbidden;
      case 404: return IssueType.NotFound;
      case 405: return IssueType.NotSupported;
      case 409: return IssueType.Conflict;
      case 410: return IssueType.Deleted;
      case 412: return IssueType.Conflict;
      case 422: return IssueType.Processing;
      case 429: return IssueType.Throttled;
      default: return IssueType.Exception;
    }
  }

  /**
   * Creates a FHIR OperationOutcome with a single issue.
   * @param severity - The issue severity level.
   * @param code - The issue type code.
   * @param diagnostics - A human-readable diagnostic message.
   * @returns A populated OperationOutcome instance.
   */
  private createOutcome(severity: IssueSeverity, code: IssueType, diagnostics: string): OperationOutcome {
    return new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity, code, diagnostics })] });
  }
}
