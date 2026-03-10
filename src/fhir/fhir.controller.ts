import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, Res, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Bundle, BundleEntry, BundleLink, BundleType, OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { buildCapabilityStatement } from './capability-statement.builder';
import { FhirService } from './fhir.service';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';
import { FhirValidationService } from './validation/fhir-validation.service';

/**
 * Generic FHIR REST controller that handles all resource types via dynamic `:resourceType` routes.
 * All responses use `application/fhir+json` content type and conform to the FHIR R4 REST specification.
 */
@Controller('fhir')
export class FhirController {
  /**
   * @param fhirService - Service handling resource persistence.
   * @param validationPipe - Pipe that validates incoming resource bodies against FHIR R4 rules.
   */
  constructor(private readonly fhirService: FhirService, private readonly validationPipe: FhirValidationPipe, private readonly validationService: FhirValidationService) {}

  /**
   * Derives the FHIR base URL from the incoming request, respecting reverse proxy headers.
   * @param req - The Express request object.
   * @returns The absolute base URL, e.g. `http://localhost:3000/fhir`.
   */
  private getBaseUrl(req: Request): string {

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');

    return `${proto}://${host}/fhir`;
  }

  /**
   * FHIR capabilities interaction. Returns a CapabilityStatement describing this server's supported resources, interactions and operations.
   */
  @Get('metadata')
  async metadata(@Req() req: Request, @Res() res: Response) {

    const baseUrl = this.getBaseUrl(req);
    const resourceTypes = await this.fhirService.getResourceTypes();
    const statement = buildCapabilityStatement(baseUrl, resourceTypes);

    res.set('Content-Type', 'application/fhir+json').json(statement);
  }

  /**
   * FHIR $validate operation (type-level). Validates a resource against the R4 spec and optionally a specific profile.
   * Always returns HTTP 200 with an OperationOutcome — validation errors are reported as issues, not HTTP errors.
   */
  @Post(':resourceType/\\$validate')
  async validateType(@Param('resourceType') resourceType: string, @Body() body: any, @Res() res: Response) {

    const { resource, profile } = this.extractValidateParams(body);

    if (!resource) {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'No resource provided for validation' })] });

      return res.set('Content-Type', 'application/fhir+json').json(outcome);
    }

    if (resource.resourceType && resource.resourceType !== resourceType) {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Invalid, diagnostics: `Resource type '${resource.resourceType}' does not match endpoint '${resourceType}'` })] });

      return res.set('Content-Type', 'application/fhir+json').json(outcome);
    }

    const result = await this.validationService.validate(resource, profile);
    res.set('Content-Type', 'application/fhir+json').json(this.validationResultToOutcome(result));
  }

  /**
   * FHIR $validate operation (instance-level). Validates the stored resource or a provided body against a profile.
   * Always returns HTTP 200 with an OperationOutcome.
   */
  @Post(':resourceType/:id/\\$validate')
  async validateInstance(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Res() res: Response) {

    const { resource: bodyResource, profile } = this.extractValidateParams(body);

    // Use provided resource or fall back to the stored one
    let resource = bodyResource;

    if (!resource) {
      const stored = await this.fhirService.findById(resourceType, id);
      const obj = stored.toObject ? stored.toObject() : stored;
      const { _id, __v, ...fhirResource } = obj;

      resource = fhirResource;
    }

    const result = await this.validationService.validate(resource, profile);

    res.set('Content-Type', 'application/fhir+json').json(this.validationResultToOutcome(result));
  }

  /**
   * FHIR search interaction. Returns a Bundle of type `searchset` with matching resources.
   * Supports `_id`, `_sort`, `_count` and `_offset` search parameters.
   * @param resourceType - The FHIR resource type to search.
   * @param queryParams - FHIR search parameters from the query string.
   * @param req - The Express request (used to derive base URL).
   * @param res - The Express response.
   */
  @Get(':resourceType')
  async search(@Param('resourceType') resourceType: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {



    const { resources, total } = await this.fhirService.search(resourceType, queryParams);
    const baseUrl = this.getBaseUrl(req);
    const selfUrl = this.buildSelfUrl(baseUrl, resourceType, queryParams);

    const bundle = new Bundle({
      type: BundleType.Searchset,
      total,
      link: [new BundleLink({ relation: 'self', url: selfUrl })],
      entry: resources.map((r) => new BundleEntry({ fullUrl: `${baseUrl}/${resourceType}/${r.id}`, resource: this.toFhirJson(r, baseUrl) })),
    });

    res.set('Content-Type', 'application/fhir+json').json(bundle);
  }

  /**
   * FHIR read interaction. Returns a single resource by logical id.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param req - The Express request.
   * @param res - The Express response. Includes `ETag` header with the current versionId.
   */
  @Get(':resourceType/:id')
  async read(@Param('resourceType') resourceType: string, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {



    const resource = await this.fhirService.findById(resourceType, id);
    const baseUrl = this.getBaseUrl(req);

    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
  }

  /**
   * FHIR create interaction. Validates the body and persists a new resource.
   * Returns 201 Created with `Location` and `ETag` headers.
   * @param resourceType - The FHIR resource type.
   * @param body - The resource payload to create.
   * @param req - The Express request.
   * @param res - The Express response.
   */
  @Post(':resourceType')
  async create(@Param('resourceType') resourceType: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {


    await this.validationPipe.transform(body);

    const resource = await this.fhirService.create(resourceType, body);
    const baseUrl = this.getBaseUrl(req);

    res.status(HttpStatus.CREATED).set('Content-Type', 'application/fhir+json').set('Location', `${baseUrl}/${resourceType}/${resource.id}`).set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
  }

  /**
   * FHIR update interaction. Validates the body and replaces the existing resource.
   * Increments the versionId automatically.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param body - The updated resource payload.
   * @param req - The Express request.
   * @param res - The Express response.
   */
  @Put(':resourceType/:id')
  async update(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {


    await this.validationPipe.transform(body);

    const resource = await this.fhirService.update(resourceType, id, body);
    const baseUrl = this.getBaseUrl(req);

    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
  }

  /**
   * FHIR delete interaction. Removes the resource and returns an OperationOutcome.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param res - The Express response.
   */
  @Delete(':resourceType/:id')
  async remove(@Param('resourceType') resourceType: string, @Param('id') id: string, @Res() res: Response) {


    await this.fhirService.delete(resourceType, id);

    const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `${resourceType}/${id} successfully deleted` })] });

    res.status(HttpStatus.OK).set('Content-Type', 'application/fhir+json').json(outcome);
  }

  /**
   * Constructs the Bundle `self` link URL including any search parameters.
   * @param baseUrl - The absolute FHIR base URL.
   * @param resourceType - The FHIR resource type.
   * @param params - The search parameters to encode into the URL.
   * @returns The full self URL with query string.
   */
  /**
   * Extracts the resource and profile from a $validate request body.
   * Supports both Parameters resource format and direct resource submission.
   */
  private extractValidateParams(body: any): { resource?: any; profile?: string } {

    if (body?.resourceType === 'Parameters') {
      const params = body.parameter || [];
      const resource = params.find((p: any) => p.name === 'resource')?.resource;
      const profile = params.find((p: any) => p.name === 'profile')?.valueUri;

      return { resource, profile };
    }

    const profile = body?.meta?.profile?.[0];

    return { resource: body, profile };
  }

  /** Converts a ValidationResult from fhir-validator-mx into a FHIR OperationOutcome. */
  private validationResultToOutcome(result: { valid: boolean; issues: { severity: string; message: string; path?: string }[] }): OperationOutcome {

    if (result.valid || result.issues.length === 0) {
      return new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: 'Validation successful' })] });
    }

    const severityMap: Record<string, IssueSeverity> = { error: IssueSeverity.Error, warning: IssueSeverity.Warning, information: IssueSeverity.Information };
    const issues = result.issues.map((i) => new OperationOutcomeIssue({
      severity: severityMap[i.severity] || IssueSeverity.Information, code: i.severity === 'error' ? IssueType.Invalid : IssueType.Informational, diagnostics: i.message, expression: i.path ? [i.path] : undefined,
    }));

    return new OperationOutcome({ issue: issues });
  }

  private buildSelfUrl(baseUrl: string, resourceType: string, params: Record<string, string>): string {

    const queryString = Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');

    return queryString ? `${baseUrl}/${resourceType}?${queryString}` : `${baseUrl}/${resourceType}`;
  }

  /**
   * Converts a Mongoose document to a plain FHIR JSON object, stripping MongoDB internals (_id, __v)
   * and resolving all relative references to absolute URLs.
   * @param doc - The Mongoose document or plain object.
   * @param baseUrl - The absolute FHIR base URL used to resolve references.
   * @returns A clean FHIR resource object with absolute reference URLs.
   */
  private toFhirJson(doc: any, baseUrl: string): any {

    const obj = doc.toObject ? doc.toObject() : doc;
    const { _id, __v, ...fhirResource } = obj;

    return this.resolveReferences(fhirResource, baseUrl);
  }

  /**
   * Recursively walks the object tree and converts all relative `reference` fields to absolute URLs.
   * E.g. `"Patient/123"` becomes `"http://localhost:3000/fhir/Patient/123"`.
   * References that already start with `http` are left unchanged.
   * @param obj - The object (or array/primitive) to process.
   * @param baseUrl - The absolute FHIR base URL to prepend.
   * @returns The object with all references resolved.
   */
  private resolveReferences(obj: any, baseUrl: string): any {

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveReferences(item, baseUrl));
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    const resolved: any = {};

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'reference' && typeof value === 'string' && !value.startsWith('http')) {
        resolved[key] = `${baseUrl}/${value}`;
      } else {
        resolved[key] = this.resolveReferences(value, baseUrl);
      }
    }

    return resolved;
  }
}
