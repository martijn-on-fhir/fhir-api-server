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

describe('Consent Enforcement (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let jwksServer: http.Server;
  let privateKey: string;
  let kid: string;
  let patientId: string;
  let observationId: string;
  let observationId2: string;

  const createToken = (claims: Record<string, any> = {}): string => jwt.sign({ iss: 'https://auth.example.com', aud: 'fhir-api', sub: 'user-1', scope: 'patient/Patient.read patient/Patient.write patient/Observation.read patient/Observation.write patient/Consent.read patient/Consent.write patient/Condition.read', ...claims }, privateKey, { algorithm: 'RS256', keyid: kid, expiresIn: '5m' } as jwt.SignOptions);

  beforeAll(async () => {
    const { publicKey: pubKey, privateKey: privKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    privateKey = privKey;
    kid = 'consent-test-key';

    const jwk = createPublicKey(pubKey).export({ format: 'jwk' });
    jwksServer = http.createServer((req, res) => {
      if (req.url === '/certs') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] })); }
      else { res.writeHead(404); res.end(); }
    });

    const jwksPort = await new Promise<number>((resolve) => { jwksServer.listen(0, () => resolve((jwksServer.address() as any).port)); });
    const smartConfig: SmartConfig = { enabled: true, issuer: 'https://auth.example.com', audience: 'fhir-api', jwksUri: `http://localhost:${jwksPort}/certs`, scopeClaim: 'scope', authorizeUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token' };

    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule, SmartModule],
      providers: [{ provide: APP_GUARD, useClass: SmartAuthGuard }],
    }).overrideProvider(SMART_CONFIG).useValue(smartConfig).compile();

    app = moduleFixture.createNestApplication();
    app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();

    // Seed: create a patient, two observations
    const sysToken = createToken({ scope: 'system/*.write system/*.read' });
    const p = await request(app.getHttpServer()).post('/fhir/Patient').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Patient', name: [{ family: 'ConsentTest' }] });
    patientId = p.body.id;

    const obs1 = await request(app.getHttpServer()).post('/fhir/Observation').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Observation', status: 'final', code: { text: 'BP' }, subject: { reference: `Patient/${patientId}` } });
    observationId = obs1.body.id;

    const obs2 = await request(app.getHttpServer()).post('/fhir/Observation').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({ resourceType: 'Observation', status: 'final', code: { text: 'HR' }, subject: { reference: `Patient/${patientId}` } });
    observationId2 = obs2.body.id;
  }, 60_000);

  afterAll(async () => {
    jwksServer?.close();
    await app?.close();
    await mongod?.stop();
  }, 30_000);

  it('should allow full access when no Consent exists (opt-in model)', async () => {
    const token = createToken({ patient: patientId });
    const res = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.entry?.length).toBeGreaterThanOrEqual(2);
  });

  describe('with deny Consent for Observation resource type', () => {
    let consentId: string;

    beforeAll(async () => {
      const sysToken = createToken({ scope: 'system/*.write system/*.read' });
      const consent = await request(app.getHttpServer()).post('/fhir/Consent').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({
        resourceType: 'Consent', status: 'active',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
        category: [{ coding: [{ code: 'patient-privacy' }] }],
        patient: { reference: `Patient/${patientId}` },
        provision: { type: 'deny', class: [{ code: 'Observation' }] },
      });
      consentId = consent.body.id;
    });

    afterAll(async () => {
      const sysToken = createToken({ scope: 'system/*.write system/*.read' });
      await request(app.getHttpServer()).delete(`/fhir/Consent/${consentId}`).set('Authorization', `Bearer ${sysToken}`);
    });

    it('should block search for denied resource type', async () => {
      const token = createToken({ patient: patientId });
      const res = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });

    it('should block read of denied resource type', async () => {
      const token = createToken({ patient: patientId });
      const res = await request(app.getHttpServer()).get(`/fhir/Observation/${observationId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('should still allow access to non-denied resource types', async () => {
      const token = createToken({ patient: patientId });
      const res = await request(app.getHttpServer()).get(`/fhir/Patient/${patientId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  describe('with deny Consent for specific resource', () => {
    let consentId: string;

    beforeAll(async () => {
      const sysToken = createToken({ scope: 'system/*.write system/*.read' });
      const consent = await request(app.getHttpServer()).post('/fhir/Consent').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({
        resourceType: 'Consent', status: 'active',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
        category: [{ coding: [{ code: 'patient-privacy' }] }],
        patient: { reference: `Patient/${patientId}` },
        provision: { type: 'deny', data: [{ meaning: 'instance', reference: { reference: `Observation/${observationId}` } }] },
      });
      consentId = consent.body.id;
    });

    afterAll(async () => {
      const sysToken = createToken({ scope: 'system/*.write system/*.read' });
      await request(app.getHttpServer()).delete(`/fhir/Consent/${consentId}`).set('Authorization', `Bearer ${sysToken}`);
    });

    it('should exclude specific denied resource from search', async () => {
      const token = createToken({ patient: patientId });
      const res = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const ids = (res.body.entry || []).map((e: any) => e.resource.id);
      expect(ids).not.toContain(observationId);
      expect(ids).toContain(observationId2);
    });

    it('should block read of specific denied resource', async () => {
      const token = createToken({ patient: patientId });
      const res = await request(app.getHttpServer()).get(`/fhir/Observation/${observationId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('should allow read of non-denied resource', async () => {
      const token = createToken({ patient: patientId });
      const res = await request(app.getHttpServer()).get(`/fhir/Observation/${observationId2}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  it('should ignore inactive Consent resources', async () => {
    const sysToken = createToken({ scope: 'system/*.write system/*.read' });
    const consent = await request(app.getHttpServer()).post('/fhir/Consent').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({
      resourceType: 'Consent', status: 'inactive',
      scope: { coding: [{ code: 'patient-privacy' }] },
      patient: { reference: `Patient/${patientId}` },
      provision: { type: 'deny', class: [{ code: 'Observation' }] },
    });

    const token = createToken({ patient: patientId });
    const res = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.entry?.length).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer()).delete(`/fhir/Consent/${consent.body.id}`).set('Authorization', `Bearer ${sysToken}`);
  });

  it('should enforce actor-based denial', async () => {
    const sysToken = createToken({ scope: 'system/*.write system/*.read' });
    const consent = await request(app.getHttpServer()).post('/fhir/Consent').set('Authorization', `Bearer ${sysToken}`).set('Content-Type', 'application/fhir+json').send({
      resourceType: 'Consent', status: 'active',
      scope: { coding: [{ code: 'patient-privacy' }] },
      patient: { reference: `Patient/${patientId}` },
      provision: { type: 'deny', actor: [{ role: { coding: [{ code: 'PRCP' }] }, reference: { reference: 'Practitioner/dr-blocked' } }], class: [{ code: 'Observation' }] },
    });

    // Token with fhirUser=Practitioner/dr-blocked should be denied
    const blockedToken = createToken({ patient: patientId, fhirUser: 'Practitioner/dr-blocked' });
    const blockedRes = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${blockedToken}`);
    expect(blockedRes.body.total).toBe(0);

    // Token without fhirUser should be allowed
    const allowedToken = createToken({ patient: patientId });
    const allowedRes = await request(app.getHttpServer()).get('/fhir/Observation').set('Authorization', `Bearer ${allowedToken}`);
    expect(allowedRes.body.entry?.length).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer()).delete(`/fhir/Consent/${consent.body.id}`).set('Authorization', `Bearer ${sysToken}`);
  });
});
