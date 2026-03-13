import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/** Loads telemetry config from app-config.json. Env vars take precedence. */
const loadTelemetryConfig = (): { enabled: boolean; endpoint: string } => {
  let fileConfig: any = {};

  try {
 fileConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'config/app-config.json'), 'utf-8')).telemetry || {}; 
} catch { /* no config file */ }

  return {
    enabled: process.env.OTEL_ENABLED === 'true' || fileConfig.enabled === true,
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || fileConfig.endpoint || 'http://localhost:4318',
  };
}

/**
 * Initializes OpenTelemetry tracing when enabled via config or OTEL_ENABLED=true.
 * Must be called before NestJS bootstrap to ensure all modules are instrumented.
 * Exports traces via OTLP HTTP to the configured endpoint (default: http://localhost:4318).
 */
export const initTelemetry = (): NodeSDK | null => {
  const config = loadTelemetryConfig();

  if (!config.enabled) {
return null;
}

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'fhir-api-server', [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.0.0' }),
    traceExporter: new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-mongoose': { enabled: true }, '@opentelemetry/instrumentation-http': { enabled: true }, '@opentelemetry/instrumentation-express': { enabled: true }, '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });

  sdk.start();

  return sdk;
}
