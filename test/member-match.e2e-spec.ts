import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('$member-match (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const express = require('express');
    app.use(express.json({ type: ['application/json', 'application/fhir+json'], limit: '5mb' }));
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();

    // Seed test patients
    await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json')
      .send({ resourceType: 'Patient', identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '123456789' }], name: [{ family: 'Jansen', given: ['Jan'] }], birthDate: '1980-01-15', gender: 'male' });

    await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json')
      .send({ resourceType: 'Patient', identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '987654321' }], name: [{ family: 'De Vries', given: ['Maria'] }], birthDate: '1992-06-20', gender: 'female' });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('should match a patient by BSN identifier', async () => {
    const res = await request(app.getHttpServer())
      .post('/fhir/Patient/$member-match')
      .set('Content-Type', 'application/fhir+json')
      .send({
        resourceType: 'Parameters',
        parameter: [
          { name: 'MemberPatient', resource: { resourceType: 'Patient', identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '123456789' }] } },
          { name: 'OldCoverage', resource: { resourceType: 'Coverage', status: 'active' } },
          { name: 'NewCoverage', resource: { resourceType: 'Coverage', status: 'active' } },
        ],
      })
      .expect(200);

    expect(res.body.resourceType).toBe('Parameters');
    expect(res.body.parameter[0].name).toBe('MemberIdentifier');
    expect(res.body.parameter[0].valueIdentifier.value).toBe('123456789');
  });

  it('should match by name + birthDate + gender', async () => {
    const res = await request(app.getHttpServer())
      .post('/fhir/Patient/$member-match')
      .set('Content-Type', 'application/fhir+json')
      .send({
        resourceType: 'Parameters',
        parameter: [
          { name: 'MemberPatient', resource: { resourceType: 'Patient', name: [{ family: 'De Vries', given: ['Maria'] }], birthDate: '1992-06-20', gender: 'female' } },
          { name: 'NewCoverage', resource: { resourceType: 'Coverage', status: 'active' } },
        ],
      })
      .expect(200);

    expect(res.body.resourceType).toBe('Parameters');
    expect(res.body.parameter[0].name).toBe('MemberIdentifier');
    expect(res.body.parameter[0].valueIdentifier.value).toBe('987654321');
  });

  it('should return 422 when no match found', async () => {
    const res = await request(app.getHttpServer())
      .post('/fhir/Patient/$member-match')
      .set('Content-Type', 'application/fhir+json')
      .send({
        resourceType: 'Parameters',
        parameter: [
          { name: 'MemberPatient', resource: { resourceType: 'Patient', identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '000000000' }] } },
          { name: 'OldCoverage', resource: { resourceType: 'Coverage', status: 'active' } },
        ],
      })
      .expect(422);

    expect(res.body.resourceType).toBe('OperationOutcome');
    expect(res.body.issue[0].diagnostics).toContain('No matching Patient');
  });

  it('should return 400 when MemberPatient is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/fhir/Patient/$member-match')
      .set('Content-Type', 'application/fhir+json')
      .send({
        resourceType: 'Parameters',
        parameter: [
          { name: 'OldCoverage', resource: { resourceType: 'Coverage', status: 'active' } },
        ],
      })
      .expect(400);

    expect(res.body.resourceType).toBe('OperationOutcome');
    expect(res.body.issue[0].diagnostics).toContain('MemberPatient');
  });

  it('should return 400 when no coverage provided', async () => {
    const res = await request(app.getHttpServer())
      .post('/fhir/Patient/$member-match')
      .set('Content-Type', 'application/fhir+json')
      .send({
        resourceType: 'Parameters',
        parameter: [
          { name: 'MemberPatient', resource: { resourceType: 'Patient', identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '123456789' }] } },
        ],
      })
      .expect(400);

    expect(res.body.resourceType).toBe('OperationOutcome');
    expect(res.body.issue[0].diagnostics).toContain('Coverage');
  });
});
