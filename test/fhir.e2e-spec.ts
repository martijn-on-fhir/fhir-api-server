import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';

describe('FHIR API (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongod.getUri()), FhirModule],
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

    it('should return OperationOutcome for unsupported resource type', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/FakeResource')
        .expect(400);

      expect(res.body.resourceType).toBe('OperationOutcome');
      expect(res.body.issue[0].code).toBe('not-supported');
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

  describe('Content-Type', () => {
    it('should always return application/fhir+json on errors', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Patient/non-existent')
        .expect(404);

      expect(res.headers['content-type']).toContain('application/fhir+json');
    });
  });
});
