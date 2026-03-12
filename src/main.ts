import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { FhirExceptionFilter } from './fhir/filters/fhir-exception.filter';
import { JsonLoggerService } from './logging/json-logger.service';

/** Bootstraps the NestJS application with FHIR-specific middleware and global filters. */
const bootstrap = async () => {

  const useJsonLogger = process.env.LOG_FORMAT === 'json';
  const app = await NestFactory.create(AppModule, useJsonLogger ? { logger: new JsonLoggerService() } : {});

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'If-Match', 'If-None-Exist', 'If-None-Match', 'If-Modified-Since', 'Prefer', 'X-Forwarded-Proto', 'X-Forwarded-Host'],
    exposedHeaders: ['Content-Location', 'ETag', 'Last-Modified', 'Location'],
    credentials: true,
  });

  app.use(express.json({ type: ['application/json', 'application/fhir+json', 'application/json-patch+json'] }));
  app.use(express.text({ type: ['application/fhir+xml', 'application/xml'] }));
  app.use(express.raw({ type: ['application/octet-stream'], limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.useGlobalFilters(new FhirExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FHIR R4 API Server')
    .setDescription('FHIR R4 REST API met nl-core profiel ondersteuning en validatie via fhir-validator-mx')
    .setVersion('0.0.1')
    .addServer('http://localhost:3000', 'Local development')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
};

bootstrap();
