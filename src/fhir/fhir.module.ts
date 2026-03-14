import { MiddlewareConsumer, Module, NestModule, RequestMethod, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model } from 'mongoose';
import { CacheModule } from '../cache/cache.module';
import { config } from '../config/app-config';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { TenantConnectionService } from '../tenant/tenant-connection.service';
import { TenantModule } from '../tenant/tenant.module';
import { AuditEventService } from './audit/audit-event.service';
import { BgzController } from './bgz/bgz.controller';
import { BgzService } from './bgz/bgz.service';
import { BulkExportController } from './bulk-export/bulk-export.controller';
import { BulkExportService } from './bulk-export/bulk-export.service';
import { BundleProcessorService } from './bundle-processor.service';
import { BundleMiddleware } from './bundle.middleware';
import { ConsentEnforcementService } from './consent/consent-enforcement.service';
import { FhirResourceHistory, FhirResourceHistorySchema } from './fhir-resource-history.schema';
import { FhirResource, FhirResourceSchema } from './fhir-resource.schema';
import { FHIR_RESOURCE_MODEL, FHIR_HISTORY_MODEL } from './fhir.constants';
import { FhirController } from './fhir.controller';
import { FhirService } from './fhir.service';
import { ChainingService } from './search/chaining.service';
import { IncludeService } from './search/include.service';
import { QueryBuilderService } from './search/query-builder.service';
import { SearchParameterRegistry } from './search/search-parameter-registry.service';
import { SmartModule } from './smart/smart.module';
import { SubscriptionNotificationService } from './subscriptions/subscription-notification.service';
import { SubscriptionService } from './subscriptions/subscription.service';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';
import { FhirValidationService } from './validation/fhir-validation.service';


/** Whether multi-tenancy is enabled via centralized config. */
const MULTI_TENANT_ENABLED = config.tenant.enabled;

/**
 * Build the model providers based on multi-tenancy mode.
 * Single-tenant: singleton providers that forward the default Mongoose models.
 * Multi-tenant: REQUEST-scoped providers that resolve to the correct tenant database.
 */
function buildModelProviders() {
  if (!MULTI_TENANT_ENABLED) {
    // Single-tenant: simple forwarding, no REQUEST scope, zero overhead
    return [
      {
        provide: FHIR_RESOURCE_MODEL,
        useFactory: (model: Model<FhirResource>) => model,
        inject: [getModelToken(FhirResource.name)],
      },
      {
        provide: FHIR_HISTORY_MODEL,
        useFactory: (model: Model<FhirResourceHistory>) => model,
        inject: [getModelToken(FhirResourceHistory.name)],
      },
    ];
  }

  // Multi-tenant: REQUEST-scoped, resolves tenant connection when tenantId is present
  return [
    {
      provide: FHIR_RESOURCE_MODEL,
      scope: Scope.REQUEST,
      useFactory: async (req: Request, defaultModel: Model<FhirResource>, connectionService: TenantConnectionService) => {
        const tenantId = req?.['tenantId'];

        if (!tenantId) {
          return defaultModel;
        }

        const { resourceModel } = await connectionService.getModels(tenantId);

        return resourceModel;
      },
      inject: [REQUEST, getModelToken(FhirResource.name), TenantConnectionService],
    },
    {
      provide: FHIR_HISTORY_MODEL,
      scope: Scope.REQUEST,
      useFactory: async (req: Request, defaultModel: Model<FhirResourceHistory>, connectionService: TenantConnectionService) => {
        const tenantId = req?.['tenantId'];

        if (!tenantId) {
          return defaultModel;
        }

        const { historyModel } = await connectionService.getModels(tenantId);

        return historyModel;
      },
      inject: [REQUEST, getModelToken(FhirResourceHistory.name), TenantConnectionService],
    },
  ];
}

/** Additional module imports needed when multi-tenancy is enabled. */
const tenantImports = MULTI_TENANT_ENABLED ? [TenantModule] : [];

/**
 * NestJS module that bundles all FHIR functionality: the generic REST controller,
 * resource persistence service, and FHIR validation pipeline.
 */
@Module({
  imports: [CacheModule, JobQueueModule, MongooseModule.forFeature([{ name: FhirResource.name, schema: FhirResourceSchema }, { name: FhirResourceHistory.name, schema: FhirResourceHistorySchema }]), SmartModule, ...tenantImports],
  controllers: [BulkExportController, BgzController, FhirController],
  providers: [FhirService, FhirValidationService, FhirValidationPipe, SearchParameterRegistry, QueryBuilderService, IncludeService, ChainingService,
    BundleProcessorService, SubscriptionService, SubscriptionNotificationService, BulkExportService, BgzService, AuditEventService, ConsentEnforcementService,
    ...buildModelProviders()],
})
export class FhirModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BundleMiddleware).forRoutes({ path: 'fhir', method: RequestMethod.POST });
  }
}
