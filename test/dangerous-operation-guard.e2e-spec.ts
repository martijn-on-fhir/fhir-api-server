import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

describe('Dangerous operation guard (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    // Disable all dangerous operations
    process.env.SERVER_SNAPSHOT_ENABLED = 'false';
    process.env.SERVER_RESTORE_ENABLED = 'false';
    process.env.SERVER_REINDEX_ENABLED = 'false';
    process.env.SERVER_EXPUNGE_ENABLED = 'false';
    process.env.SERVER_CASCADE_DELETE_ENABLED = 'false';

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

  it('POST /admin/snapshot returns 403 when disabled', async () => {
    const res = await request(app.getHttpServer()).post('/admin/snapshot');
    expect(res.status).toBe(403);
    expect(res.body.issue[0].diagnostics).toContain('snapshot');
    expect(res.body.issue[0].diagnostics).toContain('SERVER_SNAPSHOT_ENABLED');
  });

  it('POST /admin/restore returns 403 when disabled', async () => {
    const res = await request(app.getHttpServer()).post('/admin/restore').send({ filename: 'test-data.json' });
    expect(res.status).toBe(403);
    expect(res.body.issue[0].diagnostics).toContain('restore');
  });

  it('POST /fhir/$reindex returns 403 when disabled', async () => {
    const res = await request(app.getHttpServer()).post('/fhir/$reindex');
    expect(res.status).toBe(403);
    expect(res.body.issue[0].diagnostics).toContain('$reindex');
  });

  it('POST /fhir/$expunge returns 403 when disabled', async () => {
    const res = await request(app.getHttpServer()).post('/fhir/$expunge');
    expect(res.status).toBe(403);
    expect(res.body.issue[0].diagnostics).toContain('$expunge');
  });

  it('POST /fhir/Patient/$expunge returns 403 when disabled', async () => {
    const res = await request(app.getHttpServer()).post('/fhir/Patient/$expunge');
    expect(res.status).toBe(403);
    expect(res.body.issue[0].diagnostics).toContain('$expunge');
  });

  it('DELETE with _cascade=delete returns 403 when disabled', async () => {
    const res = await request(app.getHttpServer()).delete('/fhir/Patient/some-id?_cascade=delete');
    expect(res.status).toBe(403);
    expect(res.body.issue[0].diagnostics).toContain('_cascade=delete');
  });

  it('regular FHIR operations still work when dangerous ops are disabled', async () => {
    const res = await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', meta: { versionId: '1', lastUpdated: '2026-01-01T00:00:00Z' }, name: [{ family: 'Test' }] });
    expect(res.status).toBe(201);
  });
});
