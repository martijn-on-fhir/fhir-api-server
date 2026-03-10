import { Controller, Get, Delete, Param, Query, Req, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { BulkExportService } from './bulk-export.service';

/**
 * FHIR Bulk Data Export controller.
 * Implements the FHIR Bulk Data Access IG (kick-off, status polling, NDJSON download, cancel).
 * Registered BEFORE FhirController in the module so routes take priority over :resourceType.
 */
@ApiTags('FHIR Bulk Data Export')
@Controller('fhir')
export class BulkExportController {

  constructor(private readonly bulkExportService: BulkExportService) {}

  /** System-level export: GET /fhir/$export */
  @Get('\\$export')
  @ApiOperation({ summary: 'System-level Bulk Data Export kick-off' })
  @ApiQuery({ name: '_type', required: false, description: 'Comma-separated resource types to include' })
  @ApiQuery({ name: '_since', required: false, description: 'Only include resources updated after this instant' })
  @ApiResponse({ status: 202, description: 'Export accepted — poll Content-Location for status' })
  systemExport(@Query('_type') type: string, @Query('_since') since: string, @Req() req: Request, @Res() res: Response) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const types = type ? type.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const job = this.bulkExportService.kickOff(baseUrl, types, since || undefined);
    res.status(HttpStatus.ACCEPTED).header('Content-Location', `${baseUrl}/fhir/$export-poll-status?_jobId=${job.id}`).json({ message: 'Bulk data export has been started', jobId: job.id });
  }

  /** Group-level export: GET /fhir/Group/:groupId/$export */
  @Get('Group/:groupId/\\$export')
  @ApiOperation({ summary: 'Group-level Bulk Data Export kick-off' })
  @ApiQuery({ name: '_type', required: false })
  @ApiQuery({ name: '_since', required: false })
  @ApiResponse({ status: 202, description: 'Export accepted' })
  groupExport(@Param('groupId') groupId: string, @Query('_type') type: string, @Query('_since') since: string, @Req() req: Request, @Res() res: Response) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const types = type ? type.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const job = this.bulkExportService.kickOff(baseUrl, types, since || undefined, groupId);
    res.status(HttpStatus.ACCEPTED).header('Content-Location', `${baseUrl}/fhir/$export-poll-status?_jobId=${job.id}`).json({ message: 'Bulk data export has been started', jobId: job.id });
  }

  /** Poll status: GET /fhir/$export-poll-status?_jobId=xxx */
  @Get('\\$export-poll-status')
  @ApiOperation({ summary: 'Poll Bulk Data Export status' })
  @ApiQuery({ name: '_jobId', required: true })
  @ApiResponse({ status: 200, description: 'Export complete — body contains output manifest' })
  @ApiResponse({ status: 202, description: 'Export still in progress' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  pollStatus(@Query('_jobId') jobId: string, @Req() req: Request, @Res() res: Response) {
    const job = this.bulkExportService.getJob(jobId);

    if (!job) {
return res.status(HttpStatus.NOT_FOUND).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: `Bulk export job ${jobId} not found` }] });
}

    if (job.status === 'cancelled') {
return res.status(HttpStatus.NOT_FOUND).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Export job was cancelled' }] });
}

    if (job.status === 'error') {
return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: 'Export failed' }] });
}

    if (job.status !== 'complete') {
      return res.status(HttpStatus.ACCEPTED).header('X-Progress', `${job.progress}%`).header('Retry-After', '1').json({ message: 'Export in progress', progress: `${job.progress}%` });
    }

    // Complete — return the output manifest per Bulk Data IG
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const output = [...job.output.entries()].map(([type, ndjson]) => ({ type, url: `${baseUrl}/fhir/$export-output?_jobId=${job.id}&type=${type}`, count: ndjson.split('\n').length }));

    return res.status(HttpStatus.OK).header('Expires', '0').json({
      transactionTime: job.transactionTime, request: job.request, requiresAccessToken: false,
      output, error: job.errors,
    });
  }

  /** Download NDJSON: GET /fhir/$export-output?_jobId=xxx&type=Patient */
  @Get('\\$export-output')
  @ApiOperation({ summary: 'Download NDJSON output for a completed export' })
  @ApiQuery({ name: '_jobId', required: true })
  @ApiQuery({ name: 'type', required: true, description: 'Resource type' })
  downloadNdjson(@Query('_jobId') jobId: string, @Query('type') type: string, @Res() res: Response) {
    const ndjson = this.bulkExportService.getNdjson(jobId, type);

    if (ndjson === undefined) {
return res.status(HttpStatus.NOT_FOUND).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: `No output for job ${jobId} type ${type}` }] });
}

    res.status(HttpStatus.OK).header('Content-Type', 'application/fhir+ndjson').send(ndjson);
  }

  /** Cancel export: DELETE /fhir/$export-poll-status?_jobId=xxx */
  @Delete('\\$export-poll-status')
  @ApiOperation({ summary: 'Cancel a bulk data export job' })
  @ApiQuery({ name: '_jobId', required: true })
  cancelExport(@Query('_jobId') jobId: string, @Res() res: Response) {
    try {
      this.bulkExportService.cancelJob(jobId);
      res.status(HttpStatus.ACCEPTED).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'information', code: 'informational', diagnostics: 'Export job cancelled' }] });
    } catch {
      res.status(HttpStatus.NOT_FOUND).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Job not found' }] });
    }
  }
}
