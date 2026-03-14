// NOTE: This test requires MULTI_TENANT_ENABLED=true set BEFORE module load.
// Run via: npx jest --config ./test/jest-e2e-tenant.json
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as request from 'supertest';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { TenantModule } from '../src/tenant/tenant.module';
import { TenantMiddleware } from '../src/tenant/tenant.middleware';
import { TenantGuard } from '../src/tenant/tenant.guard';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('Tenant Isolation (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  const TENANT_A = 'aaaa-111-bbbb-1';
  const TENANT_B = 'cccc-222-dddd-2';

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule, TenantModule],
      providers: [{ provide: APP_GUARD, useClass: TenantGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());

    // Register TenantMiddleware as Express middleware (before NestJS pipeline)
    const tenantMiddleware = new TenantMiddleware();
    app.use(tenantMiddleware.use.bind(tenantMiddleware));

    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  }, 30000);

  describe('Tenant Admin API', () => {
    it('should register tenant A', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/tenants')
        .send({ id: TENANT_A, name: 'Ziekenhuis A', contactEmail: 'admin@a.nl' })
        .expect(201);

      expect(res.body.id).toBe(TENANT_A);
      expect(res.body.name).toBe('Ziekenhuis A');
      expect(res.body.status).toBe('active');
    });

    it('should register tenant B', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/tenants')
        .send({ id: TENANT_B, name: 'Ziekenhuis B' })
        .expect(201);

      expect(res.body.id).toBe(TENANT_B);
      expect(res.body.status).toBe('active');
    });

    it('should reject invalid tenant ID format', async () => {
      await request(app.getHttpServer())
        .post('/admin/tenants')
        .send({ id: 'invalid-format', name: 'Bad' })
        .expect(400);
    });

    it('should reject duplicate tenant ID', async () => {
      await request(app.getHttpServer())
        .post('/admin/tenants')
        .send({ id: TENANT_A, name: 'Duplicate' })
        .expect(409);
    });

    it('should list all tenants', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/tenants')
        .expect(200);

      expect(res.body.length).toBe(2);
    });

    it('should get tenant details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/tenants/${TENANT_A}`)
        .expect(200);

      expect(res.body.id).toBe(TENANT_A);
      expect(res.body.name).toBe('Ziekenhuis A');
    });
  });

  describe('Data Isolation', () => {
    let patientIdA: string;
    let patientIdB: string;

    it('should create a Patient in tenant A', async () => {
      const res = await request(app.getHttpServer())
        .post(`/t/${TENANT_A}/fhir/Patient`)
        .send({ resourceType: 'Patient', name: [{ family: 'TenantA', given: ['Pieter'] }] })
        .expect(201);

      patientIdA = res.body.id;
      expect(res.body.name[0].family).toBe('TenantA');
    });

    it('should create a Patient in tenant B', async () => {
      const res = await request(app.getHttpServer())
        .post(`/t/${TENANT_B}/fhir/Patient`)
        .send({ resourceType: 'Patient', name: [{ family: 'TenantB', given: ['Jan'] }] })
        .expect(201);

      patientIdB = res.body.id;
      expect(res.body.name[0].family).toBe('TenantB');
    });

    it('should reject /fhir requests without tenant identifier', async () => {
      await request(app.getHttpServer())
        .get('/fhir/Patient')
        .expect(400);
    });

    it('should accept /fhir requests with X-Tenant-Id header', async () => {
      const res = await request(app.getHttpServer())
        .post('/fhir/Patient')
        .set('X-Tenant-Id', TENANT_A)
        .send({ resourceType: 'Patient', name: [{ family: 'ViaHeader', given: ['Test'] }] })
        .expect(201);

      expect(res.body.name[0].family).toBe('ViaHeader');
    });

    it('tenant A should see its own Patients (including header-created)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/t/${TENANT_A}/fhir/Patient`)
        .expect(200);

      expect(res.body.total).toBe(2);
      const families = res.body.entry.map((e: any) => e.resource.name[0].family);
      expect(families).toContain('TenantA');
      expect(families).toContain('ViaHeader');
    });

    it('tenant B should only see its own Patient', async () => {
      const res = await request(app.getHttpServer())
        .get(`/t/${TENANT_B}/fhir/Patient`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.entry[0].resource.name[0].family).toBe('TenantB');
    });

    it('tenant A Patient should not be readable from tenant B', async () => {
      await request(app.getHttpServer())
        .get(`/t/${TENANT_B}/fhir/Patient/${patientIdA}`)
        .expect(404);
    });

    it('tenant B Patient should not be readable from tenant A', async () => {
      await request(app.getHttpServer())
        .get(`/t/${TENANT_A}/fhir/Patient/${patientIdB}`)
        .expect(404);
    });
  });

  describe('Tenant Base URL', () => {
    it('should include tenant prefix in bundle self link', async () => {
      const res = await request(app.getHttpServer())
        .get(`/t/${TENANT_A}/fhir/Patient`)
        .expect(200);

      const selfLink = res.body.link?.find((l: any) => l.relation === 'self');
      expect(selfLink?.url).toContain(`/t/${TENANT_A}/fhir`);
    });

    it('should include tenant prefix when using X-Tenant-Id header', async () => {
      const res = await request(app.getHttpServer())
        .get('/fhir/Patient')
        .set('X-Tenant-Id', TENANT_A)
        .expect(200);

      const selfLink = res.body.link?.find((l: any) => l.relation === 'self');
      expect(selfLink?.url).toContain(`/t/${TENANT_A}/fhir`);
    });
  });

  describe('Tenant Lifecycle', () => {
    it('should suspend tenant A', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/tenants/${TENANT_A}/suspend`)
        .expect(200);

      expect(res.body.status).toBe('suspended');
    });

    it('should reject FHIR requests to suspended tenant', async () => {
      await request(app.getHttpServer())
        .get(`/t/${TENANT_A}/fhir/Patient`)
        .expect(403);
    });

    it('should reactivate tenant A', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/tenants/${TENANT_A}/activate`)
        .expect(200);

      expect(res.body.status).toBe('active');
    });

    it('should allow FHIR requests after reactivation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/t/${TENANT_A}/fhir/Patient`)
        .expect(200);

      expect(res.body.total).toBe(2);
    });

    it('should decommission tenant B', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/tenants/${TENANT_B}`)
        .expect(200);
    });

    it('should return 404 for decommissioned tenant', async () => {
      await request(app.getHttpServer())
        .get(`/t/${TENANT_B}/fhir/Patient`)
        .expect(404);
    });
  });
});
