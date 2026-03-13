import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/** Threshold in ms for MongoDB profiler slow queries. Configurable via MONGODB_SLOW_QUERY_MS env var. */
const SLOW_QUERY_MS = parseInt(process.env.MONGODB_SLOW_QUERY_MS || '100', 10);

/**
 * Configures MongoDB profiler level 1 (slow queries only) at application startup.
 * Slow queries are logged by MongoDB and visible via `db.system.profile.find()`.
 */
@Injectable()
export class MongodbProfilerService implements OnModuleInit {

  private readonly logger = new Logger(MongodbProfilerService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit(): Promise<void> {
    try {
      const db = this.connection.db;
      await db.command({ profile: 1, slowms: SLOW_QUERY_MS });
      this.logger.log(`MongoDB profiler enabled: level 1 (slow queries > ${SLOW_QUERY_MS}ms)`);
    } catch (err) {
      // Profiling may not be available on all MongoDB deployments (e.g. Atlas free tier)
      this.logger.warn(`Could not enable MongoDB profiler: ${(err as Error).message}`);
    }
  }
}
