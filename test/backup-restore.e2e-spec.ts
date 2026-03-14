import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const FIXTURES_DIR = join(process.cwd(), 'fixtures');

/** Check if mongodump CLI is available on this machine. */
const hasMongodump = (): boolean => { try { execSync('mongodump --version', { stdio: 'pipe' }); return true; } catch { return false; } };

/**
 * E2e tests for backup/restore with production-volume data.
 * Creates 50 patients + 100 observations, snapshots, wipes, restores, validates.
 * mongodump tests are skipped if the CLI is not installed.
 */
describe('Backup & Restore (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  const patientIds: string[] = [];
  const observationIds: string[] = [];

  beforeAll(async () => {
    if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.SERVER_SNAPSHOT_ENABLED = 'true';
    process.env.SERVER_RESTORE_ENABLED = 'true';
    process.env.SERVER_BACKUP_ENABLED = 'true';
    process.env.SERVER_BACKUP_RESTORE_ENABLED = 'true';
    process.env.BACKUP_INTERVAL_MS = '0';

    const { AppModule } = await import('./../src/app.module');
    const { FhirExceptionFilter } = await import('./../src/fhir/filters/fhir-exception.filter');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    const express = require('express');
    app.use(express.json({ type: ['application/json', 'application/fhir+json'], limit: '50mb' }));
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();

    // Seed: 50 patients + 100 observations
    for (let i = 0; i < 50; i++) {
      const res = await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json')
        .send({ resourceType: 'Patient', name: [{ family: `BackupTest-${i}` }], gender: i % 2 === 0 ? 'male' : 'female' });
      patientIds.push(res.body.id);
    }

    for (let i = 0; i < 100; i++) {
      const res = await request(app.getHttpServer()).post('/fhir/Observation').set('Content-Type', 'application/fhir+json')
        .send({ resourceType: 'Observation', status: 'final', code: { text: `Test-${i}` }, subject: { reference: `Patient/${patientIds[i % 50]}` } });
      observationIds.push(res.body.id);
    }
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('should have seeded 150+ resources', async () => {
    const res = await request(app.getHttpServer()).get('/admin/db-stats').expect(200);
    expect(res.body.fhir_resources?.count).toBeGreaterThanOrEqual(150);
  });

  it('should snapshot, add data, restore, and verify extra data is gone', async () => {
    // Snapshot current state
    const snapshot = await request(app.getHttpServer()).post('/admin/snapshot').expect(200);
    expect(snapshot.body.resources).toBeGreaterThanOrEqual(150);

    // Add extra patient
    const extra = await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json')
      .send({ resourceType: 'Patient', name: [{ family: 'ShouldDisappear' }] }).expect(201);

    // Verify extra patient exists
    await request(app.getHttpServer()).get(`/fhir/Patient/${extra.body.id}`).expect(200);

    // Restore from snapshot
    await request(app.getHttpServer()).post('/admin/restore').send({ filename: snapshot.body.filename }).expect(200);

    // Extra patient should be gone after restore
    await request(app.getHttpServer()).get(`/fhir/Patient/${extra.body.id}`).expect(404);

    // Search for original patients — should still have BackupTest patients
    const searchRes = await request(app.getHttpServer()).get('/fhir/Patient?name=BackupTest&_count=5').expect(200);
    expect(searchRes.body.total).toBeGreaterThanOrEqual(1);
    expect(searchRes.body.entry[0].resource.name[0].family).toMatch(/^BackupTest/);
  });

  // mongodump/mongorestore tests — skipped if CLI not available
  const describeOrSkip = hasMongodump() ? describe : describe.skip;

  describeOrSkip('mongodump backup (requires mongodump CLI)', () => {
    it('should create a mongodump backup', async () => {
      const res = await request(app.getHttpServer()).post('/admin/backup').expect(200);
      expect(res.body.filename).toMatch(/^fhir-backup-.*\.gz$/);
      expect(res.body.sizeBytes).toBeGreaterThan(0);
      expect(res.body.collections.fhir_resources).toBeGreaterThanOrEqual(150);
    });

    it('should list backups', async () => {
      const res = await request(app.getHttpServer()).get('/admin/backups').expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should restore from mongodump backup', async () => {
      const backups = await request(app.getHttpServer()).get('/admin/backups').expect(200);
      const filename = backups.body[0].filename;

      // Add extra data
      await request(app.getHttpServer()).post('/fhir/Patient').set('Content-Type', 'application/fhir+json')
        .send({ resourceType: 'Patient', name: [{ family: 'WillBeRestored' }] }).expect(201);

      // Restore
      const res = await request(app.getHttpServer()).post('/admin/backup/restore').send({ filename }).expect(200);
      expect(res.body.issue[0].diagnostics).toContain('Restore complete');

      // Search should not find the extra patient
      const search = await request(app.getHttpServer()).get('/fhir/Patient?name=WillBeRestored').expect(200);
      expect(search.body.total).toBe(0);
    });
  });
});
