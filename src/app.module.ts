import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AdministrationModule } from './administration/administration.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FhirModule } from './fhir/fhir.module';
import { FhirThrottlerGuard } from './fhir/guards/fhir-throttler.guard';
import { SmartAuthGuard } from './fhir/guards/smart-auth.guard';
import { SmartModule } from './fhir/smart/smart.module';
import { HealthModule } from './health/health.module';
import { AuditMiddleware } from './logging/audit.middleware';
import { CorrelationMiddleware } from './logging/correlation.middleware';

/** Root application module. Configures MongoDB connection, health checks, logging, rate limiting and imports the FHIR module. */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{
      name: 'short',
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10) * 1000,
      limit: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    }, {
      name: 'long',
      ttl: 600_000, // 10 minutes
      limit: parseInt(process.env.RATE_LIMIT_MAX_LONG || '1000', 10),
    }]),
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/fhir'),
    FhirModule,
    AdminModule,
    AdministrationModule,
    SmartModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: FhirThrottlerGuard }, { provide: APP_GUARD, useClass: SmartAuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('{*splat}');
    consumer.apply(AuditMiddleware).forRoutes('fhir');
  }
}
