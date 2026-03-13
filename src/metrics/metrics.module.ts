import { Global, Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { makeCounterProvider, makeHistogramProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { MetricsInterceptor } from './metrics.interceptor';

const metricProviders = [
  makeCounterProvider({ name: 'fhir_requests_total', help: 'Total number of FHIR HTTP requests', labelNames: ['method', 'route', 'status'] }),
  makeHistogramProvider({ name: 'fhir_request_duration_seconds', help: 'FHIR HTTP request duration in seconds', labelNames: ['method', 'route', 'status'], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] }),
  makeHistogramProvider({ name: 'fhir_search_duration_seconds', help: 'FHIR search query duration in seconds', labelNames: ['resourceType'], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] }),
  makeHistogramProvider({ name: 'fhir_validation_duration_seconds', help: 'FHIR resource validation duration in seconds', labelNames: ['resourceType'], buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5] }),
  makeCounterProvider({ name: 'fhir_bundle_entries_total', help: 'Total number of bundle entries processed', labelNames: ['type', 'method'] }),
  makeGaugeProvider({ name: 'fhir_subscriptions_active', help: 'Number of active FHIR subscriptions' }),
];

/** Global Prometheus metrics module. Exposes /metrics endpoint and provides FHIR-specific counters/histograms to all modules. */
@Global()
@Module({
  imports: [PrometheusModule.register({ path: '/metrics', defaultMetrics: { enabled: true } })],
  providers: [MetricsInterceptor, ...metricProviders],
  exports: [MetricsInterceptor, ...metricProviders],
})
export class MetricsModule {}
