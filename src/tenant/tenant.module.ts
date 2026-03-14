import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TenantConnectionService } from './tenant-connection.service';
import { TenantController } from './tenant.controller';
import { Tenant, TenantSchema } from './tenant.schema';
import { TenantService } from './tenant.service';

/**
 * Multi-tenancy module. Only imported when MULTI_TENANT_ENABLED=true.
 * Provides tenant CRUD, connection management and the admin API.
 * Exports TenantService and TenantConnectionService for use by FhirModule.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tenant.name, schema: TenantSchema }]),
  ],
  controllers: [TenantController],
  providers: [TenantService, TenantConnectionService],
  exports: [TenantService, TenantConnectionService],
})
export class TenantModule {}
