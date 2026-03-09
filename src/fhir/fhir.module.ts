import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FhirResource, FhirResourceSchema } from './fhir-resource.schema';
import { FhirController } from './fhir.controller';
import { FhirService } from './fhir.service';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';
import { FhirValidationService } from './validation/fhir-validation.service';

/**
 * NestJS module that bundles all FHIR functionality: the generic REST controller,
 * resource persistence service, and FHIR validation pipeline.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: FhirResource.name, schema: FhirResourceSchema }])],
  controllers: [FhirController],
  providers: [FhirService, FhirValidationService, FhirValidationPipe],
})
export class FhirModule {}
