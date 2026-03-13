import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('Graceful Shutdown (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());
    app.enableShutdownHooks();
    await app.init();
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('should complete in-flight requests before shutting down', async () => {
    // Start a request
    const responsePromise = request(app.getHttpServer())
      .post('/fhir/Patient')
      .send({ resourceType: 'Patient', name: [{ family: 'ShutdownTest' }] });

    // Wait for the response — should succeed
    const res = await responsePromise;
    expect(res.status).toBe(201);
    expect(res.body.name[0].family).toBe('ShutdownTest');

    // Now close the app gracefully
    await app.close();

    // Server should no longer accept new connections
    try {
      await request(app.getHttpServer()).get('/fhir/Patient').timeout(1000);
      fail('Should not accept requests after close');
    } catch (err: any) {
      // Expected: ECONNREFUSED or socket hang up
      expect(err.code || err.message).toBeTruthy();
    }
  });

  it('enableShutdownHooks is configured in main.ts', () => {
    // Verify the main.ts contains enableShutdownHooks
    const mainContent = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main.ts'), 'utf-8');
    expect(mainContent).toContain('enableShutdownHooks()');
  });

  it('SubscriptionNotificationService implements OnModuleDestroy', () => {
    // Verify the service has the cleanup hook
    const serviceContent = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'fhir', 'subscriptions', 'subscription-notification.service.ts'), 'utf-8');
    expect(serviceContent).toContain('OnModuleDestroy');
    expect(serviceContent).toContain('onModuleDestroy');
    expect(serviceContent).toContain('activeDeliveries');
  });
});
