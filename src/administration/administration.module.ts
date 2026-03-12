import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { ConformanceResource, ConformanceResourceSchema } from './conformance-resource.schema';
import { ConformanceSeederService } from './seeding/conformance-seeder.service';
import { TerminologyController } from './terminology/terminology.controller';
import { TerminologyService } from './terminology/terminology.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: ConformanceResource.name, schema: ConformanceResourceSchema }])],
  controllers: [TerminologyController, AdministrationController],
  providers: [AdministrationService, ConformanceSeederService, TerminologyService],
  exports: [AdministrationService],
})
export class AdministrationModule {}