import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('FHIR API (e2e)', () => {
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
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  describe('GET /fhir/:resourceType (search)', () => {
    it('should return an empty searchset Bundle', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Patient')
        .expect(200);

      expect(res.headers['content-type']).toContain('application/fhir+json');
      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.type).toBe('searchset');
      expect(res.body.total).toBe(0);
      expect(res.body.entry).toEqual([]);
    });

    it('should return empty Bundle for unknown resource type', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/FakeResource')
        .expect(200);

      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.type).toBe('searchset');
      expect(res.body.total).toBe(0);
    });
  });

  describe('POST /fhir/:resourceType (create)', () => {
    it('should create a Patient and return 201 with Location header', async () => {
      const patient = {
        resourceType: 'Patient',
        name: [{ family: 'Jansen', given: ['Pieter'] }],
        gender: 'male',
        birthDate: '1990-01-15',
      };

      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send(patient)
        .expect(201);

      expect(res.headers['content-type']).toContain('application/fhir+json');
      expect(res.headers['location']).toMatch(/\/fhir\/Patient\/.+/);
      expect(res.headers['etag']).toBe('W/"1"');
      expect(res.body.resourceType).toBe('Patient');
      expect(res.body.id).toBeDefined();
      expect(res.body.meta.versionId).toBe('1');
      expect(res.body.meta.lastUpdated).toBeDefined();
      expect(res.body.name[0].family).toBe('Jansen');
      expect(res.body.gender).toBe('male');
    });
  });

  describe('GET /fhir/:resourceType/:id (read)', () => {
    let patientId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({
          resourceType: 'Patient',
          name: [{ family: 'De Vries', given: ['Anna'] }],
        });
      patientId = res.body.id;
    });

    it('should return the Patient by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/fhir/Patient/${patientId}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/fhir+json');
      expect(res.headers['etag']).toBe('W/"1"');
      expect(res.body.resourceType).toBe('Patient');
      expect(res.body.id).toBe(patientId);
      expect(res.body.name[0].family).toBe('De Vries');
    });

    it('should return 404 OperationOutcome for non-existent id', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Patient/non-existent-id')
        .expect(404);

      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].code).toBe('not-found');
    });
  });

  describe('PUT /fhir/:resourceType/:id (update)', () => {
    let patientId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({
          resourceType: 'Patient',
          name: [{ family: 'Bakker', given: ['Jan'] }],
        });
      patientId = res.body.id;
    });

    it('should update the Patient and increment versionId', async () => {
      const res = await request(app.getHttpServer())
        .put(`/fhir/Patient/${patientId}`)
        .send({
          resourceType: 'Patient',
          name: [{ family: 'Bakker', given: ['Jan', 'Willem'] }],
        })
        .expect(200);

      expect(res.headers['etag']).toBe('W/"2"');
      expect(res.body.meta.versionId).toBe('2');
      expect(res.body.name[0].given).toEqual(['Jan', 'Willem']);
    });
  });

  describe('DELETE /fhir/:resourceType/:id (delete)', () => {
    let patientId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({
          resourceType: 'Patient',
          name: [{ family: 'Smit' }],
        });
      patientId = res.body.id;
    });

    it('should delete the Patient and return OperationOutcome', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/fhir/Patient/${patientId}`)
        .expect(200);

      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].severity).toBe('information');
    });

    it('should return 404 when deleting already deleted resource', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/fhir/Patient/${patientId}`)
        .expect(404);

      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].code).toBe('not-found');
    });
  });

  describe('Search parameters', () => {
    beforeAll(async () => {
      const patients = [
        {
          resourceType: 'Observation',
          code: { text: 'blood-pressure' },
          status: 'final',
        },
        {
          resourceType: 'Observation',
          code: { text: 'heart-rate' },
          status: 'final',
        },
      ];
      for (const p of patients) {
        await request(app.getHttpServer()).post('/fhir/Observation').send(p);
      }
    });

    it('should filter by _id', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'ZoekTest' }] });

      const res = await request(app.getHttpServer())
        .get(`/fhir/Patient?_id=${createRes.body.id}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.entry[0].resource.id).toBe(createRes.body.id);
    });

    it('should respect _count parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Observation?_count=1')
        .expect(200);

      expect(res.body.entry.length).toBe(1);
      expect(res.body.total).toBe(2);
    });

    it('should include search params in self link', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Patient?_sort=name&_count=5')
        .expect(200);

      expect(res.body.link[0].url).toContain('_sort=name');
      expect(res.body.link[0].url).toContain('_count=5');
    });
  });

  describe('Validation', () => {
    it('should reject a request without resourceType', async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ name: [{ family: 'Test' }] })
        .expect(400);

      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].code).toBe('required');
    });

    it('should reject a non-object body', async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send('not json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('should also validate on PUT', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'ValidPut' }] });

      const res = await request(app.getHttpServer())
        .put(`/fhir/Patient/${createRes.body.id}`)
        .send({ name: [{ family: 'MissingResourceType' }] })
        .expect(400);

      expect(res.body.resourceType).toBe('OperationOutcome');
    });
  });

  describe('Conditional CRUD', () => {
    it('should support conditional create with If-None-Exist (no match → create)', async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .set('If-None-Exist', 'identifier=http://test|cond-create-unique-123')
        .send({ resourceType: 'Patient', name: [{ family: 'CondCreate' }], identifier: [{ system: 'http://test', value: 'cond-create-unique-123' }] })
        .expect(201);

      expect(res.body.name[0].family).toBe('CondCreate');
    });

    it('should return existing resource on conditional create with match', async () => {
      // Create first
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'CondExisting' }], identifier: [{ system: 'http://test', value: 'cond-existing-456' }] })
        .expect(201);

      // Conditional create with same identifier → should return existing
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .set('If-None-Exist', 'identifier=http://test|cond-existing-456')
        .send({ resourceType: 'Patient', name: [{ family: 'ShouldNotCreate' }], identifier: [{ system: 'http://test', value: 'cond-existing-456' }] })
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.name[0].family).toBe('CondExisting');
    });

    it('should support If-Match for optimistic locking (correct version)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'IfMatch' }] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .put(`/fhir/Patient/${createRes.body.id}`)
        .set('If-Match', 'W/"1"')
        .send({ resourceType: 'Patient', name: [{ family: 'IfMatchUpdated' }] })
        .expect(200);

      expect(res.body.meta.versionId).toBe('2');
    });

    it('should reject update with wrong If-Match (412 Precondition Failed)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'IfMatchFail' }] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .put(`/fhir/Patient/${createRes.body.id}`)
        .set('If-Match', 'W/"99"')
        .send({ resourceType: 'Patient', name: [{ family: 'ShouldFail' }] })
        .expect(412);

      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('should support conditional update (PUT with search params)', async () => {
      // Create a patient with unique identifier
      await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'CondUpdate' }], identifier: [{ system: 'http://test', value: 'cond-update-789' }] })
        .expect(201);

      // Conditional update
      const res = await request(app.getHttpServer())
        .put('/fhir/Patient?identifier=http://test|cond-update-789')
        .send({ resourceType: 'Patient', name: [{ family: 'CondUpdateV2' }], identifier: [{ system: 'http://test', value: 'cond-update-789' }] })
        .expect(200);

      expect(res.body.name[0].family).toBe('CondUpdateV2');
      expect(res.body.meta.versionId).toBe('2');
    });

    it('should create on conditional update with no match', async () => {
      const res = await request(app.getHttpServer())
        .put('/fhir/Patient?identifier=http://test|nonexistent-xyz')
        .send({ resourceType: 'Patient', name: [{ family: 'CondUpdateNew' }], identifier: [{ system: 'http://test', value: 'nonexistent-xyz' }] })
        .expect(201);

      expect(res.body.name[0].family).toBe('CondUpdateNew');
      expect(res.body.meta.versionId).toBe('1');
    });

    it('should support conditional delete', async () => {
      await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'CondDelete' }], identifier: [{ system: 'http://test', value: 'cond-delete-abc' }] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete('/fhir/Patient?identifier=http://test|cond-delete-abc')
        .expect(200);

      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].diagnostics).toContain('1');
    });
  });

  describe('Content-Type', () => {
    it('should always return application/fhir+json on errors', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Patient/non-existent')
        .expect(404);

      expect(res.headers['content-type']).toContain('application/fhir+json');
    });
  });

  describe('Batch/Transaction Bundle', () => {
    it('should process a batch Bundle with multiple creates', async () => {
      const bundle = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          { resource: { resourceType: 'Patient', name: [{ family: 'BatchA' }] }, request: { method: 'POST', url: 'Patient' } },
          { resource: { resourceType: 'Patient', name: [{ family: 'BatchB' }] }, request: { method: 'POST', url: 'Patient' } },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/fhir')
        .send(bundle)
        .expect(200);

      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.type).toBe('batch-response');
      expect(res.body.entry).toHaveLength(2);
      expect(res.body.entry[0].response.status).toBe('201 Created');
      expect(res.body.entry[1].response.status).toBe('201 Created');
      expect(res.body.entry[0].resource.name[0].family).toBe('BatchA');
    });

    it('should process a transaction Bundle with urn:uuid references', async () => {
      const bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [
          {
            fullUrl: 'urn:uuid:11111111-1111-1111-1111-111111111111',
            resource: { resourceType: 'Patient', name: [{ family: 'TransPatient' }] },
            request: { method: 'POST', url: 'Patient' },
          },
          {
            resource: { resourceType: 'Observation', status: 'final', code: { text: 'test' }, subject: { reference: 'urn:uuid:11111111-1111-1111-1111-111111111111' } },
            request: { method: 'POST', url: 'Observation' },
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/fhir')
        .send(bundle)
        .expect(200);

      expect(res.body.type).toBe('transaction-response');
      expect(res.body.entry).toHaveLength(2);
      // urn:uuid should be resolved to actual Patient reference
      expect(res.body.entry[1].resource.subject.reference).toMatch(/^Patient\//);
    });

    it('should return batch-response with errors for invalid entries', async () => {
      const bundle = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          { resource: { resourceType: 'Patient', name: [{ family: 'Good' }] }, request: { method: 'POST', url: 'Patient' } },
          { request: { method: 'GET', url: 'Patient/nonexistent-batch-id' } },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/fhir')
        .send(bundle)
        .expect(200);

      expect(res.body.entry[0].response.status).toBe('201 Created');
      // Second entry should be an error
      expect(res.body.entry[1].response.status).toBe('404');
    });

    it('should reject non-Bundle POST to /fhir', async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir')
        .send({ resourceType: 'Patient', name: [{ family: 'NotABundle' }] })
        .expect(400);

      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('should support mixed operations in a batch', async () => {
      // Create a patient first
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'BatchMix' }] })
        .expect(201);

      const bundle = {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          { request: { method: 'GET', url: `Patient/${createRes.body.id}` } },
          { resource: { resourceType: 'Patient', name: [{ family: 'BatchMixUpdated' }] }, request: { method: 'PUT', url: `Patient/${createRes.body.id}` } },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/fhir')
        .send(bundle)
        .expect(200);

      expect(res.body.entry[0].response.status).toBe('200 OK');
      expect(res.body.entry[1].response.status).toBe('200 OK');
    });
  });

  describe('Version History', () => {
    let patientId: string;

    beforeAll(async () => {
      // Create a patient, update it twice, so we have 3 versions
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'Historie', given: ['Test'] }] });
      patientId = createRes.body.id;

      await request(app.getHttpServer())
        .put(`/fhir/Patient/${patientId}`)
        .send({ resourceType: 'Patient', name: [{ family: 'Historie', given: ['Test', 'V2'] }] });

      await request(app.getHttpServer())
        .put(`/fhir/Patient/${patientId}`)
        .send({ resourceType: 'Patient', name: [{ family: 'Historie', given: ['Test', 'V3'] }] });
    });

    it('should return instance history Bundle with all versions', async () => {
      const res = await request(app.getHttpServer())
        .get(`/fhir/Patient/${patientId}/_history`)
        .expect(200);

      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.type).toBe('history');
      expect(res.body.total).toBe(3);
      expect(res.body.entry).toHaveLength(3);
      // Most recent first
      expect(res.body.entry[0].resource.meta.versionId).toBe('3');
      expect(res.body.entry[1].resource.meta.versionId).toBe('2');
      expect(res.body.entry[2].resource.meta.versionId).toBe('1');
      // Each entry has request and response
      expect(res.body.entry[0].request.method).toBe('PUT');
      expect(res.body.entry[2].request.method).toBe('POST');
      expect(res.body.entry[2].response.status).toBe('201 Created');
    });

    it('should support vRead for a specific version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/fhir/Patient/${patientId}/_history/1`)
        .expect(200);

      expect(res.headers['etag']).toBe('W/"1"');
      expect(res.body.resourceType).toBe('Patient');
      expect(res.body.meta.versionId).toBe('1');
      expect(res.body.name[0].given).toEqual(['Test']);
    });

    it('should return 404 for non-existent version', async () => {
      const res = await request(app.getHttpServer())
        .get(`/fhir/Patient/${patientId}/_history/999`)
        .expect(404);

      expect(res.body.resourceType).toBe('OperationOutcome');
    });

    it('should return 410 Gone for deleted resource vRead', async () => {
      // Create and delete a patient
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'TeVerwijderen' }] });
      const delId = createRes.body.id;

      await request(app.getHttpServer()).delete(`/fhir/Patient/${delId}`).expect(200);

      // vRead the delete tombstone (version 2)
      const res = await request(app.getHttpServer())
        .get(`/fhir/Patient/${delId}/_history/2`)
        .expect(410);

      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].code).toBe('deleted');
    });

    it('should show deleted entry in instance history without resource body', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .send({ resourceType: 'Patient', name: [{ family: 'HistorieDelete' }] });
      const delId = createRes.body.id;

      await request(app.getHttpServer()).delete(`/fhir/Patient/${delId}`).expect(200);

      const res = await request(app.getHttpServer())
        .get(`/fhir/Patient/${delId}/_history`)
        .expect(200);

      expect(res.body.total).toBe(2);
      // Most recent = DELETE tombstone (no resource body)
      expect(res.body.entry[0].request.method).toBe('DELETE');
      expect(res.body.entry[0].resource).toBeUndefined();
      // Original version has resource body
      expect(res.body.entry[1].request.method).toBe('POST');
      expect(res.body.entry[1].resource.name[0].family).toBe('HistorieDelete');
    });

    it('should return type-level history', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Patient/_history')
        .expect(200);

      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.type).toBe('history');
      expect(res.body.total).toBeGreaterThan(0);
    });

    it('should return system-level history', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/_history')
        .expect(200);

      expect(res.body.resourceType).toBe('Bundle');
      expect(res.body.type).toBe('history');
      expect(res.body.total).toBeGreaterThan(0);
    });
  });
});
