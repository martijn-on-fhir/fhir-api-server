import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Connection } from 'mongoose';
import { Gauge } from 'prom-client';

/** Collects MongoDB connection pool metrics every 5 seconds and exposes them as Prometheus gauges. */
@Injectable()
export class MongodbPoolMetricsService implements OnModuleInit, OnModuleDestroy {

  private interval: ReturnType<typeof setInterval>;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectMetric('mongodb_pool_size') private readonly poolSize: Gauge,
    @InjectMetric('mongodb_pool_available') private readonly poolAvailable: Gauge,
    @InjectMetric('mongodb_pool_waiting') private readonly poolWaiting: Gauge,
  ) {}

  onModuleInit() {
    this.collectMetrics();
    this.interval = setInterval(() => this.collectMetrics(), 5000);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private collectMetrics(): void {
    try {
      const pool = (this.connection.getClient() as any).topology?.s?.pool;

      if (pool) {
        this.poolSize.set(pool.totalConnectionCount ?? 0);
        this.poolAvailable.set(pool.availableConnectionCount ?? 0);
        this.poolWaiting.set(pool.waitQueueSize ?? 0);

        return;
      }

      // MongoDB driver 6.x: access pool stats via server description
      const client = this.connection.getClient() as any;
      const servers = client.topology?.s?.servers;

      if (servers) {
        let totalSize = 0, totalAvailable = 0, totalWaiting = 0;

        for (const server of servers.values()) {
          const p = server.s?.pool;

          if (p) {
            totalSize += p.totalConnectionCount ?? 0;
            totalAvailable += p.availableConnectionCount ?? 0;
            totalWaiting += p.waitQueueSize ?? 0;
          }
        }

        this.poolSize.set(totalSize);
        this.poolAvailable.set(totalAvailable);
        this.poolWaiting.set(totalWaiting);
      }
    } catch {
      // Silently ignore — pool metrics are best-effort
    }
  }
}
