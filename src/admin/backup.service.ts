import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/** Backup directory. Configurable via BACKUP_DIR env var. */
const BACKUP_DIR = process.env.BACKUP_DIR || join(process.cwd(), 'backups');

/** Backup schedule interval in ms. Configurable via BACKUP_INTERVAL_MS env var. Default: 24 hours. 0 = disabled. */
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS || '86400000', 10);

/** Max number of backups to retain. Configurable via BACKUP_RETENTION_COUNT env var. Default: 7. */
const BACKUP_RETENTION_COUNT = parseInt(process.env.BACKUP_RETENTION_COUNT || '7', 10);

/**
 * Automated MongoDB backup service.
 * Creates compressed backups on a configurable schedule and manages retention.
 * Uses mongodump for consistent point-in-time backups (supports replica sets with --oplog).
 */
@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger(BackupService.name);
  private interval: ReturnType<typeof setInterval>;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  onModuleInit() {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }

    if (BACKUP_INTERVAL_MS > 0) {
      this.logger.log(`Automated backups enabled: every ${BACKUP_INTERVAL_MS / 3600000}h, retention: ${BACKUP_RETENTION_COUNT}, dir: ${BACKUP_DIR}`);
      this.interval = setInterval(() => this.createBackup(), BACKUP_INTERVAL_MS);
    }
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  /** Create a backup using mongodump. Returns the backup filename and metadata. */
  async createBackup(): Promise<{ filename: string; path: string; sizeBytes: number; createdAt: string; collections: Record<string, number> }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fhir-backup-${timestamp}.gz`;
    const outputPath = join(BACKUP_DIR, filename);
    const uri = this.getConnectionUri();

    try {
      // Collect stats before backup
      const db = this.connection.db;
      const collections: Record<string, number> = {};

      for (const name of ['fhir_resources', 'fhir_resource_history', 'conformance_resources', 'jobs']) {
        try {
          collections[name] = await db.collection(name).countDocuments();
        } catch {
          collections[name] = 0;
        }
      }

      this.logger.log(`Starting backup to ${filename}...`);
      execSync(`mongodump --uri="${uri}" --archive="${outputPath}" --gzip`, { timeout: 300_000, stdio: 'pipe' });

      const sizeBytes = statSync(outputPath).size;
      this.logger.log(`Backup complete: ${filename} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

      // Cleanup old backups
      this.cleanupOldBackups();

      return { filename, path: outputPath, sizeBytes, createdAt: new Date().toISOString(), collections };
    } catch (err) {
      this.logger.error(`Backup failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Restore from a mongodump backup file. */
  async restoreBackup(filename: string): Promise<{ restoredFrom: string; restoredAt: string }> {
    const filePath = join(BACKUP_DIR, filename);

    if (!existsSync(filePath)) {
      throw new Error(`Backup file not found: ${filename}`);
    }

    const uri = this.getConnectionUri();

    try {
      this.logger.warn(`Starting restore from ${filename}...`);
      execSync(`mongorestore --uri="${uri}" --archive="${filePath}" --gzip --drop`, { timeout: 600_000, stdio: 'pipe' });
      this.logger.log(`Restore complete from ${filename}`);

      return { restoredFrom: filename, restoredAt: new Date().toISOString() };
    } catch (err) {
      this.logger.error(`Restore failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** List available backup files with metadata. */
  listBackups(): { filename: string; sizeBytes: number; createdAt: string }[] {
    if (!existsSync(BACKUP_DIR)) {
      return [];
    }

    return readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('fhir-backup-') && f.endsWith('.gz'))
      .map((filename) => {
        const stats = statSync(join(BACKUP_DIR, filename));

        return { filename, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Remove old backups exceeding retention count. */
  private cleanupOldBackups(): void {
    const backups = this.listBackups();

    if (backups.length <= BACKUP_RETENTION_COUNT) {
      return;
    }

    const toDelete = backups.slice(BACKUP_RETENTION_COUNT);

    for (const backup of toDelete) {
      unlinkSync(join(BACKUP_DIR, backup.filename));
      this.logger.log(`Deleted old backup: ${backup.filename}`);
    }
  }

  /** Extract MongoDB connection URI from Mongoose connection. */
  private getConnectionUri(): string {
    const client = this.connection.getClient();
    const options = (client as any).s?.options;

    if (options?.srvHost) {
      return `mongodb+srv://${options.credentials?.username || ''}:${options.credentials?.password || ''}@${options.srvHost}/${this.connection.db.databaseName}`;
    }

    const hosts = (client as any).s?.options?.hosts?.map((h: any) => `${h.host}:${h.port}`).join(',') || 'localhost:27017';
    const replicaSet = options?.replicaSet ? `?replicaSet=${options.replicaSet}` : '';

    return `mongodb://${hosts}/${this.connection.db.databaseName}${replicaSet}`;
  }
}
