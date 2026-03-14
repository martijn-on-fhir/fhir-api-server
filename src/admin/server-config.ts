import { config } from '../config/app-config';

/** Configuration for dangerous server operations that must be explicitly enabled. */
export interface ServerConfig {
  /** $reindex — reload custom search parameter definitions. */
  reindex: { enabled: boolean };
  /** $expunge — permanently purge resources (GDPR hard-delete). */
  expunge: { enabled: boolean };
  /** _cascade=delete — recursively delete dependent resources. */
  cascadeDelete: { enabled: boolean };
  /** POST /admin/snapshot — export database to fixtures/. */
  snapshot: { enabled: boolean };
  /** POST /admin/restore — wipe and reimport FHIR data. */
  restore: { enabled: boolean };
  /** POST /admin/backup — create mongodump backup. */
  backup: { enabled: boolean };
  /** POST /admin/backup/restore — restore from mongodump backup. */
  backupRestore: { enabled: boolean };
}

/** NestJS injection token for ServerConfig. */
export const SERVER_CONFIG = 'SERVER_CONFIG';

/** Loads server operation config from the centralized config. */
export const loadServerConfig = (): ServerConfig => config.server;
