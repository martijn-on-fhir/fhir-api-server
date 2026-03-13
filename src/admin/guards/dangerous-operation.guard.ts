import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { ServerConfig, SERVER_CONFIG } from '../server-config';

/**
 * Global guard that blocks dangerous operations unless explicitly enabled in server config.
 * Checks: $reindex, $expunge, _cascade=delete, /admin/snapshot, /admin/restore.
 */
@Injectable()
export class DangerousOperationGuard implements CanActivate {
  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  /** @returns true if the operation is allowed, throws ForbiddenException otherwise. */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path;

    if (path.includes('$reindex') && !this.config.reindex.enabled) {
      this.deny('$reindex', 'server.reindex.enabled', 'SERVER_REINDEX_ENABLED');
    }
    if (path.includes('$expunge') && !this.config.expunge.enabled) {
      this.deny('$expunge', 'server.expunge.enabled', 'SERVER_EXPUNGE_ENABLED');
    }
    if (req.method === 'DELETE' && req.query._cascade === 'delete' && !this.config.cascadeDelete.enabled) {
      this.deny('_cascade=delete', 'server.cascadeDelete.enabled', 'SERVER_CASCADE_DELETE_ENABLED');
    }
    if (path === '/admin/snapshot' && !this.config.snapshot.enabled) {
      this.deny('snapshot', 'server.snapshot.enabled', 'SERVER_SNAPSHOT_ENABLED');
    }
    if (path === '/admin/restore' && !this.config.restore.enabled) {
      this.deny('restore', 'server.restore.enabled', 'SERVER_RESTORE_ENABLED');
    }

    return true;
  }

  /** Throws a ForbiddenException with an OperationOutcome body explaining how to enable the operation. */
  private deny(operation: string, configKey: string, envVar: string): never {
    const outcome = new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Forbidden, diagnostics: `${operation} is disabled. Enable via config "${configKey}" or env ${envVar}=true` })] });
    throw new ForbiddenException(outcome);
  }
}
