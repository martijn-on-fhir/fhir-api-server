import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { FhirExceptionFilter } from './fhir/filters/fhir-exception.filter';

/** Bootstraps the NestJS application with FHIR-specific middleware and global filters. */
const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
  app.useGlobalFilters(new FhirExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FHIR R4 API Server')
    .setDescription('FHIR R4 REST API met nl-core profiel ondersteuning en validatie via fhir-validator-mx')
    .setVersion('0.0.1')
    .addServer('http://localhost:3000', 'Local development')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
};

bootstrap();
