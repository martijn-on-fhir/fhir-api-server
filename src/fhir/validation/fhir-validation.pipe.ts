import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { FhirValidationService } from './fhir-validation.service';

/**
 * NestJS pipe that validates incoming FHIR resource bodies on POST and PUT requests.
 * Performs basic structural checks (JSON object, resourceType present) and delegates
 * deep validation to the FhirValidationService when profiles are available.
 */
@Injectable()
export class FhirValidationPipe implements PipeTransform {

  /** @param validationService - The injected FHIR validation service. */
  constructor(private readonly validationService: FhirValidationService) {}

  /**
   * Validates the incoming request body.
   * @param value - The parsed request body.
   * @returns The original value if validation passes.
   * @throws BadRequestException with an OperationOutcome if validation fails.
   */
  async transform(value: any) {

    if (!value || typeof value !== 'object') {
      throw new BadRequestException(new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Invalid, diagnostics: 'Request body must be a JSON object' })] }));
    }

    if (!value.resourceType) {
      throw new BadRequestException(new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Missing required field: resourceType' })] }));
    }

    const result = await this.validationService.validate(value);

    if (!result.valid) {
      const errors = result.issues.filter((i) => i.severity === 'error');
      // If the only error is a missing profile, skip deep validation (profiles may not be loaded yet)
      const profileMissing = errors.every((i) => i.message.includes('Profiel niet gevonden'));

      if (profileMissing) {
        return value;
      }

      const issues = errors.map((i) => new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Invalid, diagnostics: i.message, expression: i.path ? [i.path] : undefined }));

      throw new BadRequestException(new OperationOutcome({ issue: issues }));
    }

    return value;
  }
}
