import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FhirResource, FhirResourceSchema } from './fhir-resource.schema';
import { FhirController } from './fhir.controller';
import { FhirService } from './fhir.service';
import { ChainingService } from './search/chaining.service';
import { IncludeService } from './search/include.service';
import { QueryBuilderService } from './search/query-builder.service';
import { SearchParameterRegistry } from './search/search-parameter-registry.service';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';
import { FhirValidationService } from './validation/fhir-validation.service';

/**
 * NestJS module that bundles all FHIR functionality: the generic REST controller,
 * resource persistence service, and FHIR validation pipeline.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: FhirResource.name, schema: FhirResourceSchema }])],
  controllers: [FhirController],
  providers: [FhirService, FhirValidationService, FhirValidationPipe, SearchParameterRegistry, QueryBuilderService, IncludeService, ChainingService],
})
export class FhirModule {}
