import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { FhirResourceHistory, FhirResourceHistorySchema } from '../fhir/fhir-resource-history.schema';
import { FhirResource, FhirResourceSchema } from '../fhir/fhir-resource.schema';
import { tenantDatabaseName } from './tenant.interfaces';

/** Maximum connection pool size per tenant. Configurable via TENANT_MAX_POOL_SIZE. */
const MAX_POOL_SIZE = parseInt(process.env.TENANT_MAX_POOL_SIZE || '5', 10);

/** Idle timeout in ms before a tenant connection is closed. */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** Cached connection entry with last-accessed timestamp. */
interface TenantConnectionEntry {
  connection: Connection;
  resourceModel: Model<FhirResource>;
  historyModel: Model<FhirResourceHistory>;
  lastAccess: number;
}

/**
 * Manages per-tenant Mongoose connections with lazy creation, caching, and idle cleanup.
 * Each tenant gets its own database with separate collections and indexes.
 */
@Injectable()
export class TenantConnectionService implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionService.name);
  private readonly connections = new Map<string, TenantConnectionEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(@InjectConnection() private readonly defaultConnection: Connection) {
    this.cleanupTimer = setInterval(() => this.cleanupIdleConnections(), 60_000);
  }

  /**
   * Returns the Mongoose models for a specific tenant, creating the connection if needed.
   * @param tenantId - The tenant identifier.
   * @returns Object with resourceModel and historyModel bound to the tenant database.
   */
  async getModels(tenantId: string): Promise<{ resourceModel: Model<FhirResource>; historyModel: Model<FhirResourceHistory> }> {
    const existing = this.connections.get(tenantId);

    if (existing) {
      existing.lastAccess = Date.now();

      return { resourceModel: existing.resourceModel, historyModel: existing.historyModel };
    }

    return this.createConnection(tenantId);
  }

  /**
   * Creates a new connection for a tenant, registers schemas, and ensures indexes.
   * @param tenantId - The tenant identifier.
   */
  private async createConnection(tenantId: string): Promise<{ resourceModel: Model<FhirResource>; historyModel: Model<FhirResourceHistory> }> {
    const dbName = tenantDatabaseName(tenantId);
    this.logger.log(`Creating connection for tenant ${tenantId} → database ${dbName}`);

    const connection = this.defaultConnection.useDb(dbName, {
      useCache: true,
    });

    const resourceModel = connection.model<FhirResource>(FhirResource.name, FhirResourceSchema);
    const historyModel = connection.model<FhirResourceHistory>(FhirResourceHistory.name, FhirResourceHistorySchema);

    // Ensure indexes are created on first connect
    await Promise.all([
      resourceModel.ensureIndexes(),
      historyModel.ensureIndexes(),
    ]);

    const entry: TenantConnectionEntry = {
      connection,
      resourceModel,
      historyModel,
      lastAccess: Date.now(),
    };

    this.connections.set(tenantId, entry);
    this.logger.log(`Tenant ${tenantId} connection ready (pool size: ${MAX_POOL_SIZE})`);

    return { resourceModel: entry.resourceModel, historyModel: entry.historyModel };
  }

  /** Closes idle tenant connections that haven't been accessed within IDLE_TIMEOUT_MS. */
  private cleanupIdleConnections(): void {
    const now = Date.now();

    for (const [tenantId, entry] of this.connections) {
      if (now - entry.lastAccess > IDLE_TIMEOUT_MS) {
        this.logger.log(`Closing idle connection for tenant ${tenantId}`);
        entry.connection.close().catch((err) => this.logger.warn(`Error closing tenant connection: ${err.message}`));
        this.connections.delete(tenantId);
      }
    }
  }

  /** Drops the database for a decommissioned tenant. Does not close the connection to avoid cache invalidation issues with useDb. */
  async dropTenantDatabase(tenantId: string): Promise<void> {
    const dbName = tenantDatabaseName(tenantId);
    const existing = this.connections.get(tenantId);

    if (existing) {
      await existing.connection.dropDatabase();
      this.connections.delete(tenantId);
    } else {
      const conn = this.defaultConnection.useDb(dbName);
      await conn.dropDatabase();
    }

    this.logger.warn(`Dropped database ${dbName} for tenant ${tenantId}`);
  }

  /** Closes all tenant connections on module shutdown. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.cleanupTimer);

    const closePromises = Array.from(this.connections.values()).map((entry) =>
      entry.connection.readyState === 1
        ? entry.connection.close().catch((err) => this.logger.warn(`Error closing tenant connection: ${err.message}`))
        : Promise.resolve(),
    );

    await Promise.all(closePromises);
    this.connections.clear();
    this.logger.log('All tenant connections closed');
  }
}
