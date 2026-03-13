import { generateKeyPairSync, createPublicKey } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as express from 'express';
import * as jwt from 'jsonwebtoken';
import * as http from 'http';
import * as request from 'supertest';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';
import { FhirModule } from '../src/fhir/fhir.module';
import { SmartAuthGuard } from '../src/fhir/guards/smart-auth.guard';
import { SMART_CONFIG, SmartConfig } from '../src/fhir/smart/smart-config';
import { SmartModule } from '../src/fhir/smart/smart.module';
import { seedSearchParameters } from './helpers/seed-search-params';

/**
 * E2e tests for SMART on FHIR / OAuth2 authentication and authorization.
 * Uses an in-memory JWKS server and RSA key pair for token signing/validation.
 */
describe('SMART on FHIR Auth (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let jwksServer: http.Server;
  let privateKey: string;
  let kid: string;

  beforeAll(async () => {
    // Generate RSA key pair for JWT signing
    const { publicKey: pubKey, privateKey: privKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    privateKey = privKey;
    kid = 'test-key-1';

    // Convert public key to JWK for JWKS endpoint
    const jwk = createPublicKey(pubKey).export({ format: 'jwk' });

    // Start a minimal JWKS server
    jwksServer = http.createServer((req, res) => {
      if (req.url === '/certs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const jwksPort = await new Promise<number>((resolve) => {
      jwksServer.listen(0, () => resolve((jwksServer.address() as any).port));
    });

    // Build SMART config directly — no env vars needed
    const smartConfig: SmartConfig = {
      enabled: true,
      issuer: 'https://auth.example.com',
      audience: 'fhir-api',
      jwksUri: `http://localhost:${jwksPort}/certs`,
      scopeClaim: 'scope',
      authorizeUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
    };

    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule, SmartModule],
      providers: [{ provide: APP_GUARD, useClass: SmartAuthGuard }],
    })
      .overrideProvider(SMART_CONFIG)
      .useValue(smartConfig)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();
  }, 60_000);

  afterAll(async () => {
    jwksServer?.close();
    await app?.close();
    await mongod?.stop();
  }, 30_000);

  /** Helper to create a signed JWT with given claims. */
  const createToken = (claims: Record<string, any> = {}, expiresIn: any = '5m'): string => {
    return jwt.sign({ iss: 'https://auth.example.com', aud: 'fhir-api', sub: 'user-123', ...claims }, privateKey, { algorithm: 'RS256', keyid: kid, expiresIn } as jwt.SignOptions);
  };

  // -- Public endpoints (no auth required) --

  it('GET /fhir/metadata should be accessible without token', async () => {
    const res = await request(app.getHttpServer()).get('/fhir/metadata');
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('CapabilityStatement');
  });

  it('GET /fhir/metadata CapabilityStatement should include SMART security info', async () => {
    const res = await request(app.getHttpServer()).get('/fhir/metadata');
    const security = res.body.rest?.[0]?.security;
    expect(security).toBeDefined();
    expect(security.service[0].coding[0].code).toBe('SMART-on-FHIR');
  });

  it('GET /.well-known/smart-configuration should return SMART config', async () => {
    const res = await request(app.getHttpServer()).get('/.well-known/smart-configuration');
    expect(res.status).toBe(200);
    expect(res.body.authorization_endpoint).toBe('https://auth.example.com/authorize');
    expect(res.body.token_endpoint).toBe('https://auth.example.com/token');
    expect(res.body.scopes_supported).toContain('patient/*.read');
    expect(res.body.capabilities).toContain('launch-standalone');
  });

  // -- Unauthenticated requests --

  it('GET /fhir/Patient without token should return 401', async () => {
    const res = await request(app.getHttpServer()).get('/fhir/Patient');
    expect(res.status).toBe(401);
    expect(res.body.resourceType).toBe('OperationOutcome');
  });

  it('GET /fhir/Patient with invalid token should return 401', async () => {
    const res = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
    expect(res.body.resourceType).toBe('OperationOutcome');
  });

  // -- Scope enforcement --

  it('GET /fhir/Patient with Patient.read scope should succeed', async () => {
    const token = createToken({ scope: 'patient/Patient.read' });
    const res = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('GET /fhir/Patient with Patient.write scope (wrong) should return 403', async () => {
    const token = createToken({ scope: 'patient/Patient.write' });
    const res = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.resourceType).toBe('OperationOutcome');
  });

  it('POST /fhir/Patient with Patient.read scope (insufficient) should return 403', async () => {
    const token = createToken({ scope: 'patient/Patient.read' });
    const res = await request(app.getHttpServer()).post('/fhir/Patient').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient' });
    expect(res.status).toBe(403);
  });

  it('POST /fhir/Patient with Patient.write scope should succeed (create)', async () => {
    const token = createToken({ scope: 'patient/Patient.write' });
    const res = await request(app.getHttpServer()).post('/fhir/Patient').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', name: [{ family: 'Test' }] });
    expect(res.status).toBe(201);
  });

  it('Wildcard scope system/*.read should grant read access to any resource type', async () => {
    const token = createToken({ scope: 'system/*.read' });
    const patientRes = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', `Bearer ${token}`);
    expect(patientRes.status).toBe(200);

    const observationRes = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
    expect(observationRes.status).toBe(200);
  });

  it('Wildcard permission patient/Patient.* should grant both read and write', async () => {
    const token = createToken({ scope: 'patient/Patient.*' });
    const readRes = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', `Bearer ${token}`);
    expect(readRes.status).toBe(200);

    const writeRes = await request(app.getHttpServer()).post('/fhir/Patient').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', name: [{ family: 'Test2' }] });
    expect(writeRes.status).toBe(201);
  });

  it('Multiple scopes should grant access to all covered resource types', async () => {
    const token = createToken({ scope: 'patient/Patient.read patient/Observation.read' });
    const patientRes = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', `Bearer ${token}`);
    expect(patientRes.status).toBe(200);

    const observationRes = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
    expect(observationRes.status).toBe(200);
  });

  it('GET /fhir/Observation with only Patient.read scope should return 403', async () => {
    const token = createToken({ scope: 'patient/Patient.read' });
    const res = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  // -- Token expiry --

  it('Expired token should return 401', async () => {
    const token = createToken({}, '-1s');
    const res = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // -- POST _search and $validate should be treated as read --

  it('POST _search should require read scope, not write', async () => {
    const token = createToken({ scope: 'patient/Patient.read' });
    const res = await request(app.getHttpServer()).post('/fhir/Patient/_search').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/x-www-form-urlencoded').send('name=Test');
    // Should not be 403 — _search is a read operation
    expect(res.status).not.toBe(403);
  });

  // -- Patient-context filtering --

  describe('Patient-context filtering', () => {
    let patientId: string;
    let otherPatientId: string;
    let observationId: string;

    beforeAll(async () => {
      // Create two patients and an observation using system-level write scope
      const sysToken = createToken({ scope: 'system/*.write system/*.read' });

      const p1 = await request(app.getHttpServer()).post('/fhir/Patient').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', name: [{ family: 'ContextPatient' }] });
      patientId = p1.body.id;

      const p2 = await request(app.getHttpServer()).post('/fhir/Patient').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', name: [{ family: 'OtherPatient' }] });
      otherPatientId = p2.body.id;

      const obs = await request(app.getHttpServer()).post('/fhir/Observation').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Observation', status: 'final', code: { text: 'test' }, subject: { reference: `Patient/${patientId}` } });
      observationId = obs.body.id;
    });

    it('should only return the authorized patient in Patient search', async () => {
      const token = createToken({ scope: 'patient/Patient.read', patient: patientId });
      const res = await request(app.getHttpServer()).get('/fhir/Patient').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.resourceType).toBe('Bundle');

      const ids = res.body.entry?.map((e: any) => e.resource.id) || [];
      expect(ids).toContain(patientId);
      expect(ids).not.toContain(otherPatientId);
    });

    it('should allow reading the authorized patient by id', async () => {
      const token = createToken({ scope: 'patient/Patient.read', patient: patientId });
      const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(patientId);
    });

    it('should deny reading another patient by id', async () => {
      const token = createToken({ scope: 'patient/Patient.read', patient: patientId });
      const res = await request(app.getHttpServer()).get(`/fhir/Patient/${otherPatientId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('should only return observations linked to the authorized patient', async () => {
      const token = createToken({ scope: 'patient/Observation.read', patient: patientId });
      const res = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const entries = res.body.entry || [];

      for (const entry of entries) {
        expect(entry.resource.subject?.reference).toContain(`Patient/${patientId}`);
      }
    });

    it('should allow reading an observation linked to the authorized patient', async () => {
      const token = createToken({ scope: 'patient/Observation.read', patient: patientId });
      const res = await request(app.getHttpServer()).get(`/fhir/Observation/${observationId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });
});
