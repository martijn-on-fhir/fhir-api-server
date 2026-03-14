import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return server info', () => {
      const info = appController.getInfo();
      expect(info.name).toBe('FHIR R4 API Server');
      expect(info.fhirVersion).toBe('4.0.1');
    });
  });
});
