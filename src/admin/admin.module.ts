import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { FhirResourceHistory, FhirResourceHistorySchema } from '../fhir/fhir-resource-history.schema';
import { FhirResource, FhirResourceSchema } from '../fhir/fhir-resource.schema';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BackupService } from './backup.service';
import { DangerousOperationGuard } from './guards/dangerous-operation.guard';
import { SERVER_CONFIG, loadServerConfig } from './server-config';

/** Module for administrative database operations and dangerous operation guards. */
@Module({
  imports: [MongooseModule.forFeature([{ name: FhirResource.name, schema: FhirResourceSchema }, { name: FhirResourceHistory.name, schema: FhirResourceHistorySchema }])],
  controllers: [AdminController],
  providers: [AdminService, BackupService, { provide: SERVER_CONFIG, useFactory: loadServerConfig }, { provide: APP_GUARD, useClass: DangerousOperationGuard }],
  exports: [SERVER_CONFIG],
})
export class AdminModule {}
