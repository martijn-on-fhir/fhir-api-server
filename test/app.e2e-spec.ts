import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { seedSearchParameters } from './helpers/seed-search-params';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await seedSearchParameters(mongod.getUri());

    // Must set env var before importing AppModule so MongooseModule.forRoot() picks it up
    process.env.MONGODB_URI = mongod.getUri();
    const { AppModule } = await import('./../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});