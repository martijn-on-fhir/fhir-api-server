import { Body, Controller, Get, Post, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { IssueSeverity, IssueType, OperationOutcome, OperationOutcomeIssue } from 'fhir-models-r4';
import { AdminService } from './admin.service';
import { BackupRemoteService } from './backup-remote.service';
import { BackupService } from './backup.service';

/** Controller for administrative database operations (snapshot, restore, backup). */
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService, private readonly backupService: BackupService, private readonly backupRemote: BackupRemoteService) {}

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

  /** Returns index usage statistics for all FHIR collections. */
  @Get('index-stats')
  @ApiOperation({ summary: 'Index usage statistics', description: 'Returns MongoDB index usage stats for fhir_resources, fhir_resource_history and conformance_resources collections.' })
  @ApiResponse({ status: 200, description: 'Index stats per collection' })
  async indexStats(@Res() res: Response) {
    const stats = await this.adminService.getIndexStats();
    res.status(HttpStatus.OK).json(stats);
  }

  /** Returns database-level statistics (collection sizes, counts, storage). */
  @Get('db-stats')
  @ApiOperation({ summary: 'Database statistics', description: 'Returns MongoDB collection sizes, document counts and storage statistics.' })
  @ApiResponse({ status: 200, description: 'Database statistics' })
  async dbStats(@Res() res: Response) {
    const stats = await this.adminService.getDbStats();
    res.status(HttpStatus.OK).json(stats);
  }

  /** Create a mongodump backup. */
  @Post('backup')
  @ApiOperation({ summary: 'Create backup', description: 'Creates a compressed mongodump backup in the backup directory. Returns metadata.' })
  @ApiResponse({ status: 200, description: 'Backup metadata (filename, size, collection counts)' })
  async createBackup(@Res() res: Response) {
    try {
      const result = await this.backupService.createBackup();
      res.status(HttpStatus.OK).json(result);
    } catch (err) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({
        issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Exception, diagnostics: `Backup failed: ${(err as Error).message}` })],
      }));
    }
  }

  /** List available backups. */
  @Get('backups')
  @ApiOperation({ summary: 'List backups', description: 'Returns available backup files with size and creation date.' })
  @ApiResponse({ status: 200, description: 'List of backup files' })
  listBackups(@Res() res: Response) {
    res.status(HttpStatus.OK).json(this.backupService.listBackups());
  }

  /** Restore from a mongodump backup. */
  @Post('backup/restore')
  @ApiOperation({ summary: 'Restore from backup', description: 'Restores all collections from a mongodump backup file. WARNING: drops existing data.' })
  @ApiResponse({ status: 200, description: 'OperationOutcome confirming restore' })
  @ApiResponse({ status: 400, description: 'Missing filename or file not found' })
  async restoreBackup(@Body() body: { filename: string }, @Res() res: Response) {
    if (!body?.filename) {
      res.status(HttpStatus.BAD_REQUEST).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({
        issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Request body must contain a "filename" field' })],
      }));

      return;
    }

    try {
      const result = await this.backupService.restoreBackup(body.filename);
      res.status(HttpStatus.OK).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({
        issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Restore complete from ${result.restoredFrom} at ${result.restoredAt}` })],
      }));
    } catch (err) {
      res.status(HttpStatus.BAD_REQUEST).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({
        issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Exception, diagnostics: `Restore failed: ${(err as Error).message}` })],
      }));
    }
  }

  /** List remote backups (S3 or Azure). */
  @Get('backups/remote')
  @ApiOperation({ summary: 'List remote backups', description: 'Returns backup files stored in S3 or Azure Blob Storage.' })
  @ApiResponse({ status: 200, description: 'List of remote backup files' })
  async listRemoteBackups(@Res() res: Response) {
    if (!this.backupRemote.isEnabled()) {
      return res.status(HttpStatus.OK).json({ enabled: false, message: 'Remote backup not configured. Set BACKUP_REMOTE_TYPE to s3 or azure.', backups: [] });
    }

    const backups = await this.backupRemote.listRemote();
    res.status(HttpStatus.OK).json({ enabled: true, provider: process.env.BACKUP_REMOTE_TYPE, backups });
  }

  /** Download a backup from remote storage and restore it. */
  @Post('backup/restore-remote')
  @ApiOperation({ summary: 'Restore from remote backup', description: 'Downloads a backup from S3/Azure and restores it. WARNING: drops existing data.' })
  @ApiResponse({ status: 200, description: 'OperationOutcome confirming restore' })
  async restoreFromRemote(@Body() body: { remoteKey: string }, @Res() res: Response) {
    if (!body?.remoteKey) {
      return res.status(HttpStatus.BAD_REQUEST).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({
        issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Required, diagnostics: 'Request body must contain a "remoteKey" field' })],
      }));
    }

    try {
      const localFilename = body.remoteKey.split('/').pop() || 'remote-backup.gz';
      const localPath = `${process.env.BACKUP_DIR || './backups'}/${localFilename}`;
      await this.backupRemote.download(body.remoteKey, localPath);
      const result = await this.backupService.restoreBackup(localFilename);
      res.status(HttpStatus.OK).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({
        issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Information, code: IssueType.Informational, diagnostics: `Restore complete from remote ${body.remoteKey} at ${result.restoredAt}` })],
      }));
    } catch (err) {
      res.status(HttpStatus.BAD_REQUEST).set('Content-Type', 'application/fhir+json').json(new OperationOutcome({
        issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Exception, diagnostics: `Remote restore failed: ${(err as Error).message}` })],
      }));
    }
  }
}
