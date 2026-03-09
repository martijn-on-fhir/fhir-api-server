import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { AppModule } from './app.module';
import { FhirExceptionFilter } from './fhir/filters/fhir-exception.filter';

/** Bootstraps the NestJS application with FHIR-specific middleware and global filters. */
const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
  app.useGlobalFilters(new FhirExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
};

bootstrap();
