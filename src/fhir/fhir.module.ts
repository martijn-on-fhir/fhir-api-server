import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BgzController } from './bgz/bgz.controller';
import { BgzService } from './bgz/bgz.service';
import { BulkExportController } from './bulk-export/bulk-export.controller';
import { BulkExportService } from './bulk-export/bulk-export.service';
import { BundleProcessorService } from './bundle-processor.service';
import { BundleMiddleware } from './bundle.middleware';
import { FhirResourceHistory, FhirResourceHistorySchema } from './fhir-resource-history.schema';
import { FhirResource, FhirResourceSchema } from './fhir-resource.schema';
import { FhirController } from './fhir.controller';
import { FhirService } from './fhir.service';
import { ChainingService } from './search/chaining.service';
import { IncludeService } from './search/include.service';
import { QueryBuilderService } from './search/query-builder.service';
import { SearchParameterRegistry } from './search/search-parameter-registry.service';
import { SubscriptionNotificationService } from './subscriptions/subscription-notification.service';
import { SubscriptionService } from './subscriptions/subscription.service';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';
import { FhirValidationService } from './validation/fhir-validation.service';

/**
 * NestJS module that bundles all FHIR functionality: the generic REST controller,
 * resource persistence service, and FHIR validation pipeline.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: FhirResource.name, schema: FhirResourceSchema }, { name: FhirResourceHistory.name, schema: FhirResourceHistorySchema }])],
  controllers: [BulkExportController, BgzController, FhirController],
  providers: [FhirService, FhirValidationService, FhirValidationPipe, SearchParameterRegistry, QueryBuilderService, IncludeService, ChainingService, BundleProcessorService, SubscriptionService, SubscriptionNotificationService, BulkExportService, BgzService],
})
export class FhirModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BundleMiddleware).forRoutes({ path: 'fhir', method: RequestMethod.POST });
  }
}
