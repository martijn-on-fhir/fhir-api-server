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
}

/** NestJS injection token for ServerConfig. */
export const SERVER_CONFIG = 'SERVER_CONFIG';

/** Loads server operation config from app-config.json with env var overrides. Defaults to disabled. */
export const loadServerConfig = (): ServerConfig => {
  let fileConfig: any = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fileConfig = require('../../../config/app-config.json').server || {};
  } catch {
    // Config file not found — rely on env vars
  }

  return {
    reindex: { enabled: process.env.SERVER_REINDEX_ENABLED === 'true' || fileConfig.reindex?.enabled === true },
    expunge: { enabled: process.env.SERVER_EXPUNGE_ENABLED === 'true' || fileConfig.expunge?.enabled === true },
    cascadeDelete: { enabled: process.env.SERVER_CASCADE_DELETE_ENABLED === 'true' || fileConfig.cascadeDelete?.enabled === true },
    snapshot: { enabled: process.env.SERVER_SNAPSHOT_ENABLED === 'true' || fileConfig.snapshot?.enabled === true },
    restore: { enabled: process.env.SERVER_RESTORE_ENABLED === 'true' || fileConfig.restore?.enabled === true },
  };
};
