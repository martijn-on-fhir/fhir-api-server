import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { config } from '../config/app-config';

/**
 * Initializes OpenTelemetry tracing when enabled via centralized config.
 * Must be called before NestJS bootstrap to ensure all modules are instrumented.
 * Exports traces via OTLP HTTP to the configured endpoint (default: http://localhost:4318).
 */
export const initTelemetry = (): NodeSDK | null => {
  if (!config.telemetry.enabled) {
return null;
}

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'fhir-api-server', [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.0.0' }),
    traceExporter: new OTLPTraceExporter({ url: `${config.telemetry.endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-mongoose': { enabled: true }, '@opentelemetry/instrumentation-http': { enabled: true }, '@opentelemetry/instrumentation-express': { enabled: true }, '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });

  sdk.start();

  return sdk;
}
