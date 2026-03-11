import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('BgZ $bgz (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let patientId: string;
  let practitionerId: string;
  let organizationId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();

    // --- Seed BgZ data ---

    // Organization (zib 21: Zorgaanbieder)
    const orgRes = await request(app.getHttpServer()).post('/fhir/Organization').send({ resourceType: 'Organization', name: 'Ziekenhuis BgZ Test' }).expect(201);
    organizationId = orgRes.body.id;

    // Practitioner (zib 20: Zorgverlener)
    const practRes = await request(app.getHttpServer()).post('/fhir/Practitioner').send({ resourceType: 'Practitioner', name: [{ family: 'Arts', given: ['Jan'] }] }).expect(201);
    practitionerId = practRes.body.id;

    // Patient (zib 1)
    const patientRes = await request(app.getHttpServer()).post('/fhir/Patient').send({
      resourceType: 'Patient', name: [{ family: 'BgZ', given: ['Test'] }],
      identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '123456789' }],
      generalPractitioner: [{ reference: `Practitioner/${practitionerId}` }],
      managingOrganization: { reference: `Organization/${organizationId}` },
    }).expect(201);
    patientId = patientRes.body.id;

    // Condition (zib 6: Probleem)
    await request(app.getHttpServer()).post('/fhir/Condition').send({
      resourceType: 'Condition', subject: { reference: `Patient/${patientId}` },
      code: { coding: [{ system: 'http://snomed.info/sct', code: '73211009', display: 'Diabetes mellitus' }] },
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
    }).expect(201);

    // AllergyIntolerance (zib 7)
    await request(app.getHttpServer()).post('/fhir/AllergyIntolerance').send({
      resourceType: 'AllergyIntolerance', patient: { reference: `Patient/${patientId}` },
      code: { coding: [{ system: 'http://snomed.info/sct', code: '373270004', display: 'Penicillin' }] },
    }).expect(201);

    // Observation — BloodPressure (zib 12)
    await request(app.getHttpServer()).post('/fhir/Observation').send({
      resourceType: 'Observation', status: 'final', subject: { reference: `Patient/${patientId}` },
      code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure' }] },
    }).expect(201);

    // Observation — BodyWeight (zib 13)
    await request(app.getHttpServer()).post('/fhir/Observation').send({
      resourceType: 'Observation', status: 'final', subject: { reference: `Patient/${patientId}` },
      code: { coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }] },
      valueQuantity: { value: 80, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
    }).expect(201);

    // Immunization (zib 11: Vaccinatie)
    await request(app.getHttpServer()).post('/fhir/Immunization').send({
      resourceType: 'Immunization', status: 'completed', patient: { reference: `Patient/${patientId}` },
      vaccineCode: { coding: [{ system: 'http://snomed.info/sct', code: '871875004' }] },
      occurrenceDateTime: '2024-01-15',
    }).expect(201);

    // Encounter (zib 17: Contact)
    await request(app.getHttpServer()).post('/fhir/Encounter').send({
      resourceType: 'Encounter', status: 'finished', class: { code: 'AMB' },
      subject: { reference: `Patient/${patientId}` },
      participant: [{ individual: { reference: `Practitioner/${practitionerId}` } }],
      serviceProvider: { reference: `Organization/${organizationId}` },
    }).expect(201);

    // Coverage (zib 19: Betaler)
    await request(app.getHttpServer()).post('/fhir/Coverage').send({
      resourceType: 'Coverage', status: 'active', beneficiary: { reference: `Patient/${patientId}` },
      payor: [{ reference: `Organization/${organizationId}` }],
    }).expect(201);

    // Procedure (zib 16: Verrichting)
    await request(app.getHttpServer()).post('/fhir/Procedure').send({
      resourceType: 'Procedure', status: 'completed', subject: { reference: `Patient/${patientId}` },
      code: { coding: [{ system: 'http://snomed.info/sct', code: '80146002', display: 'Appendectomy' }] },
    }).expect(201);

    // Flag (zib 8: Waarschuwing)
    await request(app.getHttpServer()).post('/fhir/Flag').send({
      resourceType: 'Flag', status: 'active', subject: { reference: `Patient/${patientId}` },
      code: { text: 'Valrisico' },
    }).expect(201);

    // Unrelated patient resources (should NOT appear in BgZ)
    const otherPatient = await request(app.getHttpServer()).post('/fhir/Patient').send({ resourceType: 'Patient', name: [{ family: 'Anders' }] }).expect(201);
    await request(app.getHttpServer()).post('/fhir/Condition').send({
      resourceType: 'Condition', subject: { reference: `Patient/${otherPatient.body.id}` },
      code: { coding: [{ system: 'http://snomed.info/sct', code: '00000' }] },
    }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('should return a Bundle of type searchset', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.type).toBe('searchset');
  });

  it('should include the Patient resource', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    const patient = res.body.entry.find((e: any) => e.resource.resourceType === 'Patient' && e.resource.id === patientId);
    expect(patient).toBeDefined();
    expect(patient.search.mode).toBe('match');
  });

  it('should include all direct BgZ resources as match', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    const matchTypes = res.body.entry.filter((e: any) => e.search.mode === 'match').map((e: any) => e.resource.resourceType).sort();
    // Patient + Condition + AllergyIntolerance + 2x Observation + Immunization + Encounter + Coverage + Procedure + Flag = 10
    expect(matchTypes).toContain('Patient');
    expect(matchTypes).toContain('Condition');
    expect(matchTypes).toContain('AllergyIntolerance');
    expect(matchTypes).toContain('Observation');
    expect(matchTypes).toContain('Immunization');
    expect(matchTypes).toContain('Encounter');
    expect(matchTypes).toContain('Coverage');
    expect(matchTypes).toContain('Procedure');
    expect(matchTypes).toContain('Flag');
    expect(matchTypes.filter((t: string) => t === 'Observation').length).toBe(2); // BP + Weight
  });

  it('should include referenced Practitioner and Organization as include', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    const includeEntries = res.body.entry.filter((e: any) => e.search.mode === 'include');
    const includeTypes = includeEntries.map((e: any) => e.resource.resourceType).sort();
    expect(includeTypes).toContain('Practitioner');
    expect(includeTypes).toContain('Organization');
  });

  it('should NOT include unrelated patient resources', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    // Only 1 Condition (ours), not the other patient's
    const conditions = res.body.entry.filter((e: any) => e.resource.resourceType === 'Condition');
    expect(conditions.length).toBe(1);
    expect(conditions[0].resource.subject.reference).toContain(patientId);
  });

  it('should return 404 for non-existent patient', async () => {
    const res = await request(app.getHttpServer()).get('/fhir/Patient/nonexistent/$bgz').expect(404);
    expect(res.body.resourceType).toBe('OperationOutcome');
  });

  it('should include self link', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    expect(res.body.link[0].relation).toBe('self');
    expect(res.body.link[0].url).toContain('$bgz');
  });

  it('should have correct total count', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    expect(res.body.total).toBe(res.body.entry.length);
    // 10 match + 2 include (Practitioner + Organization) = 12
    expect(res.body.total).toBe(12);
  });

  it('should return application/fhir+json content-type', async () => {
    const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}/$bgz`).expect(200);
    expect(res.headers['content-type']).toContain('application/fhir+json');
  });
});
