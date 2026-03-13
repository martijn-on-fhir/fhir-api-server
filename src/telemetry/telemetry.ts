import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Initializes OpenTelemetry tracing when OTEL_ENABLED=true.
 * Must be called before NestJS bootstrap to ensure all modules are instrumented.
 * Exports traces via OTLP HTTP to the endpoint specified by OTEL_EXPORTER_OTLP_ENDPOINT (default: http://localhost:4318).
 */
export function initTelemetry(): NodeSDK | null {
  if (process.env.OTEL_ENABLED !== 'true') {
    return null;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'fhir-api-server', [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.0.0' }),
    traceExporter: new OTLPTraceExporter({ url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-mongoose': { enabled: true }, '@opentelemetry/instrumentation-http': { enabled: true }, '@opentelemetry/instrumentation-express': { enabled: true }, '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });

  sdk.start();

  return sdk;
}
