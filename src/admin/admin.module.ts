import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FhirResourceHistory, FhirResourceHistorySchema } from '../fhir/fhir-resource-history.schema';
import { FhirResource, FhirResourceSchema } from '../fhir/fhir-resource.schema';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** Module for administrative database operations: snapshot export and restore. */
@Module({
  imports: [MongooseModule.forFeature([{ name: FhirResource.name, schema: FhirResourceSchema }, { name: FhirResourceHistory.name, schema: FhirResourceHistorySchema }])],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
