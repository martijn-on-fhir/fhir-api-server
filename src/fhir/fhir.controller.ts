import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Req, Res, HttpStatus, Inject, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Bundle, BundleEntry, BundleEntryRequest, BundleEntryResponse, BundleEntrySearch, BundleLink, BundleType, HTTPVerb, OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType, SearchEntryMode } from 'fhir-models-r4';
import { CacheService } from '../cache/cache.service';
import { AuditEventService } from './audit/audit-event.service';
import { buildCapabilityStatement } from './capability-statement.builder';
import { FhirService } from './fhir.service';
import { sanitizeSearchParams } from './search/sanitize';
import { SearchParameterRegistry } from './search/search-parameter-registry.service';
import { applySummary, applyElements } from './search/summary.utils';
import { SmartConfig, SMART_CONFIG } from './smart/smart-config';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';
import { FhirValidationService } from './validation/fhir-validation.service';
import { fhirJsonToXml, fhirXmlToJson } from './xml/fhir-xml.utils';

/** FHIR R4 Patient compartment definition: maps resource types to their reference search parameters that link to Patient. */
const COMPARTMENT_PARAMS: Record<string, Record<string, string[]>> = {
  Patient: {
    AllergyIntolerance: ['patient', 'recorder', 'asserter'], Condition: ['patient', 'asserter'], Observation: ['subject', 'performer'],
    Encounter: ['patient'], Procedure: ['patient', 'performer'], Immunization: ['patient'], CareTeam: ['patient', 'participant'],
    MedicationRequest: ['subject'], MedicationStatement: ['subject'], DiagnosticReport: ['subject'], CarePlan: ['subject'],
    EpisodeOfCare: ['patient'], Consent: ['patient'], Coverage: ['beneficiary'], Claim: ['patient'],
    DocumentReference: ['subject', 'author'], Composition: ['subject', 'author'], ServiceRequest: ['subject'],
    Appointment: ['actor'], Communication: ['subject', 'sender', 'recipient'], QuestionnaireResponse: ['subject', 'author'],
    Flag: ['patient'], Goal: ['patient'], NutritionOrder: ['patient'], DeviceRequest: ['subject'],
    RiskAssessment: ['subject'], ClinicalImpression: ['subject'], DetectedIssue: ['patient'],
    FamilyMemberHistory: ['patient'], List: ['subject', 'source'], Media: ['subject'],
    MedicationAdministration: ['patient', 'performer', 'subject'], MedicationDispense: ['subject', 'patient', 'receiver'],
    RelatedPerson: ['patient'], Schedule: ['actor'], Specimen: ['subject'], SupplyDelivery: ['patient'],
    SupplyRequest: ['requester'], Task: ['owner', 'focus'], VisionPrescription: ['patient'],
  },
  Practitioner: {
    Appointment: ['actor'], Encounter: ['practitioner', 'participant'], Observation: ['performer'],
    Procedure: ['performer'], DiagnosticReport: ['performer'], EpisodeOfCare: ['care-manager'],
    MedicationRequest: ['requester'], CarePlan: ['performer'], CareTeam: ['participant'],
    ServiceRequest: ['performer', 'requester'], DocumentReference: ['author'], Composition: ['author'],
    Communication: ['sender', 'recipient'], Schedule: ['actor'], Task: ['owner'],
  },
  Encounter: {
    Observation: ['encounter'], Condition: ['encounter'], Procedure: ['encounter'],
    DiagnosticReport: ['encounter'], MedicationRequest: ['encounter'], CarePlan: ['encounter'],
    ServiceRequest: ['encounter'], Communication: ['encounter'], Composition: ['encounter'],
    DocumentReference: ['context'], ClinicalImpression: ['encounter'], NutritionOrder: ['encounter'],
    QuestionnaireResponse: ['encounter'], RiskAssessment: ['encounter'],
  },
};

/**
 * Generic FHIR REST controller that handles all resource types via dynamic `:resourceType` routes.
 * All responses use `application/fhir+json` content type and conform to the FHIR R4 REST specification.
 */
@ApiTags('FHIR R4')
@Controller('fhir')
export class FhirController {
  /**
   * @param fhirService - Service handling resource persistence.
   * @param validationPipe - Pipe that validates incoming resource bodies against FHIR R4 rules.
   */
  // eslint-disable-next-line max-len
  constructor(private readonly fhirService: FhirService, private readonly validationPipe: FhirValidationPipe, private readonly validationService: FhirValidationService, private readonly searchRegistry: SearchParameterRegistry, @Inject(SMART_CONFIG) private readonly smartConfig: SmartConfig, private readonly auditService: AuditEventService, private readonly cacheService: CacheService) {}

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
  @ApiOperation({ summary: 'CapabilityStatement', description: 'Returns the server CapabilityStatement describing supported resources, interactions and operations.' })
  @ApiResponse({ status: 200, description: 'CapabilityStatement resource' })
  async metadata(@Req() req: Request, @Res() res: Response) {

    const baseUrl = this.getBaseUrl(req);
    const statement = await this.cacheService.getOrSet(`capability:${baseUrl}`, async () => {
      const resourceTypes = await this.fhirService.getResourceTypes();
      const searchParamsByType = new Map(resourceTypes.map((t) => [t, this.searchRegistry.getParamsForType(t)]));

      return buildCapabilityStatement(baseUrl, resourceTypes, searchParamsByType, this.smartConfig);
    });

    this.sendFhirResponse(res, req, statement);
  }

  /** FHIR system-level history. Returns a history Bundle across all resource types. */
  @Get('_history')
  @ApiOperation({ summary: 'System History', description: 'Returns version history across all resource types.' })
  @ApiQuery({ name: '_since', required: false, description: 'Only include versions created at or after this date' })
  @ApiQuery({ name: '_count', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Bundle (history)' })
  async systemHistory(@Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    const { entries, total } = await this.fhirService.systemHistory(sanitizeSearchParams(queryParams));
    const baseUrl = this.getBaseUrl(req);

    return this.sendFhirResponse(res, req, this.buildHistoryBundle(entries, total, `${baseUrl}/_history`, baseUrl));
  }

  /** FHIR $meta operation (system-level). Returns aggregated meta across all resources. */
  @Get('\\$meta')
  @ApiOperation({ summary: '$meta (system)', description: 'Returns aggregated profiles, tags and security labels across all resources.' })
  @ApiResponse({ status: 200, description: 'Parameters resource with Meta' })
  async metaSystem(@Req() req: Request, @Res() res: Response) {

    const meta = await this.fhirService.getAggregatedMeta();

    this.sendFhirResponse(res, req, { resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: meta }] });
  }

  /**
   * FHIR $reindex operation. Reloads custom search parameters from the conformance_resources collection
   * into the SearchParameterRegistry so they take effect immediately.
   */
  @Post('\\$reindex')
  @ApiOperation({summary: '$reindex', description: 'Reloads search parameter definitions from the database. Use after creating or updating SearchParameter resources.'})
  @ApiResponse({status: 200, description: 'OperationOutcome confirming reindex'})
  async reindex(@Req() req: Request, @Res() res: Response) {
    const count = await this.searchRegistry.reload();
    const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Search parameter registry reloaded: ${count} parameters active`})]});
    this.sendFhirResponse(res, req, outcome);
  }

  /**
   * FHIR $expunge operation (system-level). Physically purges deleted resources and/or old versions from the database.
   * Used for GDPR/AVG compliance — permanently removes data that soft delete preserves.
   */
  @Post('\\$expunge')
  @ApiOperation({summary: '$expunge (system)', description: 'Physically purge deleted resources and/or old history versions across all resource types.'})
  @ApiResponse({status: 200, description: 'OperationOutcome with expunge counts'})
  async expungeSystem(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    body = this.parseRequestBody(req);
    const params = this.extractExpungeParams(body);
    const result = await this.fhirService.expunge(params);
    const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Expunged ${result.resources} resource(s) and ${result.versions} history version(s)`})]});
    this.sendFhirResponse(res, req, outcome);
  }

  /**
   * FHIR $lastn operation (Observation). Returns the most recent N observations per code.
   * Groups by code and returns max observations per group, sorted by date descending.
   */
  @Get('Observation/\\$lastn')
  @ApiOperation({summary: '$lastn', description: 'Returns the last N observations grouped by code. Default max=1.'})
  @ApiQuery({name: 'max', required: false, type: Number, description: 'Maximum observations per code group (default 1)'})
  @ApiQuery({name: 'category', required: false, description: 'Filter by category'})
  @ApiQuery({name: 'code', required: false, description: 'Filter by code (system|code)'})
  @ApiQuery({name: 'patient', required: false, description: 'Filter by patient reference'})
  @ApiQuery({name: 'subject', required: false, description: 'Filter by subject reference'})
  @ApiResponse({status: 200, description: 'Bundle (searchset) with last N observations per code'})
  async lastn(@Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const params = sanitizeSearchParams(queryParams);
    const max = params.max ? parseInt(params.max, 10) : 1;
    const {resources, total} = await this.fhirService.lastn(params, max);
    const baseUrl = this.getBaseUrl(req);

    const entries = resources.map((r: any) => {
      const fhir = this.toFhirJson(r, baseUrl);

      return new BundleEntry({fullUrl: `${baseUrl}/Observation/${fhir.id}`, resource: fhir, search: new BundleEntrySearch({mode: SearchEntryMode.Match})});
    });

    const selfUrl = this.buildSelfUrl(baseUrl, 'Observation/$lastn', params);
    const bundle = new Bundle({type: BundleType.Searchset, total, link: [new BundleLink({relation: 'self', url: selfUrl})], entry: entries});

    this.sendFhirResponse(res, req, bundle);
  }

  /**
   * FHIR $validate operation (type-level). Validates a resource against the R4 spec and optionally a specific profile.
   * Always returns HTTP 200 with an OperationOutcome — validation errors are reported as issues, not HTTP errors.
   */
  @Post(':resourceType/\\$validate')
  @ApiOperation({ summary: '$validate (type-level)', description: 'Validates a resource against the FHIR R4 spec and optionally a specific profile. Always returns HTTP 200.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiResponse({ status: 200, description: 'OperationOutcome with validation results' })
  async validateType(@Param('resourceType') resourceType: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {

    body = this.parseRequestBody(req);
    const { resource, profile } = this.extractValidateParams(body);

    if (!resource) {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'No resource provided for validation' })] });

      return this.sendFhirResponse(res, req, outcome);
    }

    if (!resource.resourceType) {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Missing required field: resourceType' })] });

      return this.sendFhirResponse(res, req, outcome);
    }

    if (resource.resourceType !== resourceType) {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Invalid, diagnostics: `Resource type '${resource.resourceType}' does not match endpoint '${resourceType}'` })] });

      return this.sendFhirResponse(res, req, outcome);
    }

    const result = await this.validationService.validate(resource, profile);
    this.sendFhirResponse(res, req, this.validationResultToOutcome(result));
  }

  /**
   * FHIR $validate operation (instance-level). Validates the stored resource or a provided body against a profile.
   * Always returns HTTP 200 with an OperationOutcome.
   */
  @Post(':resourceType/:id/\\$validate')
  @ApiOperation({ summary: '$validate (instance-level)', description: 'Validates a stored resource or provided body against a profile.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'OperationOutcome with validation results' })
  async validateInstance(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {

    body = this.parseRequestBody(req);
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

    this.sendFhirResponse(res, req, this.validationResultToOutcome(result));
  }

  /**
   * FHIR $expunge operation (type-level). Purges deleted resources and/or old versions for a specific resource type.
   */
  @Post(':resourceType/\\$expunge')
  @ApiOperation({summary: '$expunge (type)', description: 'Physically purge deleted resources and/or old history versions for a specific resource type.'})
  @ApiParam({name: 'resourceType', example: 'Patient'})
  @ApiResponse({status: 200, description: 'OperationOutcome with expunge counts'})
  async expungeType(@Param('resourceType') resourceType: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    body = this.parseRequestBody(req);
    const params = this.extractExpungeParams(body);
    const result = await this.fhirService.expunge({...params, resourceType});
    const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Expunged ${result.resources} resource(s) and ${result.versions} history version(s) for ${resourceType}`})]});
    this.sendFhirResponse(res, req, outcome);
  }

  /**
   * FHIR $expunge operation (instance-level). Purges a specific resource and all its history permanently.
   */
  @Post(':resourceType/:id/\\$expunge')
  @ApiOperation({summary: '$expunge (instance)', description: 'Physically purge a specific resource instance and all its history.'})
  @ApiParam({name: 'resourceType', example: 'Patient'})
  @ApiParam({name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444'})
  @ApiResponse({status: 200, description: 'OperationOutcome with expunge counts'})
  async expungeInstance(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    body = this.parseRequestBody(req);
    const params = this.extractExpungeParams(body);
    const result = await this.fhirService.expunge({...params, resourceType, id});
    const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Expunged ${result.resources} resource(s) and ${result.versions} history version(s) for ${resourceType}/${id}`})]});
    this.sendFhirResponse(res, req, outcome);
  }

  /**
   * FHIR $diff operation (instance-level). Compares two versions of the same resource.
   * Query params: versionId (required) — compare current version with this version.
   * Optional: fromVersion — compare fromVersion with versionId instead of current.
   */
  @Get(':resourceType/:id/\\$diff')
  @ApiOperation({summary: '$diff (instance)', description: 'Compare two versions of a resource. Returns a Parameters resource with the differences.'})
  @ApiParam({name: 'resourceType', example: 'Patient'})
  @ApiParam({name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444'})
  @ApiQuery({name: 'versionId', required: true, description: 'Version to compare against (the "to" version)'})
  @ApiQuery({name: 'fromVersion', required: false, description: 'Version to compare from (defaults to current version)'})
  @ApiResponse({status: 200, description: 'Parameters resource with diff entries'})
  async diffInstance(@Param('resourceType') resourceType: string, @Param('id') id: string, @Query('versionId') versionId: string, @Query('fromVersion') fromVersion: string, @Req() req: Request, @Res() res: Response) {
    if (!versionId) {
      const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Query parameter "versionId" is required'})]});

      return this.sendFhirResponse(res, req, outcome, HttpStatus.BAD_REQUEST);
    }

    const right = await this.fhirService.vRead(resourceType, id, versionId);
    const left = fromVersion ? await this.fhirService.vRead(resourceType, id, fromVersion) : await this.fhirService.findById(resourceType, id);
    const result = await this.fhirService.diff(left, right);
    this.sendFhirResponse(res, req, result);
  }

  /**
   * FHIR $diff operation (type-level via POST). Compares two arbitrary resources provided in the body.
   * Body: Parameters resource with "left" and "right" resource parameters.
   */
  @Post(':resourceType/\\$diff')
  @ApiOperation({summary: '$diff (type, POST)', description: 'Compare two resources provided in the request body. Body must be a Parameters resource with "left" and "right" resource parameters.'})
  @ApiParam({name: 'resourceType', example: 'Patient'})
  @ApiResponse({status: 200, description: 'Parameters resource with diff entries'})
  async diffType(@Param('resourceType') resourceType: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    body = this.parseRequestBody(req);

    if (!body || body.resourceType !== 'Parameters') {
      const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.Invalid, diagnostics: 'Request body must be a Parameters resource with "left" and "right" resource parameters'})]});

      return this.sendFhirResponse(res, req, outcome, HttpStatus.BAD_REQUEST);
    }

    const params = body.parameter || [];
    const left = params.find((p: any) => p.name === 'left')?.resource;
    const right = params.find((p: any) => p.name === 'right')?.resource;

    if (!left || !right) {
      const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Both "left" and "right" resource parameters are required'})]});

      return this.sendFhirResponse(res, req, outcome, HttpStatus.BAD_REQUEST);
    }

    const result = await this.fhirService.diff(left, right);
    this.sendFhirResponse(res, req, result);
  }

  /** FHIR type-level history. Returns a history Bundle for all resources of a given type. */
  @Get(':resourceType/_history')
  @ApiOperation({ summary: 'Type History', description: 'Returns version history for all resources of a given type.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiQuery({ name: '_since', required: false, description: 'Only include versions created at or after this date' })
  @ApiQuery({ name: '_count', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Bundle (history)' })
  async typeHistory(@Param('resourceType') resourceType: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    const { entries, total } = await this.fhirService.typeHistory(resourceType, sanitizeSearchParams(queryParams));
    const baseUrl = this.getBaseUrl(req);

    return this.sendFhirResponse(res, req, this.buildHistoryBundle(entries, total, `${baseUrl}/${resourceType}/_history`, baseUrl));
  }

  /** FHIR $meta operation (type-level). Returns aggregated meta for all resources of a given type. */
  @Get(':resourceType/\\$meta')
  @ApiOperation({ summary: '$meta (type-level)', description: 'Returns aggregated profiles, tags and security labels for a resource type.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiResponse({ status: 200, description: 'Parameters resource with Meta' })
  async metaType(@Param('resourceType') resourceType: string, @Req() req: Request, @Res() res: Response) {

    const meta = await this.fhirService.getAggregatedMeta(resourceType);

    this.sendFhirResponse(res, req, { resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: meta }] });
  }

  /** FHIR $meta operation (instance-level). Returns the meta element for a specific resource. */
  @Get(':resourceType/:id/\\$meta')
  @ApiOperation({ summary: '$meta (instance-level)', description: 'Returns the meta element for a specific resource.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'Parameters resource with Meta' })
  async metaInstance(@Param('resourceType') resourceType: string, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {

    const resource = await this.fhirService.findById(resourceType, id);

    this.sendFhirResponse(res, req, { resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: resource.meta }] });
  }

  /** FHIR $meta-add operation. Adds profiles, tags and security labels to a resource's meta. */
  @Post(':resourceType/:id/\\$meta-add')
  @ApiOperation({ summary: '$meta-add', description: 'Adds profiles, tags and security labels to a resource.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'Parameters resource with updated Meta' })
  async metaAdd(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {

    body = this.parseRequestBody(req);
    const inputMeta = body?.resourceType === 'Parameters' ? body.parameter?.find((p: any) => p.name === 'meta')?.valueMeta : body;
    const updatedMeta = await this.fhirService.metaAdd(resourceType, id, inputMeta || {});

    this.sendFhirResponse(res, req, { resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: updatedMeta }] });
  }

  /** FHIR $meta-delete operation. Removes profiles, tags and security labels from a resource's meta. */
  @Post(':resourceType/:id/\\$meta-delete')
  @ApiOperation({ summary: '$meta-delete', description: 'Removes profiles, tags and security labels from a resource.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'Parameters resource with updated Meta' })
  async metaDelete(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {

    body = this.parseRequestBody(req);
    const inputMeta = body?.resourceType === 'Parameters' ? body.parameter?.find((p: any) => p.name === 'meta')?.valueMeta : body;
    const updatedMeta = await this.fhirService.metaDelete(resourceType, id, inputMeta || {});

    this.sendFhirResponse(res, req, { resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: updatedMeta }] });
  }

  /**
   * FHIR $everything operation (instance-level). Returns the resource and all resources referencing it.
   * Supported on Patient (and extensible to other compartment types).
   * Supports _since, _count, _type parameters.
   */
  @Get(':resourceType/:id/\\$everything')
  @ApiOperation({ summary: '$everything', description: 'Returns the resource and all resources that reference it (Patient compartment).' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiQuery({ name: '_since', required: false, description: 'Only include resources updated since this date' })
  @ApiQuery({ name: '_count', required: false, type: Number, description: 'Maximum number of results' })
  @ApiQuery({ name: '_type', required: false, description: 'Comma-separated list of resource types to include' })
  @ApiResponse({ status: 200, description: 'Bundle (searchset) with all related resources' })
  async everything(@Param('resourceType') resourceType: string, @Param('id') id: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    const params = sanitizeSearchParams(queryParams);
    const { resources, total } = await this.fhirService.everything(resourceType, id, params);
    const baseUrl = this.getBaseUrl(req);

    const entries = resources.map((r: any) => {
      const fhir = this.toFhirJson(r, baseUrl);

      return new BundleEntry({ fullUrl: `${baseUrl}/${fhir.resourceType}/${fhir.id}`, resource: fhir });
    });

    const bundle = new Bundle({ type: BundleType.Searchset, total, link: [new BundleLink({ relation: 'self', url: `${baseUrl}/${resourceType}/${id}/$everything` })], entry: entries });

    this.sendFhirResponse(res, req, bundle);
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
  @ApiOperation({ summary: 'Search', description: 'Search for resources of a given type. Returns a Bundle of type searchset.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiQuery({ name: '_id', required: false, description: 'Filter by logical id' })
  @ApiQuery({ name: '_sort', required: false, description: 'Sort fields (comma-separated, prefix with - for descending)' })
  @ApiQuery({ name: '_count', required: false, description: 'Maximum number of results', type: Number })
  @ApiQuery({ name: '_offset', required: false, description: 'Offset for pagination', type: Number })
  @ApiQuery({ name: '_summary', required: false, description: 'Return summary: true, text, data, count, false' })
  @ApiQuery({ name: '_elements', required: false, description: 'Comma-separated list of elements to include' })
  @ApiQuery({ name: '_include', required: false, description: 'Include referenced resources (format: SourceType:searchParam[:targetType])' })
  @ApiQuery({ name: '_revinclude', required: false, description: 'Reverse include (format: SourceType:searchParam[:targetType])' })
  @ApiResponse({ status: 200, description: 'Bundle (searchset)' })
  async search(@Param('resourceType') resourceType: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    return this.executeSearch(resourceType, queryParams, req, res);
  }

  /** FHIR search via POST (application/x-www-form-urlencoded). Equivalent to GET search. */
  @Post(':resourceType/_search')
  @ApiOperation({ summary: 'Search (POST)', description: 'Search via POST with form-encoded parameters. Equivalent to GET search.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiResponse({ status: 200, description: 'Bundle (searchset)' })
  async searchPost(@Param('resourceType') resourceType: string, @Body() body: Record<string, string>, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    // Merge query string and body params (body takes precedence)
    const mergedParams = { ...queryParams, ...body };

    return this.executeSearch(resourceType, mergedParams, req, res);
  }

  /** FHIR instance-level history. Returns all versions of a specific resource. */
  @Get(':resourceType/:id/_history')
  @ApiOperation({ summary: 'Instance History', description: 'Returns version history for a specific resource instance.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiQuery({ name: '_since', required: false, description: 'Only include versions created at or after this date' })
  @ApiQuery({ name: '_count', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Bundle (history)' })
  async instanceHistory(@Param('resourceType') resourceType: string, @Param('id') id: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    const { entries, total } = await this.fhirService.instanceHistory(resourceType, id, sanitizeSearchParams(queryParams));
    const baseUrl = this.getBaseUrl(req);

    return this.sendFhirResponse(res, req, this.buildHistoryBundle(entries, total, `${baseUrl}/${resourceType}/${id}/_history`, baseUrl));
  }

  /** FHIR vRead interaction. Returns a specific version of a resource. */
  @Get(':resourceType/:id/_history/:versionId')
  @ApiOperation({ summary: 'vRead', description: 'Read a specific version of a resource from history.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiParam({ name: 'versionId', example: '1' })
  @ApiResponse({ status: 200, description: 'The FHIR resource at the requested version' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  @ApiResponse({ status: 410, description: 'Resource was deleted at this version' })
  async vRead(@Param('resourceType') resourceType: string, @Param('id') id: string, @Param('versionId') versionId: string, @Req() req: Request, @Res() res: Response) {

    const resource = await this.fhirService.vRead(resourceType, id, versionId);

    if (this.checkConditionalRead(req, res, { versionId, lastUpdated: resource.meta?.lastUpdated || new Date().toISOString() })) {
return;
}

    const baseUrl = this.getBaseUrl(req);
    this.auditService.recordAudit('vread', resourceType, id, req);
    this.sendFhirResponse(res, req, this.resolveReferences(resource, baseUrl));
  }

  /**
   * FHIR compartment search. Searches resources within a compartment scope.
   * E.g. GET /fhir/Patient/123/Observation returns all Observations for Patient 123.
   */
  @Get(':compartmentType/:compartmentId/:resourceType')
  @ApiOperation({summary: 'Compartment Search', description: 'Search resources within a compartment (e.g. GET /Patient/123/Observation).'})
  @ApiParam({name: 'compartmentType', example: 'Patient'})
  @ApiParam({name: 'compartmentId', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444'})
  @ApiParam({name: 'resourceType', example: 'Observation'})
  @ApiResponse({status: 200, description: 'Bundle (searchset)'})
  async compartmentSearch(@Param('compartmentType') compartmentType: string, @Param('compartmentId') compartmentId: string, @Param('resourceType') resourceType: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const compartmentRef = `${compartmentType}/${compartmentId}`;
    const refParams = COMPARTMENT_PARAMS[compartmentType]?.[resourceType];

    if (!refParams) {
      const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.NotSupported, diagnostics: `Resource type '${resourceType}' is not part of the ${compartmentType} compartment`})]});

      return this.sendFhirResponse(res, req, outcome, HttpStatus.BAD_REQUEST);
    }

    // Build OR filter: any of the compartment's reference params must point to the focal resource
    const baseUrl = this.getBaseUrl(req);
    const refConditions = refParams.map((param) => {
      const resolved = this.searchRegistry.resolvePaths(resourceType, param);
      const mongoPath = (resolved?.paths[0] || param) + '.reference';

      return {[mongoPath]: {$in: [compartmentRef, `${baseUrl}/${compartmentRef}`]}};
    });

    const extraFilter = refConditions.length === 1 ? refConditions[0] : {$or: refConditions};
    const mergedParams = {...sanitizeSearchParams(queryParams), _compartmentFilter: JSON.stringify(extraFilter)};

    return this.executeSearch(resourceType, mergedParams, req, res);
  }

  /**
   * FHIR read interaction. Returns a single resource by logical id.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param req - The Express request.
   * @param res - The Express response. Includes `ETag` header with the current versionId.
   */
  @Get(':resourceType/:id')
  @ApiOperation({ summary: 'Read', description: 'Read a single resource by logical id.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'The FHIR resource' })
  @ApiResponse({ status: 404, description: 'OperationOutcome (not found)' })
  async read(@Param('resourceType') resourceType: string, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {

    const resource = await this.fhirService.findById(resourceType, id);

    // SMART patient-context: verify the resource belongs to the authorized patient
    this.assertPatientContextAccess(resourceType, resource, req);

    if (this.checkConditionalRead(req, res, resource.meta)) {
return;
}

    const baseUrl = this.getBaseUrl(req);
    const fhir = this.toFhirJson(resource, baseUrl);
    this.auditService.recordAudit('read', resourceType, id, req);
    this.sendFhirResponse(res, req, fhir);
  }

  /**
   * FHIR create interaction. Validates the body and persists a new resource.
   * Supports conditional create via If-None-Exist header.
   * Returns 201 Created with `Location` and `ETag` headers.
   */
  @Post(':resourceType')
  @ApiOperation({ summary: 'Create', description: 'Create a new resource. Validates the body and assigns a server-generated id. Supports conditional create via If-None-Exist header.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiHeader({ name: 'If-None-Exist', required: false, description: 'Conditional create: search params (e.g. identifier=system|value)' })
  @ApiResponse({ status: 201, description: 'Created resource with Location and ETag headers' })
  @ApiResponse({ status: 200, description: 'Existing resource found (conditional create)' })
  @ApiResponse({ status: 400, description: 'OperationOutcome (validation error)' })
  @ApiResponse({ status: 409, description: 'OperationOutcome (multiple matches)' })
  async create(@Param('resourceType') resourceType: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {

    body = this.parseRequestBody(req);
    const baseUrl = this.getBaseUrl(req);

    await this.validationPipe.transform(body);

    const ifNoneExist = req.headers['if-none-exist'] as string;

    // Conditional create
    if (ifNoneExist) {
      const searchParams = this.parseSearchString(ifNoneExist);
      searchParams.resourceType = resourceType;
      const { resource, created } = await this.fhirService.conditionalCreate(resourceType, body, searchParams, undefined, req);

      if (!created) {
        res.set('ETag', `W/"${resource.meta.versionId}"`);

        return this.sendFhirResponse(res, req, this.toFhirJson(resource, baseUrl));
      }

      res.set('Location', `${baseUrl}/${resourceType}/${resource.id}`).set('ETag', `W/"${resource.meta.versionId}"`);

      return this.sendWriteResponse(res, req, this.toFhirJson(resource, baseUrl), HttpStatus.CREATED, `Created ${resourceType}/${resource.id}`);
    }

    const resource = await this.fhirService.create(resourceType, body, undefined, req);

    res.set('Location', `${baseUrl}/${resourceType}/${resource.id}`).set('ETag', `W/"${resource.meta.versionId}"`);
    this.sendWriteResponse(res, req, this.toFhirJson(resource, baseUrl), HttpStatus.CREATED, `Created ${resourceType}/${resource.id}`);
  }

  /**
   * FHIR conditional update (without id). PUT /ResourceType?search-params
   * Creates if 0 matches, updates if 1, errors if multiple.
   */
  @Put(':resourceType')
  @ApiOperation({ summary: 'Conditional Update', description: 'Conditional update: creates if 0 matches, updates if 1, errors if multiple.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiResponse({ status: 200, description: 'Updated resource' })
  @ApiResponse({ status: 201, description: 'Created resource (no match found)' })
  @ApiResponse({ status: 409, description: 'OperationOutcome (multiple matches)' })
  async conditionalUpdate(@Param('resourceType') resourceType: string, @Body() body: any, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    body = this.parseRequestBody(req);
    await this.validationPipe.transform(body);

    const baseUrl = this.getBaseUrl(req);
    const searchParams = { ...queryParams, resourceType };
    const { resource, created } = await this.fhirService.conditionalUpdate(resourceType, body, searchParams, undefined, req);

    if (created) {
      res.set('Location', `${baseUrl}/${resourceType}/${resource.id}`).set('ETag', `W/"${resource.meta.versionId}"`);

      return this.sendWriteResponse(res, req, this.toFhirJson(resource, baseUrl), HttpStatus.CREATED, `Created ${resourceType}/${resource.id}`);
    }

    res.set('ETag', `W/"${resource.meta.versionId}"`);
    this.sendWriteResponse(res, req, this.toFhirJson(resource, baseUrl), HttpStatus.OK, `Updated ${resourceType}/${resource.id}`);
  }

  /**
   * FHIR update interaction. Validates the body and replaces the existing resource.
   * Supports If-Match header for optimistic locking.
   */
  @Put(':resourceType/:id')
  @ApiOperation({ summary: 'Update', description: 'Update an existing resource. Validates the body and increments versionId. Supports If-Match for optimistic locking.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiHeader({ name: 'If-Match', required: false, description: 'Optimistic locking: W/"versionId"' })
  @ApiResponse({ status: 200, description: 'Updated resource with ETag header' })
  @ApiResponse({ status: 400, description: 'OperationOutcome (validation error)' })
  @ApiResponse({ status: 404, description: 'OperationOutcome (not found)' })
  @ApiResponse({ status: 412, description: 'OperationOutcome (version conflict)' })
  async update(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {

    body = this.parseRequestBody(req);
    await this.validationPipe.transform(body);

    // If-Match: optimistic locking
    const ifMatch = req.headers['if-match'] as string;

    if (ifMatch) {
      await this.fhirService.checkIfMatch(resourceType, id, ifMatch);
    }

    const resource = await this.fhirService.update(resourceType, id, body, undefined, req);
    const baseUrl = this.getBaseUrl(req);

    res.set('ETag', `W/"${resource.meta.versionId}"`);
    this.sendWriteResponse(res, req, this.toFhirJson(resource, baseUrl), HttpStatus.OK, `Updated ${resourceType}/${id}`);
  }

  /**
   * FHIR patch interaction. Applies a JSON Patch (RFC 6902) or FHIRPath Patch to an existing resource.
   * Content-Type determines patch format: application/json-patch+json for JSON Patch, application/fhir+json for FHIRPath Patch.
   * Supports If-Match header for optimistic locking.
   */
  @Patch(':resourceType/:id')
  @ApiOperation({summary: 'Patch', description: 'Partially update a resource using JSON Patch (RFC 6902) or FHIRPath Patch (Parameters).'})
  @ApiParam({name: 'resourceType', example: 'Patient'})
  @ApiParam({name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444'})
  @ApiHeader({name: 'Content-Type', required: true, description: 'application/json-patch+json or application/fhir+json'})
  @ApiHeader({name: 'If-Match', required: false, description: 'Optimistic locking: W/"versionId"'})
  @ApiResponse({status: 200, description: 'Patched resource with ETag header'})
  @ApiResponse({status: 400, description: 'OperationOutcome (invalid patch)'})
  @ApiResponse({status: 404, description: 'OperationOutcome (not found)'})
  @ApiResponse({status: 412, description: 'OperationOutcome (version conflict)'})
  async patch(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    body = this.parseRequestBody(req);
    const ifMatch = req.headers['if-match'] as string;

    if (ifMatch) {
      await this.fhirService.checkIfMatch(resourceType, id, ifMatch);
    }

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    let resource;

    if (contentType.includes('application/json-patch+json')) {
      resource = await this.fhirService.patch(resourceType, id, body, undefined, req);
    } else if (body?.resourceType === 'Parameters') {
      resource = await this.fhirService.fhirPathPatch(resourceType, id, body, undefined, req);
    } else {
      const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code: IssueType.Invalid, diagnostics: 'PATCH requires Content-Type application/json-patch+json (JSON Patch) or a Parameters resource (FHIRPath Patch)'})]});

      return this.sendFhirResponse(res, req, outcome, HttpStatus.BAD_REQUEST);
    }

    const baseUrl = this.getBaseUrl(req);
    res.set('ETag', `W/"${resource.meta.versionId}"`);
    this.sendWriteResponse(res, req, this.toFhirJson(resource, baseUrl), HttpStatus.OK, `Patched ${resourceType}/${id}`);
  }

  /** FHIR conditional delete: DELETE /ResourceType?search-params */
  @Delete(':resourceType')
  @ApiOperation({ summary: 'Conditional Delete', description: 'Delete resources matching search criteria.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiResponse({ status: 200, description: 'OperationOutcome (success)' })
  async conditionalDelete(@Param('resourceType') resourceType: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {

    const searchParams = { ...queryParams, resourceType };
    const count = await this.fhirService.conditionalDelete(resourceType, searchParams, undefined, req);
    const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Conditionally deleted ${count} ${resourceType} resource(s)` })] });

    this.sendFhirResponse(res, req, outcome);
  }

  /**
   * FHIR delete interaction. Removes the resource and returns an OperationOutcome.
   * Supports _cascade=delete to automatically remove dependent resources.
   * Without _cascade, delete is blocked if other resources reference this one.
   */
  @Delete(':resourceType/:id')
  @ApiOperation({summary: 'Delete', description: 'Delete a resource by logical id. Use _cascade=delete to remove dependent resources.'})
  @ApiParam({name: 'resourceType', example: 'Patient'})
  @ApiParam({name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444'})
  @ApiQuery({name: '_cascade', required: false, description: 'Set to "delete" to cascade delete dependent resources'})
  @ApiResponse({status: 200, description: 'OperationOutcome (success)'})
  @ApiResponse({status: 404, description: 'OperationOutcome (not found)'})
  @ApiResponse({status: 409, description: 'OperationOutcome (referential integrity violation)'})
  async remove(@Param('resourceType') resourceType: string, @Param('id') id: string, @Query('_cascade') cascade: string, @Req() req: Request, @Res() res: Response) {
    const prefer = this.parsePrefer(req);

    if (cascade === 'delete') {
      const deleted = await this.fhirService.cascadeDelete(resourceType, id, undefined, req);

      if (prefer.return === 'minimal') {
 res.status(HttpStatus.NO_CONTENT).end();

 return; 
}

      const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Cascade deleted ${deleted} resource(s) including ${resourceType}/${id}`})]});

      return this.sendFhirResponse(res, req, outcome);
    }

    await this.fhirService.delete(resourceType, id, undefined, req);

    if (prefer.return === 'minimal') {
 res.status(HttpStatus.NO_CONTENT).end();

 return; 
}

    const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `${resourceType}/${id} successfully deleted`})]});
    this.sendFhirResponse(res, req, outcome);
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

  /** Extracts $expunge parameters from a FHIR Parameters resource body. */
  private extractExpungeParams(body: any): {expungeDeletedResources?: boolean; expungeOldVersions?: boolean; expungeEverything?: boolean; limit?: number} {
    if (!body || body.resourceType !== 'Parameters') {
      return {expungeDeletedResources: true};
    }

    const params = body.parameter || [];
    const getBool = (name: string) => params.find((p: any) => p.name === name)?.valueBoolean;
    const getInt = (name: string) => params.find((p: any) => p.name === name)?.valueInteger;

    return {
      expungeDeletedResources: getBool('expungeDeletedResources') ?? false,
      expungeOldVersions: getBool('expungeOldVersions') ?? false,
      expungeEverything: getBool('expungeEverything') ?? false,
      limit: getInt('_limit') || undefined,
    };
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

  /** Shared search execution for GET and POST _search. */
  private async executeSearch(resourceType: string, params: Record<string, string>, req: Request, res: Response) {

    // Sanitize all search params to prevent NoSQL injection via Express bracket notation
    params = sanitizeSearchParams(params);

    // SMART patient-context: restrict search results to resources linked to the authorized patient
    this.applyPatientContextFilter(resourceType, params, req);

    const { resources, total, included, warnings } = await this.fhirService.search(resourceType, params);

    // Prefer: handling=strict → reject unknown search parameters with 400
    const prefer = this.parsePrefer(req);

    if (prefer.handling === 'strict' && warnings.length > 0) {
      const issues = warnings.map((w) => new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.NotFound, diagnostics: w }));

      return this.sendFhirResponse(res, req, new OperationOutcome({ issue: issues }), HttpStatus.BAD_REQUEST);
    }

    const baseUrl = this.getBaseUrl(req);
    const selfUrl = this.buildSelfUrl(baseUrl, resourceType, params);
    const summary = params._summary;

    // _summary=count returns only total, no entries
    if (summary === 'count') {
      const bundle = new Bundle({ type: BundleType.Searchset, total, link: [new BundleLink({ relation: 'self', url: selfUrl })] });

      if (total === undefined) {
delete (bundle as any).total;
}

      return this.sendFhirResponse(res, req, bundle);
    }

    // Apply _summary or _elements projection
    const transformResource = (r: any) => {
      let fhir = this.toFhirJson(r, baseUrl);

      if (summary && summary !== 'false') {
        fhir = applySummary(fhir, summary);
      } else if (params._elements) {
        fhir = applyElements(fhir, params._elements);
      }

      return fhir;
    };

    // Primary results with search.mode = 'match'
    const entries: any[] = resources.map((r) => new BundleEntry({ fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`, resource: transformResource(r), search: new BundleEntrySearch({ mode: SearchEntryMode.Match }) }));

    // Included resources with search.mode = 'include'
    for (const r of included) {
      entries.push(new BundleEntry({ fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`, resource: transformResource(r), search: new BundleEntrySearch({ mode: SearchEntryMode.Include }) }));
    }

    // Search outcome: unknown/unsupported parameters as OperationOutcome with search.mode = 'outcome'
    if (warnings.length > 0) {
      const issues = warnings.map((w) => new OperationOutcomeIssue({ severity: IssueSeverity.Warning, code: IssueType.NotFound, diagnostics: w }));
      entries.push(new BundleEntry({ resource: new OperationOutcome({ issue: issues }), search: new BundleEntrySearch({ mode: SearchEntryMode.Outcome }) }));
    }

    // Pagination links (FHIR spec: self, first, previous, next, last)
    const count = params._count ? parseInt(params._count, 10) : 10;
    const offset = params._offset ? parseInt(params._offset, 10) : 0;
    const paginationParams = { ...params, _count: String(count) };
    const links = [new BundleLink({ relation: 'self', url: selfUrl })];
    links.push(new BundleLink({ relation: 'first', url: this.buildSelfUrl(baseUrl, resourceType, { ...paginationParams, _offset: '0' }) }));

    if (offset > 0) {
      const prevOffset = Math.max(0, offset - count);
      links.push(new BundleLink({ relation: 'previous', url: this.buildSelfUrl(baseUrl, resourceType, { ...paginationParams, _offset: String(prevOffset) }) }));
    }

    if (total !== undefined && offset + count < total) {
      links.push(new BundleLink({ relation: 'next', url: this.buildSelfUrl(baseUrl, resourceType, { ...paginationParams, _offset: String(offset + count) }) }));
    } else if (total === undefined && resources.length === count) {
      // Heuristic: if we got exactly _count results, there are probably more
      links.push(new BundleLink({ relation: 'next', url: this.buildSelfUrl(baseUrl, resourceType, { ...paginationParams, _offset: String(offset + count) }) }));
    }

    if (total !== undefined && total > 0) {
      const lastOffset = Math.max(0, Math.floor((total - 1) / count) * count);
      links.push(new BundleLink({ relation: 'last', url: this.buildSelfUrl(baseUrl, resourceType, { ...paginationParams, _offset: String(lastOffset) }) }));
    }

    const bundle = new Bundle({ type: BundleType.Searchset, total, link: links, entry: entries });

    if (total === undefined) {
delete (bundle as any).total;
}

    this.auditService.recordAudit('search', resourceType, null, req);

    return this.sendFhirResponse(res, req, bundle);
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

  /** Parses a search parameter string (e.g. "identifier=system|value&name=test") into a Record. */
  private parseSearchString(searchString: string): Record<string, string> {

    const params: Record<string, string> = {};

    for (const part of searchString.split('&')) {
      const [key, ...valueParts] = part.split('=');

      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(valueParts.join('='));
      }
    }

    return params;
  }

  /** Builds a FHIR history Bundle from history collection entries. */
  private buildHistoryBundle(entries: any[], total: number, selfUrl: string, baseUrl: string): Bundle {

    const bundleEntries = entries.map((entry) => {
      const { _id, __v, request, response, _deleted, ...resource } = entry;
      const fullUrl = `${baseUrl}/${entry.resourceType}/${entry.id}`;
      const bundleEntry: any = {
        fullUrl,
        request: request ? new BundleEntryRequest({ method: this.toHttpVerb(request.method), url: request.url }) : undefined,
        response: response ? new BundleEntryResponse({ status: response.status, etag: response.etag, lastModified: response.lastModified }) : undefined,
      };

      // Only include the resource body for non-deleted entries
      if (!_deleted) {
        bundleEntry.resource = this.resolveReferences(resource, baseUrl);
      }

      return new BundleEntry(bundleEntry);
    });

    return new Bundle({ type: BundleType.History, total, link: [new BundleLink({ relation: 'self', url: selfUrl })], entry: bundleEntries });
  }

  /** Maps HTTP method string to fhir-models-r4 HTTPVerb enum. */
  private toHttpVerb(method: string): HTTPVerb {
    const map: Record<string, HTTPVerb> = { GET: HTTPVerb.GET, POST: HTTPVerb.POST, PUT: HTTPVerb.PUT, DELETE: HTTPVerb.DELETE };

    return map[method] || HTTPVerb.GET;
  }

  /**
   * Determines the desired response format from the Accept header or _format parameter.
   * Returns 'xml' for XML format requests, 'json' otherwise.
   */
  private getResponseFormat(req: Request): 'json' | 'xml' {
    const format = (req.query as any)._format;

    if (format) {
      const f = String(format).toLowerCase();

      if (f.includes('xml') || f === 'xml') {
return 'xml';
}

      return 'json';
    }

    const accept = req.headers.accept || '';

    if (accept.includes('application/fhir+xml') || accept.includes('application/xml')) {
return 'xml';
}

    return 'json';
  }

  /**
   * Sends a FHIR resource response in the requested format (JSON or XML).
   * For Binary resources with matching Accept header, returns raw content.
   */
  private sendFhirResponse(res: Response, req: Request, resource: any, statusCode = 200): void {
    // Binary resource: serve raw content if Accept matches contentType
    if (resource.resourceType === 'Binary' && resource.contentType && resource.data) {
      const accept = req.headers.accept || '';

      if (accept === resource.contentType || accept.includes(resource.contentType)) {
        const buffer = Buffer.from(resource.data, 'base64');
        res.status(statusCode).set('Content-Type', resource.contentType).send(buffer);

        return;
      }
    }

    const format = this.getResponseFormat(req);

    if (format === 'xml') {
      const xml = fhirJsonToXml(resource);
      res.status(statusCode).set('Content-Type', 'application/fhir+xml').send(xml);
    } else {
      res.status(statusCode).set('Content-Type', 'application/fhir+json').json(resource);
    }
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

  /**
   * Parses the Prefer header into key-value pairs (e.g. "handling=strict; return=minimal" → {handling: "strict", return: "minimal"}).
   */
  /**
   * Verifies that a resource belongs to the authorized patient context for read operations.
   * Throws ForbiddenException if the resource is outside the patient compartment.
   */
  private assertPatientContextAccess(resourceType: string, resource: any, req: Request): void {
    const patientId = (req as any).smartPatientContext;

    if (!patientId) {
      return;
    }

    const obj = resource.toObject ? resource.toObject() : resource;

    // Patient resource: must be the patient's own record
    if (resourceType === 'Patient') {
      if (obj.id !== patientId) {
        throw new ForbiddenException(`Access denied: resource is outside the authorized patient context`);
      }

      return;
    }

    // Other resource types: check if any Patient compartment reference points to the authorized patient
    const refParams = COMPARTMENT_PARAMS.Patient?.[resourceType];

    if (!refParams || refParams.length === 0) {
      return;
    }

    const patientRef = `Patient/${patientId}`;
    const hasAccess = refParams.some((param) => {
      const resolved = this.searchRegistry.resolvePaths(resourceType, param);
      const path = resolved?.paths[0] || param;
      const value = this.getNestedValue(obj, path);

      if (Array.isArray(value)) {
        return value.some((v) => v?.reference === patientRef);
      }

      return value?.reference === patientRef;
    });

    if (!hasAccess) {
      throw new ForbiddenException(`Access denied: resource is outside the authorized patient context`);
    }
  }

  /** Gets a nested value from an object by dot-notation path. */
  private getNestedValue(obj: any, path: string): any {
    let current = obj;

    for (const segment of path.split('.')) {
      if (current == null) {
        return undefined;
      }

      current = Array.isArray(current) ? current.map((item) => item?.[segment]).flat() : current[segment];
    }

    return current;
  }

  /**
   * Injects a compartment filter when the request has a SMART patient-context.
   * Ensures search results only contain resources linked to the authorized patient.
   */
  private applyPatientContextFilter(resourceType: string, params: Record<string, string>, req: Request): void {
    const patientId = (req as any).smartPatientContext;

    if (!patientId || params._compartmentFilter) {
      return;
    }

    // Patient resource: restrict to the patient's own record
    if (resourceType === 'Patient') {
      params._compartmentFilter = JSON.stringify({ id: patientId });

      return;
    }

    // Other resource types: use Patient compartment definition to filter
    const refParams = COMPARTMENT_PARAMS.Patient?.[resourceType];

    if (!refParams || refParams.length === 0) {
      return;
    }

    const patientRef = `Patient/${patientId}`;
    const refConditions = refParams.map((param) => {
      const resolved = this.searchRegistry.resolvePaths(resourceType, param);
      const mongoPath = (resolved?.paths[0] || param) + '.reference';

      return { [mongoPath]: patientRef };
    });

    const filter = refConditions.length === 1 ? refConditions[0] : { $or: refConditions };
    params._compartmentFilter = JSON.stringify(filter);
  }

  private parsePrefer(req: Request): Record<string, string> {
    const header = req.headers.prefer as string;

    if (!header) {
return {};
}

    const result: Record<string, string> = {};

    for (const part of header.split(/[;,]\s*/)) {
      const [key, value] = part.split('=');

      if (key && value) {
result[key.trim()] = value.trim();
}
    }

    return result;
  }

  /**
   * Sends a write response respecting the Prefer: return header.
   * minimal → status with headers only, no body. representation → full resource. OperationOutcome → informational outcome.
   */
  private sendWriteResponse(res: Response, req: Request, resource: any, statusCode: number, diagnostics: string) {
    const prefer = this.parsePrefer(req);

    if (prefer.return === 'minimal') {
 res.status(statusCode === HttpStatus.CREATED ? HttpStatus.CREATED : HttpStatus.NO_CONTENT).end();

 return; 
}

    if (prefer.return === 'OperationOutcome') {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics })] });

      return this.sendFhirResponse(res, req, outcome, statusCode);
    }

    this.sendFhirResponse(res, req, resource, statusCode);
  }

  /**
   * Checks conditional read headers (If-None-Match, If-Modified-Since). Returns true and sends 304 if the condition matches.
   */
  private checkConditionalRead(req: Request, res: Response, meta: { versionId: string; lastUpdated: string }): boolean {
    res.set('ETag', `W/"${meta.versionId}"`);
    res.set('Last-Modified', new Date(meta.lastUpdated).toUTCString());

    const ifNoneMatch = req.headers['if-none-match'] as string;

    if (ifNoneMatch) {
      const etag = ifNoneMatch.replace(/^W\//, '').replace(/"/g, '');

      if (etag === meta.versionId) {
 res.status(304).end();

 return true; 
}
    }

    const ifModifiedSince = req.headers['if-modified-since'] as string;

    if (ifModifiedSince) {
      const sinceDate = new Date(ifModifiedSince);

      if (!isNaN(sinceDate.getTime()) && new Date(meta.lastUpdated) <= sinceDate) {
 res.status(304).end();

 return true; 
}
    }

    return false;
  }

  /**
   * Parses request body from XML to JSON if Content-Type is XML.
   * Returns the body as-is for JSON content types.
   */
  private parseRequestBody(req: Request): any {
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    if (contentType.includes('xml') && typeof req.body === 'string') {
      return fhirXmlToJson(req.body);
    }

    return req.body;
  }
}
