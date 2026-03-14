import {Controller, Get, Post, Param, Query, Body, Req, Res} from '@nestjs/common';
import {ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse} from '@nestjs/swagger';
import {Request, Response} from 'express';
import {fhirJsonToXml} from '../../fhir/xml/fhir-xml.utils';
import {TerminologyService} from './terminology.service';

/**
 * FHIR terminology operations controller.
 * Provides $expand (ValueSet), $lookup (CodeSystem), and $translate (ConceptMap).
 * Registered before AdministrationController for route priority on $-prefixed operations.
 */
@ApiTags('Terminology')
@Controller('fhir')
export class TerminologyController {

  constructor(private readonly terminologyService: TerminologyService) {}

  /** Sends a FHIR response in JSON or XML based on _format or Accept header. */
  private sendFhirResponse(res: Response, req: Request, resource: any, statusCode = 200): void {
    const format = (req.query as any)._format;
    const isXml = format ? String(format).toLowerCase().includes('xml') : (req.headers.accept || '').includes('xml');

    if (isXml) {
      res.status(statusCode).set('Content-Type', 'application/fhir+xml').set('X-Content-Type-Options', 'nosniff').end(fhirJsonToXml(resource));
    } else {
      res.status(statusCode).set('Content-Type', 'application/fhir+json').set('X-Content-Type-Options', 'nosniff').json(resource);
    }
  }

  // ── $expand ──────────────────────────────────────────────

  @Get('ValueSet/\\$expand')
  @ApiOperation({summary: 'ValueSet $expand (type-level)', description: 'Expands a ValueSet by canonical URL.'})
  @ApiQuery({name: 'url', required: true, description: 'Canonical URL of the ValueSet'})
  @ApiQuery({name: 'filter', required: false, description: 'Text filter on code/display'})
  @ApiQuery({name: 'offset', required: false, type: Number})
  @ApiQuery({name: 'count', required: false, type: Number})
  @ApiResponse({status: 200, description: 'Expanded ValueSet'})
  async expandByUrl(@Query('url') url: string, @Query('filter') filter: string, @Query('offset') offset: string, @Query('count') count: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.terminologyService.expand({url, filter, offset, count});
    this.sendFhirResponse(res, req, result);
  }

  @Get('ValueSet/:id/\\$expand')
  @ApiOperation({summary: 'ValueSet $expand (instance-level)', description: 'Expands a specific ValueSet by id.'})
  @ApiParam({name: 'id', description: 'Logical id of the ValueSet'})
  @ApiQuery({name: 'filter', required: false})
  @ApiQuery({name: 'offset', required: false, type: Number})
  @ApiQuery({name: 'count', required: false, type: Number})
  @ApiResponse({status: 200, description: 'Expanded ValueSet'})
  async expandById(@Param('id') id: string, @Query('filter') filter: string, @Query('offset') offset: string, @Query('count') count: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.terminologyService.expand({filter, offset, count}, id);
    this.sendFhirResponse(res, req, result);
  }

  @Post('ValueSet/\\$expand')
  @ApiOperation({summary: 'ValueSet $expand (POST)', description: 'Expands a ValueSet using a Parameters resource in the body.'})
  @ApiResponse({status: 200, description: 'Expanded ValueSet'})
  async expandPost(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const params = this.extractParameters(body, ['url', 'filter', 'offset', 'count', 'valueSet']);
    const result = await this.terminologyService.expand(params);
    this.sendFhirResponse(res, req, result);
  }

  // ── $lookup ──────────────────────────────────────────────

  @Get('CodeSystem/\\$lookup')
  @ApiOperation({summary: 'CodeSystem $lookup (type-level)', description: 'Looks up a code in a CodeSystem by system URL.'})
  @ApiQuery({name: 'system', required: true, description: 'CodeSystem canonical URL'})
  @ApiQuery({name: 'code', required: true})
  @ApiQuery({name: 'version', required: false})
  @ApiResponse({status: 200, description: 'Parameters resource with lookup result'})
  async lookupBySystem(@Query('system') system: string, @Query('code') code: string, @Query('version') version: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.terminologyService.lookup({system, code, version});
    this.sendFhirResponse(res, req, result);
  }

  @Get('CodeSystem/:id/\\$lookup')
  @ApiOperation({summary: 'CodeSystem $lookup (instance-level)', description: 'Looks up a code in a specific CodeSystem.'})
  @ApiParam({name: 'id', description: 'Logical id of the CodeSystem'})
  @ApiQuery({name: 'code', required: true})
  @ApiResponse({status: 200, description: 'Parameters resource with lookup result'})
  async lookupById(@Param('id') id: string, @Query('code') code: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.terminologyService.lookup({code}, id);
    this.sendFhirResponse(res, req, result);
  }

  @Post('CodeSystem/\\$lookup')
  @ApiOperation({summary: 'CodeSystem $lookup (POST)', description: 'Looks up a code using a Parameters resource in the body.'})
  @ApiResponse({status: 200, description: 'Parameters resource with lookup result'})
  async lookupPost(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const params = this.extractParameters(body, ['system', 'code', 'version', 'display']);
    const result = await this.terminologyService.lookup(params);
    this.sendFhirResponse(res, req, result);
  }

  // ── $translate ───────────────────────────────────────────

  @Get('ConceptMap/\\$translate')
  @ApiOperation({summary: 'ConceptMap $translate (type-level)', description: 'Translates a code using a ConceptMap.'})
  @ApiQuery({name: 'system', required: true, description: 'Source code system URL'})
  @ApiQuery({name: 'code', required: true})
  @ApiQuery({name: 'source', required: false, description: 'Source ValueSet URL'})
  @ApiQuery({name: 'target', required: false, description: 'Target ValueSet URL'})
  @ApiQuery({name: 'url', required: false, description: 'ConceptMap canonical URL'})
  @ApiResponse({status: 200, description: 'Parameters resource with translation result'})
  async translateBySystem(@Query('url') url: string, @Query('system') system: string, @Query('code') code: string, @Query('source') source: string, @Query('target') target: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.terminologyService.translate({url, system, code, source, target});
    this.sendFhirResponse(res, req, result);
  }

  @Get('ConceptMap/:id/\\$translate')
  @ApiOperation({summary: 'ConceptMap $translate (instance-level)', description: 'Translates a code using a specific ConceptMap.'})
  @ApiParam({name: 'id', description: 'Logical id of the ConceptMap'})
  @ApiQuery({name: 'code', required: true})
  @ApiQuery({name: 'system', required: false})
  @ApiResponse({status: 200, description: 'Parameters resource with translation result'})
  async translateById(@Param('id') id: string, @Query('code') code: string, @Query('system') system: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.terminologyService.translate({code, system}, id);
    this.sendFhirResponse(res, req, result);
  }

  @Post('ConceptMap/\\$translate')
  @ApiOperation({summary: 'ConceptMap $translate (POST)', description: 'Translates a code using a Parameters resource in the body.'})
  @ApiResponse({status: 200, description: 'Parameters resource with translation result'})
  async translatePost(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const params = this.extractParameters(body, ['url', 'system', 'code', 'source', 'target']);
    const result = await this.terminologyService.translate(params);
    this.sendFhirResponse(res, req, result);
  }

  /**
   * Extracts named parameters from a FHIR Parameters resource body.
   * Falls back to using the body directly if it's not a Parameters resource.
   */
  private extractParameters(body: any, names: string[]): Record<string, any> {
    if (body?.resourceType !== 'Parameters' || !Array.isArray(body.parameter)) {
      return body || {};
    }

    const result: Record<string, any> = {};

    for (const param of body.parameter) {
      if (!names.includes(param.name)) {
continue;
}

      if (param.resource) {
        result[param.name] = param.resource;
      } else {
        const valueKey = Object.keys(param).find((k) => k.startsWith('value'));

        if (valueKey) {
          result[param.name] = param[valueKey];
        }
      }
    }

    return result;
  }
}
