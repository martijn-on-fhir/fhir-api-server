import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { ConformanceResource, ConformanceResourceSchema } from './conformance-resource.schema';
import { ConformanceSeederService } from './seeding/conformance-seeder.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: ConformanceResource.name, schema: ConformanceResourceSchema }])],
  controllers: [AdministrationController],
  providers: [AdministrationService, ConformanceSeederService],
  exports: [AdministrationService],
})
export class AdministrationModule {}