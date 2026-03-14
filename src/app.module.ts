import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { AdminModule } from './admin/admin.module';
import { AdministrationModule } from './administration/administration.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from './cache/cache.module';
import { config } from './config/app-config';
import { FhirModule } from './fhir/fhir.module';
import { FhirThrottlerGuard } from './fhir/guards/fhir-throttler.guard';
import { SmartAuthGuard } from './fhir/guards/smart-auth.guard';
import { SmartModule } from './fhir/smart/smart.module';
import { HealthModule } from './health/health.module';
import { AuditMiddleware } from './logging/audit.middleware';
import { CorrelationMiddleware } from './logging/correlation.middleware';
import { MetricsModule } from './metrics/metrics.module';
import { ResilienceModule } from './resilience/resilience.module';
import { TenantGuard } from './tenant/tenant.guard';
import { TenantModule } from './tenant/tenant.module';

/** Conditionally include TenantModule only when multi-tenancy is enabled. */
const conditionalImports = config.tenant.enabled ? [TenantModule] : [];

/** Conditionally register TenantGuard only when multi-tenancy is enabled. */
const conditionalProviders = config.tenant.enabled
  ? [{ provide: APP_GUARD, useClass: TenantGuard }]
  : [];

/** Configure ThrottlerModule with Redis storage when cache store is 'redis', otherwise in-memory. */
const throttlerConfig = (): Parameters<typeof ThrottlerModule.forRoot>[0] => {
  const throttlers = [{
    name: 'short',
    ttl: config.rateLimit.ttl * 1000,
    limit: config.rateLimit.max,
  }, {
    name: 'long',
    ttl: 600_000, // 10 minutes
    limit: config.rateLimit.maxLong,
  }];

  if (config.cache.store === 'redis') {
    return { throttlers, storage: new ThrottlerStorageRedisService(config.redis.url) };
  }

  return { throttlers };
};

/** Root application module. Configures MongoDB connection, health checks, logging, rate limiting and imports the FHIR module. */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot(throttlerConfig()),
    MongooseModule.forRoot(config.mongodb.uri, {
      maxPoolSize: config.mongodb.poolSize,
      minPoolSize: config.mongodb.minPoolSize,
    }),
    CacheModule,
    FhirModule,
    AdminModule,
    AdministrationModule,
    SmartModule,
    HealthModule,
    MetricsModule,
    ResilienceModule,
    ...conditionalImports,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: FhirThrottlerGuard }, { provide: APP_GUARD, useClass: SmartAuthGuard }, ...conditionalProviders],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('{*splat}');
    consumer.apply(AuditMiddleware).forRoutes('fhir');
  }
}
