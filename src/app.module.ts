import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FhirModule } from './fhir/fhir.module';
import { HealthModule } from './health/health.module';
import { CorrelationMiddleware } from './logging/correlation.middleware';

/** Root application module. Configures MongoDB connection, health checks, logging and imports the FHIR module. */
@Module({
  imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/fhir'), FhirModule, HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
