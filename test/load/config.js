/** Shared configuration for k6 load test scenarios. */

/** Base URL of the FHIR server under test. Override via K6_BASE_URL env var. */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/** FHIR base path. */
export const FHIR_URL = `${BASE_URL}/fhir`;

/** Common HTTP headers for FHIR requests. */
export const FHIR_HEADERS = {
  'Content-Type': 'application/fhir+json',
  'Accept': 'application/fhir+json',
};

/** Default thresholds applied to all scenarios. */
export const DEFAULT_THRESHOLDS = {
  http_req_failed: ['rate<0.01'],          // < 1% error rate
  http_req_duration: ['p(95)<500'],        // p95 < 500ms
};

/** Stricter thresholds for simple read operations. */
export const READ_THRESHOLDS = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(50)<50', 'p(95)<200', 'p(99)<500'],
};

/** Thresholds for search operations. */
export const SEARCH_THRESHOLDS = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(50)<100', 'p(95)<500', 'p(99)<1000'],
};
