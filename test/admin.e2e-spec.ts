import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(process.cwd(), 'fixtures');

describe('Admin endpoints (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  const testPatient = { resourceType: 'Patient', meta: { versionId: '1', lastUpdated: '2026-01-01T00:00:00Z' }, name: [{ family: 'Test', given: ['Jan'] }] };

  beforeAll(async () => {
    if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.SERVER_SNAPSHOT_ENABLED = 'true';
    process.env.SERVER_RESTORE_ENABLED = 'true';
    process.env.SERVER_REINDEX_ENABLED = 'true';
    process.env.SERVER_EXPUNGE_ENABLED = 'true';
    process.env.SERVER_CASCADE_DELETE_ENABLED = 'true';

    const { AppModule } = await import('./../src/app.module');
    const { FhirExceptionFilter } = await import('./../src/fhir/filters/fhir-exception.filter');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();

    const express = require('express');
    app.use(express.json({ type: ['application/json', 'application/fhir+json'], limit: '50mb' }));
    app.useGlobalFilters(new FhirExceptionFilter());

    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('POST /admin/snapshot on empty database returns summary and creates file', async () => {
    const res = await request(app.getHttpServer()).post('/admin/snapshot').expect(200);
    expect(res.body.filename).toBe('test-data.json');
    expect(res.body.resources).toBe(0);
    expect(res.body.history).toBe(0);
    expect(res.body.exportedAt).toBeDefined();

    const filePath = join(FIXTURES_DIR, res.body.filename);
    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.resources).toEqual([]);
    expect(data.history).toEqual([]);
  });

  it('POST /admin/snapshot includes created FHIR resources and shows resourceType breakdown', async () => {
    await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json').send(testPatient).expect(201);

    const res = await request(app.getHttpServer()).post('/admin/snapshot').expect(200);
    expect(res.body.resources).toBeGreaterThanOrEqual(1);
    expect(res.body.history).toBeGreaterThanOrEqual(1);
    expect(res.body.resourceTypes.Patient).toBeGreaterThanOrEqual(1);

    const data = JSON.parse(readFileSync(join(FIXTURES_DIR, res.body.filename), 'utf-8'));
    const patient = data.resources.find((r: any) => r.resourceType === 'Patient');
    expect(patient).toBeDefined();
    expect(patient.name[0].family).toBe('Test');
  });

  it('POST /admin/restore reads snapshot file and restores data', async () => {
    const snapshotRes = await request(app.getHttpServer()).post('/admin/snapshot').expect(200);

    const extraRes = await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', meta: { versionId: '1', lastUpdated: '2026-01-01T00:00:00Z' }, name: [{ family: 'Extra' }] }).expect(201);
    const extraId = extraRes.body.id;

    const restoreRes = await request(app.getHttpServer()).post('/admin/restore').set('Content-Type', 'application/json').send({ filename: snapshotRes.body.filename }).expect(200);
    expect(restoreRes.body.resourceType).toBe('OperationOutcome');
    expect(restoreRes.body.issue[0].severity).toBe('information');

    await request(app.getHttpServer()).get(`/fhir/Patient/${extraId}`).expect(404);
  });

  it('POST /admin/restore without filename returns 400', async () => {
    const res = await request(app.getHttpServer()).post('/admin/restore').set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(400);
    expect(res.body.issue[0].diagnostics).toContain('filename');
  });

  it('POST /admin/restore with non-existent file returns 400', async () => {
    const res = await request(app.getHttpServer()).post('/admin/restore').set('Content-Type', 'application/json').send({ filename: 'does-not-exist.json' });
    expect(res.status).toBe(400);
    expect(res.body.issue).toBeDefined();
  });

  it('roundtrip: create data, snapshot, modify, restore, verify original state', async () => {
    const emptySnap = await request(app.getHttpServer()).post('/admin/snapshot').expect(200);
    await request(app.getHttpServer()).post('/admin/restore').send({ filename: emptySnap.body.filename }).expect(200);

    const createRes = await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', meta: { versionId: '1', lastUpdated: '2026-01-01T00:00:00Z' }, name: [{ family: 'Original' }] }).expect(201);
    const originalId = createRes.body.id;

    const snapshot = await request(app.getHttpServer()).post('/admin/snapshot').expect(200);

    const extraRes = await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', meta: { versionId: '1', lastUpdated: '2026-01-01T00:00:00Z' }, name: [{ family: 'New' }] }).expect(201);
    const extraId = extraRes.body.id;

    await request(app.getHttpServer()).post('/admin/restore').send({ filename: snapshot.body.filename }).expect(200);

    const patientRes = await request(app.getHttpServer()).get(`/fhir/Patient/${originalId}`).expect(200);
    expect(patientRes.body.name[0].family).toBe('Original');

    await request(app.getHttpServer()).get(`/fhir/Patient/${extraId}`).expect(404);
  });
});
