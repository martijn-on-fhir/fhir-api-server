import {readFileSync} from 'fs';
import {join} from 'path';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {DocumentBuilder, SwaggerModule} from '@nestjs/swagger';
import * as express from 'express';
import helmet from 'helmet';
import {AppModule} from './app.module';
import {config} from './config/app-config';
import {FhirExceptionFilter} from './fhir/filters/fhir-exception.filter';
import {TimeoutInterceptor} from './fhir/interceptors/timeout.interceptor';
import {JsonLoggerService} from './logging/json-logger.service';
import {MetricsInterceptor} from './metrics/metrics.interceptor';
import {initTelemetry} from './telemetry/telemetry';
import {TenantMiddleware} from './tenant/tenant.middleware';

// Initialize OpenTelemetry before NestJS bootstrap (required for auto-instrumentation)
const otelSdk = initTelemetry();

const {version} = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

/** Bootstraps the NestJS application with FHIR-specific middleware and global filters. */
const bootstrap = async () => {

  const useJsonLogger = config.logFormat === 'json';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, useJsonLogger ? {logger: new JsonLoggerService()} : {});

  // Express v5 uses 'simple' query parser by default — use 'extended' for nested object/array support (e.g. ?filter[name]=John)
  app.set('query parser', 'extended');

  app.use(helmet({
    contentSecurityPolicy: {directives: {defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"]}},
    hsts: {maxAge: 31536000, includeSubDomains: true, preload: true},
  }));

  app.enableCors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'If-Match', 'If-None-Exist', 'If-None-Match', 'If-Modified-Since',
      'Prefer', 'X-Forwarded-Proto', 'X-Forwarded-Host', 'Tenant'],
    exposedHeaders: ['Content-Location', 'ETag', 'Last-Modified', 'Location', 'X-Correlation-ID', 'X-Trace-ID'],
    credentials: true,
  });

  const jsonLimit = config.bodySizeLimit;
  app.use(express.json({type: ['application/json', 'application/fhir+json', 'application/json-patch+json'], limit: jsonLimit}));
  app.use(express.text({type: ['application/fhir+xml', 'application/xml'], limit: jsonLimit}));
  app.use(express.raw({type: ['application/octet-stream'], limit: '50mb'}));
  app.use(express.urlencoded({extended: true, limit: jsonLimit}));

  // Tenant URL rewriting must run before NestJS route matching
  if (config.tenant.enabled) {
    const tenantMiddleware = new TenantMiddleware();
    app.use(tenantMiddleware.use.bind(tenantMiddleware));
  }

  app.useGlobalFilters(new FhirExceptionFilter());
  app.useGlobalInterceptors(app.get(MetricsInterceptor), new TimeoutInterceptor());

  if(config.server.openapi.enabled){

    const swaggerConfig = new DocumentBuilder()
    .setTitle('FHIR R4 API Server')
    .setDescription('FHIR R4 REST API met nl-core profiel ondersteuning en validatie via fhir-validator-mx')
    .setVersion(version || '0.0.0')
    .addServer(config.server.openapi.serverUrl || `http://localhost:${config.port}`, 'Local development')
    .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, document);
  }


  app.enableShutdownHooks();

  await app.listen(config.port);
}

bootstrap();

// Graceful OpenTelemetry shutdown
process.on('SIGTERM', async () => {
  if (otelSdk) {
    await otelSdk.shutdown();
  }
});

process.on('SIGINT', async () => {
  if (otelSdk) {
    await otelSdk.shutdown();
  }
});
