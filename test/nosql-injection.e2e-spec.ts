import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';

describe('NoSQL Injection Prevention (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();

    // Seed a Patient so we can verify injection doesn't leak data
    await request(app.getHttpServer())
      .post('/fhir/Patient')
      .send({ resourceType: 'Patient', name: [{ family: 'Secret' }] })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('should not allow $gt operator injection via search params', async () => {
    // Express can parse ?name[$gt]= into { name: { $gt: '' } } — should be sanitized
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient?name[$gt]=')
      .expect(200);

    expect(res.body.resourceType).toBe('Bundle');
    // Should NOT return the seeded patient via operator injection
    expect(res.body.total).toBe(0);
  });

  it('should not allow $ne operator injection via search params', async () => {
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient?name[$ne]=nonexistent')
      .expect(200);

    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.total).toBe(0);
  });

  it('should not allow $regex injection via search params', async () => {
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient?name[$regex]=.*')
      .expect(200);

    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.total).toBe(0);
  });

  it('should safely handle _content search without $where injection', async () => {
    // This should NOT execute server-side JavaScript
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient?_content=test/;process.exit(1);//')
      .expect(200);

    expect(res.body.resourceType).toBe('Bundle');
    // Server should still be alive
  });

  it('should safely handle regex special chars in string search', async () => {
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient?name=.*Secret.*')
      .expect(200);

    // The regex chars should be escaped, not interpreted — so no match on "Secret"
    expect(res.body.total).toBe(0);
  });

  it('should safely handle history _since injection attempts', async () => {
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient/_history?_since[$gt]=')
      .expect(200);

    expect(res.body.resourceType).toBe('Bundle');
    // Should not crash or leak data
  });

  it('should safely handle history _at injection attempts', async () => {
    const res = await request(app.getHttpServer())
      .get('/fhir/Patient/_history?_at[$ne]=null')
      .expect(200);

    expect(res.body.resourceType).toBe('Bundle');
  });
});
