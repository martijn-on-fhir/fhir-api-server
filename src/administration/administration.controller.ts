import {Controller, Get, Post, Put, Delete, Param, Query, Body, Req, Res, HttpStatus} from '@nestjs/common';
import {ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse} from '@nestjs/swagger';
import {Request, Response} from 'express';
// eslint-disable-next-line max-len
import {Bundle, BundleEntry, BundleLink, BundleType, CapabilityStatement, CapabilityStatementImplementation, CapabilityStatementKind, CapabilityStatementRest, CapabilityStatementRestResource, CapabilityStatementRestResourceInteraction, CapabilityStatementRestResourceSearchParam, CapabilityStatementSoftware, IssueSeverity, IssueType, OperationOutcome, OperationOutcomeIssue, PublicationStatus, RestfulCapabilityMode, SearchParamType} from 'fhir-models-r4';
import {AdministrationService} from './administration.service';

@ApiTags('Administration')
@Controller('administration')
export class AdministrationController {

  constructor(private readonly administrationService: AdministrationService) {
  }

  private getBaseUrl(req: Request): string {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');

    return `${proto}://${host}/administration`;
  }

  @Get('metadata')
  @ApiOperation({ summary: 'CapabilityStatement', description: 'Returns the CapabilityStatement for the administration endpoint describing supported conformance resource types and interactions.' })
  @ApiResponse({ status: 200, description: 'CapabilityStatement resource' })
  metadata(@Req() req: Request, @Res() res: Response) {
    const baseUrl = this.getBaseUrl(req);
    const conformanceTypes = ['StructureDefinition', 'ValueSet', 'CodeSystem', 'SearchParameter', 'CompartmentDefinition', 'OperationDefinition', 'NamingSystem', 'ConceptMap', 'ImplementationGuide'];
    const interactions = ['read', 'create', 'update', 'delete', 'search-type'];
    const searchParams = [
      new CapabilityStatementRestResourceSearchParam({ name: 'url', type: SearchParamType.Uri, documentation: 'Canonical URL of the conformance resource' }),
      new CapabilityStatementRestResourceSearchParam({ name: 'name', type: SearchParamType.String, documentation: 'Name of the conformance resource (partial, case-insensitive)' }),
      new CapabilityStatementRestResourceSearchParam({ name: 'version', type: SearchParamType.Token, documentation: 'Version of the conformance resource' }),
      new CapabilityStatementRestResourceSearchParam({ name: 'status', type: SearchParamType.Token, documentation: 'Publication status (draft, active, retired)' }),
      new CapabilityStatementRestResourceSearchParam({ name: '_id', type: SearchParamType.Token, documentation: 'Logical id of the resource' }),
      new CapabilityStatementRestResourceSearchParam({ name: '_count', type: SearchParamType.Number, documentation: 'Maximum number of results' }),
      new CapabilityStatementRestResourceSearchParam({ name: '_offset', type: SearchParamType.Number, documentation: 'Offset for pagination' }),
    ];

    const resources = conformanceTypes.map((type) => new CapabilityStatementRestResource({
      type,
      interaction: interactions.map((code) => new CapabilityStatementRestResourceInteraction({ code })),
      searchParam: searchParams,
      versioning: 'versioned',
    }));

    const statement = new CapabilityStatement({
      status: PublicationStatus.Active,
      date: new Date().toISOString(),
      kind: CapabilityStatementKind.Instance,
      fhirVersion: '4.0.1',
      format: ['application/fhir+json'],
      software: new CapabilityStatementSoftware({ name: 'fhir-api-server-administration', version: '0.1.0' }),
      implementation: new CapabilityStatementImplementation({ description: 'FHIR R4 Administration API for conformance resources (Firely-style)', url: baseUrl }),
      rest: [new CapabilityStatementRest({ mode: RestfulCapabilityMode.Server, resource: resources })],
    });

    res.set('Content-Type', 'application/fhir+json').json(statement);
  }

  @Get(':resourceType')
  @ApiOperation({summary: 'Search conformance resources'})
  @ApiParam({name: 'resourceType', example: 'StructureDefinition'})
  @ApiQuery({name: 'url', required: false, description: 'Canonical URL'})
  @ApiQuery({name: 'name', required: false, description: 'Name (partial, case-insensitive)'})
  @ApiQuery({name: 'version', required: false})
  @ApiQuery({name: 'status', required: false})
  @ApiQuery({name: '_count', required: false, type: Number})
  @ApiQuery({name: '_offset', required: false, type: Number})
  @ApiResponse({status: 200, description: 'Bundle (searchset)'})
  async search(@Param('resourceType') resourceType: string, @Query() queryParams: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const {resources, total} = await this.administrationService.search(resourceType, queryParams);
    const baseUrl = this.getBaseUrl(req);

    const entries = resources.map((r) => {
      const obj = r.toObject ? r.toObject() : r;
      const {_id, __v, ...fhir} = obj;

      return new BundleEntry({fullUrl: `${baseUrl}/${fhir.resourceType}/${fhir.id}`, resource: fhir});
    });

    const selfParams = Object.entries(queryParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const selfUrl = selfParams ? `${baseUrl}/${resourceType}?${selfParams}` : `${baseUrl}/${resourceType}`;
    const bundle = new Bundle({type: BundleType.Searchset, total, link: [new BundleLink({relation: 'self', url: selfUrl})], entry: entries});

    res.set('Content-Type', 'application/fhir+json').json(bundle);
  }

  @Get(':resourceType/:id')
  @ApiOperation({summary: 'Read conformance resource'})
  @ApiParam({name: 'resourceType', example: 'StructureDefinition'})
  @ApiParam({name: 'id'})
  @ApiResponse({status: 200, description: 'The conformance resource'})
  @ApiResponse({status: 404, description: 'Not found'})
  async read(@Param('resourceType') resourceType: string, @Param('id') id: string, @Res() res: Response) {
    const resource = await this.administrationService.findById(resourceType, id);
    const obj = resource.toObject ? resource.toObject() : resource;
    const {_id, __v, ...fhir} = obj;
    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${fhir.meta.versionId}"`).json(fhir);
  }

  @Post(':resourceType')
  @ApiOperation({summary: 'Create conformance resource'})
  @ApiParam({name: 'resourceType', example: 'StructureDefinition'})
  @ApiResponse({status: 201, description: 'Created'})
  async create(@Param('resourceType') resourceType: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    const resource = await this.administrationService.create(resourceType, body);
    const baseUrl = this.getBaseUrl(req);
    const obj = resource.toObject ? resource.toObject() : resource;
    const {_id, __v, ...fhir} = obj;
    res.status(HttpStatus.CREATED).set('Content-Type', 'application/fhir+json').set('Location', `${baseUrl}/${resourceType}/${fhir.id}`).set('ETag', `W/"${fhir.meta.versionId}"`).json(fhir);
  }

  @Put(':resourceType/:id')
  @ApiOperation({summary: 'Update conformance resource'})
  @ApiParam({name: 'resourceType', example: 'StructureDefinition'})
  @ApiParam({name: 'id'})
  @ApiResponse({status: 200, description: 'Updated'})
  async update(@Param('resourceType') resourceType: string, @Param('id') id: string, @Body() body: any, @Res() res: Response) {
    const resource = await this.administrationService.update(resourceType, id, body);
    const obj = resource.toObject ? resource.toObject() : resource;
    const {_id, __v, ...fhir} = obj;
    res.set('Content-Type', 'application/fhir+json').set('ETag', `W/"${fhir.meta.versionId}"`).json(fhir);
  }


  @Delete(':resourceType/:id')
  @ApiOperation({summary: 'Delete conformance resource'})
  @ApiParam({name: 'resourceType', example: 'StructureDefinition'})
  @ApiParam({name: 'id'})
  @ApiResponse({status: 200, description: 'Deleted'})
  async remove(@Param('resourceType') resourceType: string, @Param('id') id: string, @Res() res: Response) {
    await this.administrationService.delete(resourceType, id);
    const outcome = new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `${resourceType}/${id} successfully deleted`})]});
    res.status(HttpStatus.OK).set('Content-Type', 'application/fhir+json').json(outcome);
  }
}