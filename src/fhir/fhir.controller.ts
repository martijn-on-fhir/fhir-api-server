import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Req, Res, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Bundle, BundleEntry, BundleEntryRequest, BundleEntryResponse, BundleEntrySearch, BundleLink, BundleType, HTTPVerb, OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType, SearchEntryMode } from 'fhir-models-r4';
import { AuditEventService } from './audit/audit-event.service';
import { buildCapabilityStatement } from './capability-statement.builder';
import { FhirService } from './fhir.service';
import { sanitizeSearchParams } from './search/sanitize';
import { SearchParameterRegistry } from './search/search-parameter-registry.service';
import { applySummary, applyElements } from './search/summary.utils';
import { SmartConfig, SMART_CONFIG } from './smart/smart-config';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';
import { FhirValidationService } from './validation/fhir-validation.service';

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
  constructor(private readonly fhirService: FhirService, private readonly validationPipe: FhirValidationPipe, private readonly validationService: FhirValidationService, private readonly searchRegistry: SearchParameterRegistry, @Inject(SMART_CONFIG) private readonly smartConfig: SmartConfig, private readonly auditService: AuditEventService) {}

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
    const resourceTypes = await this.fhirService.getResourceTypes();
    const searchParamsByType = new Map(resourceTypes.map((t) => [t, this.searchRegistry.getParamsForType(t)]));
    const statement = buildCapabilityStatement(baseUrl, resourceTypes, searchParamsByType, this.smartConfig);

    res.set('Content-Type', 'application/fhir+json').json(statement);
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

    return res.set('Content-Type', 'application/fhir+json').json(this.buildHistoryBundle(entries, total, `${baseUrl}/_history`, baseUrl));
  }

  /** FHIR $meta operation (system-level). Returns aggregated meta across all resources. */
  @Get('\\$meta')
  @ApiOperation({ summary: '$meta (system)', description: 'Returns aggregated profiles, tags and security labels across all resources.' })
  @ApiResponse({ status: 200, description: 'Parameters resource with Meta' })
  async metaSystem(@Res() res: Response) {

    const meta = await this.fhirService.getAggregatedMeta();

    res.set('Content-Type', 'application/fhir+json').json({ resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: meta }] });
  }

  /**
   * FHIR $validate operation (type-level). Validates a resource against the R4 spec and optionally a specific profile.
   * Always returns HTTP 200 with an OperationOutcome — validation errors are reported as issues, not HTTP errors.
   */
  @Post(':resourceType/\\$validate')
  @ApiOperation({ summary: '$validate (type-level)', description: 'Validates a resource against the FHIR R4 spec and optionally a specific profile. Always returns HTTP 200.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiResponse({ status: 200, description: 'OperationOutcome with validation results' })
  async validateType(@Param('resourceType') resourceType: string, @Body() body: any, @Res() res: Response) {

    const { resource, profile } = this.extractValidateParams(body);

    if (!resource) {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'No resource provided for validation' })] });

      return res.set('Content-Type', 'application/fhir+json').json(outcome);
    }

    if (!resource.resourceType) {
      const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Missing required field: resourceType' })] });

      return res.set('Content-Type', 'application/fhir+json').json(outcome);
    }

    if (resource.resourceType !== resourceType) {
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
  @ApiOperation({ summary: '$validate (instance-level)', description: 'Validates a stored resource or provided body against a profile.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'OperationOutcome with validation results' })
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

    return res.set('Content-Type', 'application/fhir+json').json(this.buildHistoryBundle(entries, total, `${baseUrl}/${resourceType}/_history`, baseUrl));
  }

  /** FHIR $meta operation (type-level). Returns aggregated meta for all resources of a given type. */
  @Get(':resourceType/\\$meta')
  @ApiOperation({ summary: '$meta (type-level)', description: 'Returns aggregated profiles, tags and security labels for a resource type.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiResponse({ status: 200, description: 'Parameters resource with Meta' })
  async metaType(@Param('resourceType') resourceType: string, @Res() res: Response) {

    const meta = await this.fhirService.getAggregatedMeta(resourceType);

    res.set('Content-Type', 'application/fhir+json').json({ resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: meta }] });
  }

  /** FHIR $meta operation (instance-level). Returns the meta element for a specific resource. */
  @Get(':resourceType/:id/\\$meta')
  @ApiOperation({ summary: '$meta (instance-level)', description: 'Returns the meta element for a specific resource.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'Parameters resource with Meta' })
  async metaInstance(@Param('resourceType') resourceType: string, @Param('id') id: string, @Res() res: Response) {

    const resource = await this.fhirService.findById(resourceType, id);

    res.set('Content-Type', 'application/fhir+json').json({ resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: resource.meta }] });
  }

  /** FHIR $meta-add operation. Adds profiles, tags and security labels to a resource's meta. */
  @Post(':resourceType/:id/\\$meta-add')
  @ApiOperation({ summary: '$meta-add', description: 'Adds profiles, tags and security labels to a resource.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'Parameters resource with updated Meta' })
  async metaAdd(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Res() res: Response) {

    const inputMeta = body?.resourceType === 'Parameters' ? body.parameter?.find((p: any) => p.name === 'meta')?.valueMeta : body;
    const updatedMeta = await this.fhirService.metaAdd(resourceType, id, inputMeta || {});

    res.set('Content-Type', 'application/fhir+json').json({ resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: updatedMeta }] });
  }

  /** FHIR $meta-delete operation. Removes profiles, tags and security labels from a resource's meta. */
  @Post(':resourceType/:id/\\$meta-delete')
  @ApiOperation({ summary: '$meta-delete', description: 'Removes profiles, tags and security labels from a resource.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'Parameters resource with updated Meta' })
  async metaDelete(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Res() res: Response) {

    const inputMeta = body?.resourceType === 'Parameters' ? body.parameter?.find((p: any) => p.name === 'meta')?.valueMeta : body;
    const updatedMeta = await this.fhirService.metaDelete(resourceType, id, inputMeta || {});

    res.set('Content-Type', 'application/fhir+json').json({ resourceType: 'Parameters', parameter: [{ name: 'return', valueMeta: updatedMeta }] });
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

    res.set('Content-Type', 'application/fhir+json').json(bundle);
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

    return res.set('Content-Type', 'application/fhir+json').json(this.buildHistoryBundle(entries, total, `${baseUrl}/${resourceType}/${id}/_history`, baseUrl));
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
    const baseUrl = this.getBaseUrl(req);
    this.auditService.recordAudit('vread', resourceType, id, req);

    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${versionId}"`).json(this.resolveReferences(resource, baseUrl));
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

      return res.status(HttpStatus.BAD_REQUEST).set('Content-Type', 'application/fhir+json').json(outcome);
    }

    // Build OR filter: any of the compartment's reference params must point to the focal resource
    const refConditions = refParams.map((param) => {
      const resolved = this.searchRegistry.resolvePaths(resourceType, param);
      const mongoPath = resolved?.paths[0] || param;

      return {[mongoPath]: {$in: [compartmentRef, `${this.getBaseUrl(req)}/${compartmentRef}`]}};
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
    const baseUrl = this.getBaseUrl(req);
    this.auditService.recordAudit('read', resourceType, id, req);

    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
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

    const baseUrl = this.getBaseUrl(req);

    await this.validationPipe.transform(body);

    const ifNoneExist = req.headers['if-none-exist'] as string;

    // Conditional create
    if (ifNoneExist) {
      const searchParams = this.parseSearchString(ifNoneExist);
      searchParams.resourceType = resourceType;
      const { resource, created } = await this.fhirService.conditionalCreate(resourceType, body, searchParams, undefined, req);

      if (!created) {
        return res.status(HttpStatus.OK).set('Content-Type', 'application/fhir+json').set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
      }

      return res.status(HttpStatus.CREATED).set('Content-Type', 'application/fhir+json').set('Location', `${baseUrl}/${resourceType}/${resource.id}`).set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
    }

    const resource = await this.fhirService.create(resourceType, body, undefined, req);

    res.status(HttpStatus.CREATED).set('Content-Type', 'application/fhir+json').set('Location', `${baseUrl}/${resourceType}/${resource.id}`).set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
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

    await this.validationPipe.transform(body);

    const baseUrl = this.getBaseUrl(req);
    const searchParams = { ...queryParams, resourceType };
    const { resource, created } = await this.fhirService.conditionalUpdate(resourceType, body, searchParams, undefined, req);

    if (created) {
      return res.status(HttpStatus.CREATED).set('Content-Type', 'application/fhir+json').set('Location', `${baseUrl}/${resourceType}/${resource.id}`).set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
    }

    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
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

    await this.validationPipe.transform(body);

    // If-Match: optimistic locking
    const ifMatch = req.headers['if-match'] as string;

    if (ifMatch) {
      await this.fhirService.checkIfMatch(resourceType, id, ifMatch);
    }

    const resource = await this.fhirService.update(resourceType, id, body, undefined, req);
    const baseUrl = this.getBaseUrl(req);

    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
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

      return res.status(HttpStatus.BAD_REQUEST).set('Content-Type', 'application/fhir+json').json(outcome);
    }

    const baseUrl = this.getBaseUrl(req);
    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${resource.meta.versionId}"`).json(this.toFhirJson(resource, baseUrl));
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

    res.status(HttpStatus.OK).set('Content-Type', 'application/fhir+json').json(outcome);
  }

  /**
   * FHIR delete interaction. Removes the resource and returns an OperationOutcome.
   * @param resourceType - The FHIR resource type.
   * @param id - The logical resource id.
   * @param res - The Express response.
   */
  @Delete(':resourceType/:id')
  @ApiOperation({ summary: 'Delete', description: 'Delete a resource by logical id.' })
  @ApiParam({ name: 'resourceType', example: 'Patient' })
  @ApiParam({ name: 'id', example: '1d5c8c6c-1405-4c69-80d0-3f1734451444' })
  @ApiResponse({ status: 200, description: 'OperationOutcome (success)' })
  @ApiResponse({ status: 404, description: 'OperationOutcome (not found)' })
  async remove(@Param('resourceType') resourceType: string, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {


    await this.fhirService.delete(resourceType, id, undefined, req);

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

  /** Shared search execution for GET and POST _search. */
  private async executeSearch(resourceType: string, params: Record<string, string>, req: Request, res: Response) {

    // Sanitize all search params to prevent NoSQL injection via Express bracket notation
    params = sanitizeSearchParams(params);

    const { resources, total, included } = await this.fhirService.search(resourceType, params);
    const baseUrl = this.getBaseUrl(req);
    const selfUrl = this.buildSelfUrl(baseUrl, resourceType, params);
    const summary = params._summary;

    // _summary=count returns only total, no entries
    if (summary === 'count') {
      const bundle = new Bundle({ type: BundleType.Searchset, total, link: [new BundleLink({ relation: 'self', url: selfUrl })] });

      return res.set('Content-Type', 'application/fhir+json').json(bundle);
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

    if (offset + count < total) {
      links.push(new BundleLink({ relation: 'next', url: this.buildSelfUrl(baseUrl, resourceType, { ...paginationParams, _offset: String(offset + count) }) }));
    }

    if (total > 0) {
      const lastOffset = Math.max(0, Math.floor((total - 1) / count) * count);
      links.push(new BundleLink({ relation: 'last', url: this.buildSelfUrl(baseUrl, resourceType, { ...paginationParams, _offset: String(lastOffset) }) }));
    }

    const bundle = new Bundle({ type: BundleType.Searchset, total, link: links, entry: entries });
    this.auditService.recordAudit('search', resourceType, null, req);

    return res.set('Content-Type', 'application/fhir+json').json(bundle);
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
