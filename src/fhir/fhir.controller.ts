import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, Res, HttpStatus, BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';
import { Bundle, BundleEntry, BundleLink, BundleType, OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { SUPPORTED_RESOURCE_TYPES } from './fhir.constants';
import { FhirService } from './fhir.service';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';

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
  constructor(private readonly fhirService: FhirService, private readonly validationPipe: FhirValidationPipe) {}

  /**
   * Validates that the given resource type is in the supported list.
   * @param resourceType - The resource type string from the URL.
   * @throws BadRequestException with an OperationOutcome if the type is not supported.
   */
  private validateResourceType(resourceType: string): void {
    if (!SUPPORTED_RESOURCE_TYPES.includes(resourceType as any)) {
      throw new BadRequestException(
        new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.NotSupported, diagnostics: `Resource type '${resourceType}' is not supported` })] }),
      );
    }
  }

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
   * FHIR search interaction. Returns a Bundle of type `searchset` with matching resources.
   * Supports `_id`, `_sort`, `_count` and `_offset` search parameters.
   * @param resourceType - The FHIR resource type to search.
   * @param queryParams - FHIR search parameters from the query string.
   * @param req - The Express request (used to derive base URL).
   * @param res - The Express response.
   */
  @Get(':resourceType')
  async search(@Param('resourceType') resourceType: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    this.validateResourceType(resourceType);
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
    this.validateResourceType(resourceType);
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
    this.validateResourceType(resourceType);
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
    this.validateResourceType(resourceType);
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
    this.validateResourceType(resourceType);
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
