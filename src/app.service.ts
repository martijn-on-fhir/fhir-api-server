import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /** Returns server information for the root endpoint. */
  getInfo(): Record<string, any> {
    return {
      name: 'FHIR R4 API Server',
      version: process.env.npm_package_version || '0.0.0',
      fhirVersion: '4.0.1',
      status: 'running',
      endpoints: {
        fhir: '/fhir',
        metadata: '/fhir/metadata',
        health: '/health/live',
        docs: '/api',
      },
    };
  }
}
