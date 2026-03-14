import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Centralized application configuration interface.
 * All configuration sections for the FHIR API server.
 */
export interface AppConfig {
  /** HTTP port the server listens on. */
  port: number;
  /** CORS allowed origin(s). */
  corsOrigin: string;
  /** Log output format ('json' for structured logging). */
  logFormat: string;
  /** Maximum request body size for JSON/XML payloads. */
  bodySizeLimit: string;
  /** Request timeout in milliseconds. */
  requestTimeout: number;
  /** MongoDB connection settings. */
  mongodb: {
    /** MongoDB connection URI. */
    uri: string;
    /** Maximum connection pool size. */
    poolSize: number;
    /** Minimum connection pool size. */
    minPoolSize: number;
    /** Threshold in ms for MongoDB profiler slow queries. */
    slowQueryMs: number;
  };
  /** Rate limiting settings. */
  rateLimit: {
    /** Whether rate limiting is disabled. */
    disabled: boolean;
    /** Short-window TTL in seconds. */
    ttl: number;
    /** Maximum requests per short window. */
    max: number;
    /** Maximum requests per long window (10 min). */
    maxLong: number;
  };
  /** FHIR-specific limits and thresholds. */
  fhir: {
    /** Maximum allowed _count parameter value. */
    maxCount: number;
    /** Maximum entries in a batch/transaction Bundle. */
    maxBundleEntries: number;
    /** Maximum included resources per search (_include/_revinclude). */
    maxIncludeResults: number;
    /** Threshold in ms above which search queries are logged as slow. */
    slowQueryThresholdMs: number;
    /** Retention period for AuditEvent resources in days (TTL index). */
    auditRetentionDays: number;
    /** Consent policy cache TTL in milliseconds. */
    consentCacheTtlMs: number;
  };
  /** In-memory cache settings. */
  cache: {
    /** Default cache TTL in milliseconds. */
    ttlMs: number;
  };
  /** SMART on FHIR OAuth2 configuration. */
  smart: {
    /** Whether SMART authentication is enabled. */
    enabled: boolean;
    /** JWT issuer (iss claim). */
    issuer: string;
    /** JWT audience (aud claim). */
    audience: string;
    /** JWKS endpoint for signing key retrieval. */
    jwksUri: string;
    /** JWT claim containing SMART scopes. */
    scopeClaim: string;
    /** OAuth2 authorization endpoint. */
    authorizeUrl: string;
    /** OAuth2 token endpoint. */
    tokenUrl: string;
  };
  /** OpenTelemetry configuration. */
  telemetry: {
    /** Whether telemetry/tracing is enabled. */
    enabled: boolean;
    /** OTLP exporter endpoint URL. */
    endpoint: string;
  };
  /** Multi-tenancy configuration. */
  tenant: {
    /** Whether multi-tenancy is enabled. */
    enabled: boolean;
    /** Maximum connection pool size per tenant. */
    maxPoolSize: number;
  };
  /** Bulk data export ($export) settings. */
  bulkExport: {
    /** Maximum concurrent bulk export jobs. */
    maxConcurrent: number;
    /** Bulk export job timeout in milliseconds. */
    timeoutMs: number;
  };
  /** Backup configuration. */
  backup: {
    /** Directory for local backup files. */
    dir: string;
    /** Automated backup interval in milliseconds (0 = disabled). */
    intervalMs: number;
    /** Number of local backups to retain. */
    retentionCount: number;
    /** Remote storage type ('none', 's3', 'azure'). */
    remoteType: string;
    /** AWS S3 backup settings. */
    s3: { bucket: string; prefix: string; region: string };
    /** Azure Blob Storage backup settings. */
    azure: { connectionString: string; container: string; prefix: string };
  };
  /** Job queue settings. */
  jobs: {
    /** Retention period for completed/cancelled/error jobs in days. */
    retentionDays: number;
  };
  /** Server operation toggles for dangerous admin operations. */
  server: {
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
  };
  /** Terminology server connection settings. */
  terminology: {
    /** Base URL of the terminology server. */
    baseUrl: string;
    /** OAuth2 token endpoint for terminology server auth. */
    authUrl: string;
    /** Username for terminology server authentication. */
    user: string;
    /** Password for terminology server authentication. */
    password: string;
    /** OAuth2 client ID for terminology server. */
    clientId: string;
    /** OAuth2 grant type for terminology server. */
    grantType: string;
  };
  /** Logging configuration. */
  logging: {
    /** Log level (e.g. 'info', 'debug', 'warn'). */
    level: string;
  };
}

/** Returns the value of an environment variable, or undefined if not set. */
const env = (key: string): string | undefined => process.env[key];

/** Returns the value of an environment variable parsed as an integer, or undefined if not set. */
const envInt = (key: string): number | undefined => {
  const v = process.env[key];

  return v !== undefined ? parseInt(v, 10) : undefined;
};

/** Returns the value of an environment variable parsed as a boolean, or undefined if not set. */
const envBool = (key: string): boolean | undefined => {
  const v = process.env[key];

  return v !== undefined ? v === 'true' : undefined;
};

/**
 * Loads the application configuration from config/app-config.json,
 * applies environment variable overrides, and returns a frozen config object.
 * Environment variables take precedence over JSON file values.
 * Called synchronously at startup before NestJS bootstrap.
 */
const loadConfig = (): AppConfig => {
  let fileConfig: any = {};

  try {
    const configPath = resolve(process.cwd(), 'config/app-config.json');
    fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    // Config file not found or invalid — fall back to defaults
  }

  const cfg: AppConfig = {
    port: envInt('PORT') ?? fileConfig.port ?? 3000,
    corsOrigin: env('CORS_ORIGIN') ?? fileConfig.corsOrigin ?? '*',
    logFormat: env('LOG_FORMAT') ?? fileConfig.logFormat ?? '',
    bodySizeLimit: env('BODY_SIZE_LIMIT') ?? fileConfig.bodySizeLimit ?? '5mb',
    requestTimeout: envInt('REQUEST_TIMEOUT') ?? fileConfig.requestTimeout ?? 30000,

    mongodb: {
      uri: env('MONGODB_URI') ?? fileConfig.mongodb?.uri ?? 'mongodb://localhost:27017/fhir',
      poolSize: envInt('MONGODB_POOL_SIZE') ?? fileConfig.mongodb?.poolSize ?? 10,
      minPoolSize: envInt('MONGODB_MIN_POOL_SIZE') ?? fileConfig.mongodb?.minPoolSize ?? 2,
      slowQueryMs: envInt('MONGODB_SLOW_QUERY_MS') ?? fileConfig.mongodb?.slowQueryMs ?? 100,
    },

    rateLimit: {
      disabled: envBool('RATE_LIMIT_DISABLED') ?? fileConfig.rateLimit?.disabled ?? false,
      ttl: envInt('RATE_LIMIT_TTL') ?? fileConfig.rateLimit?.ttl ?? 60,
      max: envInt('RATE_LIMIT_MAX') ?? fileConfig.rateLimit?.max ?? 5000,
      maxLong: envInt('RATE_LIMIT_MAX_LONG') ?? fileConfig.rateLimit?.maxLong ?? 50000,
    },

    fhir: {
      maxCount: envInt('MAX_COUNT') ?? fileConfig.fhir?.maxCount ?? 1000,
      maxBundleEntries: envInt('MAX_BUNDLE_ENTRIES') ?? fileConfig.fhir?.maxBundleEntries ?? 1000,
      maxIncludeResults: envInt('MAX_INCLUDE_RESULTS') ?? fileConfig.fhir?.maxIncludeResults ?? 1000,
      slowQueryThresholdMs: envInt('SLOW_QUERY_THRESHOLD_MS') ?? fileConfig.fhir?.slowQueryThresholdMs ?? 500,
      auditRetentionDays: envInt('AUDIT_RETENTION_DAYS') ?? fileConfig.fhir?.auditRetentionDays ?? 365,
      consentCacheTtlMs: envInt('CONSENT_CACHE_TTL_MS') ?? fileConfig.fhir?.consentCacheTtlMs ?? 60000,
    },

    cache: {
      ttlMs: envInt('CACHE_TTL_MS') ?? fileConfig.cache?.ttlMs ?? 300000,
    },

    smart: {
      enabled: envBool('SMART_ENABLED') ?? fileConfig.smart?.enabled ?? false,
      issuer: env('SMART_ISSUER') ?? fileConfig.smart?.issuer ?? '',
      audience: env('SMART_AUDIENCE') ?? fileConfig.smart?.audience ?? 'fhir-api',
      jwksUri: env('SMART_JWKS_URI') ?? fileConfig.smart?.jwksUri ?? '',
      scopeClaim: env('SMART_SCOPE_CLAIM') ?? fileConfig.smart?.scopeClaim ?? 'scope',
      authorizeUrl: env('SMART_AUTHORIZE_URL') ?? fileConfig.smart?.authorizeUrl ?? '',
      tokenUrl: env('SMART_TOKEN_URL') ?? fileConfig.smart?.tokenUrl ?? '',
    },

    telemetry: {
      enabled: envBool('OTEL_ENABLED') ?? fileConfig.telemetry?.enabled ?? false,
      endpoint: env('OTEL_EXPORTER_OTLP_ENDPOINT') ?? fileConfig.telemetry?.endpoint ?? 'http://localhost:4318',
    },

    tenant: {
      enabled: envBool('MULTI_TENANT_ENABLED') ?? fileConfig.tenant?.enabled ?? false,
      maxPoolSize: envInt('TENANT_MAX_POOL_SIZE') ?? fileConfig.tenant?.maxPoolSize ?? 5,
    },

    bulkExport: {
      maxConcurrent: envInt('MAX_CONCURRENT_EXPORTS') ?? fileConfig.bulkExport?.maxConcurrent ?? 3,
      timeoutMs: envInt('BULK_EXPORT_TIMEOUT_MS') ?? fileConfig.bulkExport?.timeoutMs ?? 600000,
    },

    backup: {
      dir: env('BACKUP_DIR') ?? fileConfig.backup?.dir ?? 'backups',
      intervalMs: envInt('BACKUP_INTERVAL_MS') ?? fileConfig.backup?.intervalMs ?? 86400000,
      retentionCount: envInt('BACKUP_RETENTION_COUNT') ?? fileConfig.backup?.retentionCount ?? 7,
      remoteType: env('BACKUP_REMOTE_TYPE') ?? fileConfig.backup?.remoteType ?? 'none',
      s3: {
        bucket: env('BACKUP_S3_BUCKET') ?? fileConfig.backup?.s3?.bucket ?? '',
        prefix: env('BACKUP_S3_PREFIX') ?? fileConfig.backup?.s3?.prefix ?? '',
        region: env('BACKUP_S3_REGION') ?? fileConfig.backup?.s3?.region ?? '',
      },
      azure: {
        connectionString: env('BACKUP_AZURE_CONNECTION_STRING') ?? fileConfig.backup?.azure?.connectionString ?? '',
        container: env('BACKUP_AZURE_CONTAINER') ?? fileConfig.backup?.azure?.container ?? '',
        prefix: env('BACKUP_AZURE_PREFIX') ?? fileConfig.backup?.azure?.prefix ?? '',
      },
    },

    jobs: {
      retentionDays: envInt('JOB_RETENTION_DAYS') ?? fileConfig.jobs?.retentionDays ?? 7,
    },

    server: {
      reindex: { enabled: envBool('SERVER_REINDEX_ENABLED') ?? fileConfig.server?.reindex?.enabled ?? false },
      expunge: { enabled: envBool('SERVER_EXPUNGE_ENABLED') ?? fileConfig.server?.expunge?.enabled ?? false },
      cascadeDelete: { enabled: envBool('SERVER_CASCADE_DELETE_ENABLED') ?? fileConfig.server?.cascadeDelete?.enabled ?? false },
      snapshot: { enabled: envBool('SERVER_SNAPSHOT_ENABLED') ?? fileConfig.server?.snapshot?.enabled ?? false },
      restore: { enabled: envBool('SERVER_RESTORE_ENABLED') ?? fileConfig.server?.restore?.enabled ?? false },
      backup: { enabled: envBool('SERVER_BACKUP_ENABLED') ?? fileConfig.server?.backup?.enabled ?? false },
      backupRestore: { enabled: envBool('SERVER_BACKUP_RESTORE_ENABLED') ?? fileConfig.server?.backupRestore?.enabled ?? false },
    },

    terminology: {
      baseUrl: env('TERMINOLOGY_BASE_URL') ?? fileConfig.terminology?.baseUrl ?? '',
      authUrl: env('TERMINOLOGY_AUTH_URL') ?? fileConfig.terminology?.authUrl ?? '',
      user: env('TERMINOLOGY_USER') ?? fileConfig.terminology?.user ?? '',
      password: env('TERMINOLOGY_PASSWORD') ?? fileConfig.terminology?.password ?? '',
      clientId: env('TERMINOLOGY_CLIENT_ID') ?? fileConfig.terminology?.clientId ?? '',
      grantType: env('TERMINOLOGY_GRANT_TYPE') ?? fileConfig.terminology?.grantType ?? 'password',
    },

    logging: {
      level: env('LOG_LEVEL') ?? fileConfig.logging?.level ?? 'info',
    },
  };

  return Object.freeze(cfg) as AppConfig;
};

/** Frozen application configuration. Loaded synchronously at startup from config/app-config.json with env var overrides. */
export const config: AppConfig = loadConfig();
