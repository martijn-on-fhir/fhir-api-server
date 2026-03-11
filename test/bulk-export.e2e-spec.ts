import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { seedSearchParameters } from './helpers/seed-search-params';

/** Helper to wait for async export job completion. */
const pollUntilComplete = async (server: any, pollUrl: string, maxAttempts = 20): Promise<request.Response> => {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await request(server).get(pollUrl);
    if (res.status === 200) return res;
    if (res.status !== 202) throw new Error(`Unexpected poll status: ${res.status} — ${JSON.stringify(res.body)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Export did not complete in time');
};

describe('Bulk Data Export $export (e2e)', () => {
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
    await app.init();

    // Seed data: 2 Patients, 1 Observation
    await request(app.getHttpServer()).post('/fhir/Patient').send({ resourceType: 'Patient', name: [{ family: 'Export', given: ['Alice'] }] }).expect(201);
    await request(app.getHttpServer()).post('/fhir/Patient').send({ resourceType: 'Patient', name: [{ family: 'Export', given: ['Bob'] }] }).expect(201);
    await request(app.getHttpServer()).post('/fhir/Observation').send({ resourceType: 'Observation', status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }] } }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('should kick off a system-level export and return 202 with Content-Location', async () => {
    const res = await request(app.getHttpServer()).get('/fhir/$export').expect(202);
    expect(res.headers['content-location']).toContain('$export-poll-status');
    expect(res.body.jobId).toBeDefined();
  });

  it('should complete export and return NDJSON manifest', async () => {
    const kickoff = await request(app.getHttpServer()).get('/fhir/$export').expect(202);
    const pollUrl = new URL(kickoff.headers['content-location']);
    const statusRes = await pollUntilComplete(app.getHttpServer(), pollUrl.pathname + pollUrl.search);

    expect(statusRes.body.transactionTime).toBeDefined();
    expect(statusRes.body.output).toBeInstanceOf(Array);
    expect(statusRes.body.output.length).toBeGreaterThanOrEqual(2); // Patient + Observation

    const patientOutput = statusRes.body.output.find((o: any) => o.type === 'Patient');
    expect(patientOutput).toBeDefined();
    expect(patientOutput.count).toBe(2);
  });

  it('should download NDJSON for a resource type', async () => {
    const kickoff = await request(app.getHttpServer()).get('/fhir/$export').expect(202);
    const pollUrl = new URL(kickoff.headers['content-location']);
    const statusRes = await pollUntilComplete(app.getHttpServer(), pollUrl.pathname + pollUrl.search);

    const patientOutput = statusRes.body.output.find((o: any) => o.type === 'Patient');
    const downloadUrl = new URL(patientOutput.url);
    const ndjsonRes = await request(app.getHttpServer()).get(downloadUrl.pathname + downloadUrl.search).expect(200);

    expect(ndjsonRes.headers['content-type']).toContain('application/fhir+ndjson');
    const lines = ndjsonRes.text.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    lines.forEach((line: string) => {
      const parsed = JSON.parse(line);
      expect(parsed.resourceType).toBe('Patient');
    });
  });

  it('should filter by _type parameter', async () => {
    const kickoff = await request(app.getHttpServer()).get('/fhir/$export?_type=Observation').expect(202);
    const pollUrl = new URL(kickoff.headers['content-location']);
    const statusRes = await pollUntilComplete(app.getHttpServer(), pollUrl.pathname + pollUrl.search);

    // Only Observation type in output
    const types = statusRes.body.output.map((o: any) => o.type);
    expect(types).toEqual(['Observation']);
    expect(statusRes.body.output[0].count).toBe(1);
  });

  it('should cancel an export job', async () => {
    const kickoff = await request(app.getHttpServer()).get('/fhir/$export').expect(202);
    const pollUrl = new URL(kickoff.headers['content-location']);

    // Cancel
    await request(app.getHttpServer()).delete(pollUrl.pathname + pollUrl.search).expect(202);

    // Polling cancelled job returns 404
    const statusRes = await request(app.getHttpServer()).get(pollUrl.pathname + pollUrl.search);
    // Could be 404 (cancelled) or 200 (already completed before cancel)
    expect([200, 404]).toContain(statusRes.status);
  });

  it('should return 404 for non-existent job', async () => {
    await request(app.getHttpServer()).get('/fhir/$export-poll-status?_jobId=nonexistent').expect(404);
  });

  it('should support group-level export', async () => {
    // Create a Group with member references
    const patients = await request(app.getHttpServer()).get('/fhir/Patient?name=Alice').expect(200);
    const aliceId = patients.body.entry[0].resource.id;

    await request(app.getHttpServer()).post('/fhir/Group').send({
      resourceType: 'Group', type: 'person', actual: true,
      member: [{ entity: { reference: `Patient/${aliceId}` } }],
    }).expect(201);

    const groups = await request(app.getHttpServer()).get('/fhir/Group').expect(200);
    const groupId = groups.body.entry[0].resource.id;

    const kickoff = await request(app.getHttpServer()).get(`/fhir/Group/${groupId}/$export?_type=Patient`).expect(202);
    const pollUrl = new URL(kickoff.headers['content-location']);
    const statusRes = await pollUntilComplete(app.getHttpServer(), pollUrl.pathname + pollUrl.search);

    const patientOutput = statusRes.body.output.find((o: any) => o.type === 'Patient');
    expect(patientOutput).toBeDefined();
    expect(patientOutput.count).toBe(1); // Only Alice, not Bob
  });
});
