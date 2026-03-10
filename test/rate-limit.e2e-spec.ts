import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { FhirThrottlerGuard } from '../src/fhir/guards/fhir-throttler.guard';

describe('Rate Limiting (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        ThrottlerModule.forRoot([{ name: 'test', ttl: 60_000, limit: 5 }]),
        MongooseModule.forRoot(mongod.getUri()),
        FhirModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: FhirThrottlerGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('should return 429 with OperationOutcome after exceeding rate limit', async () => {
    // Send requests up to the limit (5)
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/fhir/Patient').expect(200);
    }

    // 6th request should be rate limited
    const res = await request(app.getHttpServer()).get('/fhir/Patient').expect(429);

    expect(res.body.resourceType).toBe('OperationOutcome');
    expect(res.body.issue[0].severity).toBe('error');
    expect(res.body.issue[0].code).toBe('throttled');
    expect(res.headers['content-type']).toContain('application/fhir+json');
  });
});
