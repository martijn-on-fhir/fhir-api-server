import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('$everything (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let patientId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();

    // Seed: create a Patient
    const patientRes = await request(app.getHttpServer())
      .post('/fhir/Patient')
      .send({ resourceType: 'Patient', name: [{ family: 'Everything', given: ['Test'] }] })
      .expect(201);
    patientId = patientRes.body.id;

    // Create linked Observation
    await request(app.getHttpServer())
      .post('/fhir/Observation')
      .send({ resourceType: 'Observation', status: 'final', subject: { reference: `Patient/${patientId}` }, code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }] } })
      .expect(201);

    // Create linked Condition
    await request(app.getHttpServer())
      .post('/fhir/Condition')
      .send({ resourceType: 'Condition', subject: { reference: `Patient/${patientId}` }, code: { coding: [{ system: 'http://snomed.info/sct', code: '73211009' }] } })
      .expect(201);

    // Create linked Encounter
    await request(app.getHttpServer())
      .post('/fhir/Encounter')
      .send({ resourceType: 'Encounter', status: 'finished', class: { code: 'AMB' }, subject: { reference: `Patient/${patientId}` } })
      .expect(201);

    // Create unrelated Observation (different patient)
    await request(app.getHttpServer())
      .post('/fhir/Observation')
      .send({ resourceType: 'Observation', status: 'final', subject: { reference: 'Patient/other-id' }, code: { coding: [{ system: 'http://loinc.org', code: '0000-0' }] } })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('should return the patient and all linked resources', async () => {
    const res = await request(app.getHttpServer())
      .get(`/fhir/Patient/${patientId}/$everything`)
      .expect(200);

    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.type).toBe('searchset');
    // Patient + Observation + Condition + Encounter = 4
    expect(res.body.total).toBe(4);

    const types = res.body.entry.map((e: any) => e.resource.resourceType).sort();
    expect(types).toEqual(['Condition', 'Encounter', 'Observation', 'Patient']);
  });

  it('should not include unrelated resources', async () => {
    const res = await request(app.getHttpServer())
      .get(`/fhir/Patient/${patientId}/$everything`)
      .expect(200);

    // Should not include the Observation referencing 'Patient/other-id'
    const observations = res.body.entry.filter((e: any) => e.resource.resourceType === 'Observation');
    expect(observations.length).toBe(1);
    expect(observations[0].resource.subject.reference).toContain(patientId);
  });

  it('should support _type filter', async () => {
    const res = await request(app.getHttpServer())
      .get(`/fhir/Patient/${patientId}/$everything?_type=Observation,Condition`)
      .expect(200);

    // Patient + only Observation and Condition = 3
    expect(res.body.total).toBe(3);

    const types = res.body.entry.map((e: any) => e.resource.resourceType).sort();
    expect(types).toEqual(['Condition', 'Observation', 'Patient']);
  });

  it('should return 404 for non-existent patient', async () => {
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient/nonexistent/$everything')
      .expect(404);

    expect(res.body.resourceType).toBe('OperationOutcome');
  });

  it('should include self link', async () => {
    const res = await request(app.getHttpServer())
      .get(`/fhir/Patient/${patientId}/$everything`)
      .expect(200);

    expect(res.body.link[0].relation).toBe('self');
    expect(res.body.link[0].url).toContain('$everything');
  });
});
