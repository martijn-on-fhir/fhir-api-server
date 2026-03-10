import { Module } from '@nestjs/common';
import { loadSmartConfig, SMART_CONFIG } from './smart-config';
import { SmartConfigurationController } from './smart-configuration.controller';

/** Module that provides SMART on FHIR configuration and the .well-known endpoint. */
@Module({
  controllers: [SmartConfigurationController],
  providers: [{ provide: SMART_CONFIG, useFactory: loadSmartConfig }],
  exports: [SMART_CONFIG],
})
export class SmartModule {}
