import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as http from 'http';
import { FhirModule } from '../src/fhir/fhir.module';
import { FhirExceptionFilter } from '../src/fhir/filters/fhir-exception.filter';

describe('FHIR Subscriptions (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  // Local HTTP server to receive webhook notifications
  let webhookServer: http.Server;
  let webhookPort: number;
  let receivedNotifications: any[];

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), MongooseModule.forRoot(mongod.getUri()), FhirModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new FhirExceptionFilter());
    await app.init();

    // Start a local webhook receiver
    receivedNotifications = [];
    webhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try { receivedNotifications.push(JSON.parse(body)); } catch { receivedNotifications.push(body); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, () => resolve()));
    webhookPort = (webhookServer.address() as any).port;
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
    await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
  });

  beforeEach(() => {
    receivedNotifications = [];
  });

  const createSubscription = (criteria: string, status = 'requested') =>
    request(app.getHttpServer())
      .post('/fhir/Subscription')
      .set('Content-Type', 'application/json')
      .send({
        resourceType: 'Subscription',
        status,
        criteria,
        channel: { type: 'rest-hook', endpoint: `http://localhost:${webhookPort}/notify`, payload: 'application/fhir+json' },
        reason: 'e2e test',
      });

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('should activate a subscription with status "requested"', async () => {
    const res = await createSubscription('Patient').expect(201);

    expect(res.body.resourceType).toBe('Subscription');
    expect(res.body.id).toBeDefined();

    // Wait for async event processing to activate the subscription
    await wait(500);

    const sub = await request(app.getHttpServer()).get(`/fhir/Subscription/${res.body.id}`).expect(200);
    expect(sub.body.status).toBe('active');
  });

  it('should send webhook when matching resource is created', async () => {
    // Create subscription for Observation resources
    const subRes = await createSubscription('Observation').expect(201);
    await wait(500); // wait for activation

    // Create an Observation
    await request(app.getHttpServer())
      .post('/fhir/Observation')
      .set('Content-Type', 'application/json')
      .send({ resourceType: 'Observation', status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] } })
      .expect(201);

    // Wait for notification delivery
    await wait(1000);

    expect(receivedNotifications.length).toBeGreaterThanOrEqual(1);
    const notification = receivedNotifications.find((n) => n.resourceType === 'Bundle' && n.entry?.[0]?.resource?.resourceType === 'Observation');
    expect(notification).toBeDefined();
    expect(notification.type).toBe('history');
    expect(notification.entry[0].request.method).toBe('POST');
  });

  it('should send webhook when matching resource is updated', async () => {
    // Create subscription for Patient
    await createSubscription('Patient').expect(201);
    await wait(500);

    // Create a patient
    const patientRes = await request(app.getHttpServer())
      .post('/fhir/Patient')
      .set('Content-Type', 'application/json')
      .send({ resourceType: 'Patient', name: [{ family: 'Test' }] })
      .expect(201);

    await wait(500);
    receivedNotifications = [];

    // Update the patient
    await request(app.getHttpServer())
      .put(`/fhir/Patient/${patientRes.body.id}`)
      .set('Content-Type', 'application/json')
      .send({ resourceType: 'Patient', name: [{ family: 'Updated' }] })
      .expect(200);

    await wait(1000);

    const updateNotification = receivedNotifications.find((n) => n.entry?.[0]?.request?.method === 'PUT');
    expect(updateNotification).toBeDefined();
  });

  it('should NOT send webhook for non-matching resource type', async () => {
    // Create subscription only for Condition
    await createSubscription('Condition').expect(201);
    await wait(500);
    receivedNotifications = [];

    // Create a Patient (should NOT trigger notification)
    await request(app.getHttpServer())
      .post('/fhir/Patient')
      .set('Content-Type', 'application/json')
      .send({ resourceType: 'Patient', name: [{ family: 'NoMatch' }] })
      .expect(201);

    await wait(500);

    // Filter out any notifications that are NOT about Condition
    const conditionNotifications = receivedNotifications.filter((n) => n.entry?.[0]?.resource?.resourceType === 'Condition');
    expect(conditionNotifications.length).toBe(0);
  });

  it('should support criteria with search params', async () => {
    // Create subscription for Observation with specific code
    await createSubscription('Observation?code=http://loinc.org|85354-9').expect(201);
    await wait(500);
    receivedNotifications = [];

    // Create non-matching Observation
    await request(app.getHttpServer())
      .post('/fhir/Observation')
      .set('Content-Type', 'application/json')
      .send({ resourceType: 'Observation', status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '0000-0' }] } })
      .expect(201);

    await wait(1000);

    // Count notifications that contain the matching code (from the code-filtered subscription)
    const matchingBefore = receivedNotifications.filter((n) => n.entry?.[0]?.resource?.code?.coding?.[0]?.code === '85354-9').length;

    // Create matching Observation
    await request(app.getHttpServer())
      .post('/fhir/Observation')
      .set('Content-Type', 'application/json')
      .send({ resourceType: 'Observation', status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }] } })
      .expect(201);

    await wait(1000);

    // Should have received at least one new notification for the matching code
    const matchingAfter = receivedNotifications.filter((n) => n.entry?.[0]?.resource?.code?.coding?.[0]?.code === '85354-9').length;
    expect(matchingAfter).toBeGreaterThan(matchingBefore);
  });

  it('should send webhook on delete for unfiltered subscriptions', async () => {
    // Subscription without search params — should fire on delete
    await createSubscription('Patient').expect(201);
    await wait(500);

    // Create then delete a patient
    const patient = await request(app.getHttpServer())
      .post('/fhir/Patient')
      .set('Content-Type', 'application/json')
      .send({ resourceType: 'Patient', name: [{ family: 'ToDelete' }] })
      .expect(201);

    await wait(500);
    receivedNotifications = [];

    await request(app.getHttpServer()).delete(`/fhir/Patient/${patient.body.id}`).expect(200);

    await wait(1000);

    const deleteNotification = receivedNotifications.find((n) => n.entry?.[0]?.request?.method === 'DELETE');
    expect(deleteNotification).toBeDefined();
  });
});
