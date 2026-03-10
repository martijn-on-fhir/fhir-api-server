import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Bundle, BundleEntry, BundleEntrySearch, BundleLink, BundleType, SearchEntryMode } from 'fhir-models-r4';
import { BgzService } from './bgz.service';

/**
 * FHIR $bgz (Basisgegevensset Zorg) controller.
 * Returns a Bundle with the patient's 26 BgZ zibs.
 * Registered BEFORE FhirController for route priority.
 */
@ApiTags('FHIR BgZ')
@Controller('fhir')
export class BgzController {

  constructor(private readonly bgzService: BgzService) {}

  @Get('Patient/:id/\\$bgz')
  @ApiOperation({ summary: '$bgz (Basisgegevensset Zorg)', description: 'Returns a Bundle containing the 26 BgZ zibs for a specific patient.' })
  @ApiParam({ name: 'id', description: 'Patient logical id' })
  @ApiResponse({ status: 200, description: 'Bundle (searchset) with all BgZ resources' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async bgz(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { matches, includes } = await this.bgzService.getBgz(id);
    const baseUrl = this.getBaseUrl(req);

    const entries: BundleEntry[] = [
      ...matches.map((r) => new BundleEntry({ fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`, resource: this.resolveRefs(r, baseUrl), search: new BundleEntrySearch({ mode: SearchEntryMode.Match }) })),
      ...includes.map((r) => new BundleEntry({ fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`, resource: this.resolveRefs(r, baseUrl), search: new BundleEntrySearch({ mode: SearchEntryMode.Include }) })),
    ];

    const bundle = new Bundle({ type: BundleType.Searchset, total: entries.length, link: [new BundleLink({ relation: 'self', url: `${baseUrl}/Patient/${id}/$bgz` })], entry: entries });

    res.set('Content-Type', 'application/fhir+json').json(bundle);
  }

  private getBaseUrl(req: Request): string {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');

    return `${proto}://${host}/fhir`;
  }

  private resolveRefs(obj: any, baseUrl: string): any {
    if (obj === null || obj === undefined) {
return obj;
}

    if (Array.isArray(obj)) {
return obj.map((item) => this.resolveRefs(item, baseUrl));
}

    if (typeof obj !== 'object') {
return obj;
}

    const resolved: any = {};

    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = key === 'reference' && typeof value === 'string' && !value.startsWith('http') ? `${baseUrl}/${value}` : this.resolveRefs(value, baseUrl);
    }

    return resolved;
  }
}
