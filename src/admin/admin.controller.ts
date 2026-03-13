import { Body, Controller, Post, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { IssueSeverity, IssueType, OperationOutcome, OperationOutcomeIssue } from 'fhir-models-r4';
import { AdminService } from './admin.service';

/** Controller for administrative database operations (snapshot and restore). */
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** Creates a JSON snapshot in fixtures/ and returns a summary. */
  @Post('snapshot')
  @ApiOperation({ summary: 'Create database snapshot', description: 'Exports all FHIR resources and history to a JSON file in fixtures/. Returns a summary with filename and counts.' })
  @ApiResponse({ status: 200, description: 'Summary with filename, counts and resource type breakdown' })
  async snapshot(@Res() res: Response) {
    const summary = await this.adminService.snapshot();
    res.status(HttpStatus.OK).set('Content-Type', 'application/json').json(summary);
  }

  /** Wipes all FHIR health data and restores from a snapshot file in fixtures/. */
  @Post('restore')
  @ApiOperation({ summary: 'Restore database from snapshot', description: 'Reads a snapshot file from fixtures/, clears all FHIR resources and history, then imports the snapshot data.' })
  @ApiResponse({ status: 200, description: 'OperationOutcome confirming restore' })
  @ApiResponse({ status: 400, description: 'Invalid or missing snapshot file' })
  async restore(@Body() body: { filename: string }, @Res() res: Response) {
    if (!body?.filename) {
      res.status(HttpStatus.BAD_REQUEST).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Request body must contain a "filename" field' })] }));

      return;
    }

    const counts = await this.adminService.restore(body.filename);
    const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Restore complete from ${body.filename}: ${counts.resources} resources, ${counts.history} history entries imported` })] });
    res.status(HttpStatus.OK).set('Content-Type', 'application/fhir+json').json(outcome);
  }
}
