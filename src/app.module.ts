import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FhirModule } from './fhir/fhir.module';

/** Root application module. Configures MongoDB connection and imports the FHIR module. */
@Module({
  imports: [MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/fhir'), FhirModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
