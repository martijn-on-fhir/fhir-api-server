import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('Transaction Rollback (e2e)', () => {
  let app: INestApplication;
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await seedSearchParameters(replSet.getUri());

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(replSet.getUri()), FhirModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
    await replSet.stop();
  });

  it('should use a real MongoDB transaction (not fallback)', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        { fullUrl: 'urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', resource: { resourceType: 'Patient', name: [{ family: 'TxTest' }] }, request: { method: 'POST', url: 'Patient' } },
        { resource: { resourceType: 'Observation', status: 'final', code: { text: 'test' }, subject: { reference: 'urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } }, request: { method: 'POST', url: 'Observation' } },
      ],
    };

    const res = await request(app.getHttpServer()).post('/fhir').send(bundle).expect(200);
    expect(res.body.type).toBe('transaction-response');
    expect(res.body.entry).toHaveLength(2);
    expect(res.body.entry[0].response.status).toBe('201 Created');
    expect(res.body.entry[1].resource.subject.reference).toMatch(/^Patient\//);
  });

  it('should rollback all entries when one fails in a transaction', async () => {
    // Count patients before
    const beforeRes = await request(app.getHttpServer()).get('/fhir/Patient?name=RollbackTest&_summary=count').expect(200);
    const countBefore = beforeRes.body.total;

    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        { resource: { resourceType: 'Patient', name: [{ family: 'RollbackTest' }] }, request: { method: 'POST', url: 'Patient' } },
        // This PUT references a non-existent resource, causing a 404 → transaction should rollback
        { resource: { resourceType: 'Patient', name: [{ family: 'RollbackTest2' }] }, request: { method: 'PUT', url: 'Patient/nonexistent-rollback-id-12345' } },
      ],
    };

    // Transaction should fail
    const res = await request(app.getHttpServer()).post('/fhir').send(bundle);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Verify rollback: no new patients should have been created
    const afterRes = await request(app.getHttpServer()).get('/fhir/Patient?name=RollbackTest&_summary=count').expect(200);
    expect(afterRes.body.total).toBe(countBefore);
  });

  it('should not rollback batch entries when one fails', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'batch',
      entry: [
        { resource: { resourceType: 'Patient', name: [{ family: 'BatchNoRollback' }] }, request: { method: 'POST', url: 'Patient' } },
        { request: { method: 'GET', url: 'Patient/nonexistent-batch-id-99999' } },
      ],
    };

    const res = await request(app.getHttpServer()).post('/fhir').send(bundle).expect(200);
    expect(res.body.type).toBe('batch-response');
    // First entry succeeded despite second failing
    expect(res.body.entry[0].response.status).toBe('201 Created');
    expect(res.body.entry[1].response.status).toBe('404');

    // Verify the patient was actually persisted
    const patientId = res.body.entry[0].resource.id;
    await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}`).expect(200);
  });
});
