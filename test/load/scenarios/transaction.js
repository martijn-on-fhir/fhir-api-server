import http from 'k6/http';
import {check} from 'k6';
import {SharedArray} from 'k6/data';
import {FHIR_URL, FHIR_HEADERS, DEFAULT_THRESHOLDS} from '../config.js';

const seedIds = new SharedArray('seedIds', () => [JSON.parse(open('../.seed-ids.json'))]);
const ids = seedIds[0];

export const options = {
  scenarios: {
    transactions: {
      executor: 'ramping-rate',
      startRate: 1,
      stages: [
        {target: 10, duration: '15s'},
        {target: 30, duration: '30s'},
        {target: 30, duration: '30s'},
        {target: 0, duration: '15s'},
      ],
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    http_req_duration: ['p(95)<2000'],  // Transactions are heavier — 2s p95
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Builds a transaction bundle with 10 entries: a mix of creates and reads. */
function buildTransactionBundle() {
  const patientId = pick(ids.patients);
  const entries = [];

  // 5x Create Observation with urn:uuid references
  for (let i = 0; i < 5; i++) {
    const fullUrl = `urn:uuid:obs-${__VU}-${__ITER}-${i}`;
    entries.push({
      fullUrl,
      resource: {
        resourceType: 'Observation', status: 'final',
        code: {coding: [{system: 'http://loinc.org', code: '8867-4', display: 'Heart rate'}]},
        subject: {reference: `Patient/${patientId}`},
        effectiveDateTime: new Date().toISOString(),
        valueQuantity: {value: Math.round(60 + Math.random() * 40), unit: '/min', system: 'http://unitsofmeasure.org', code: '/min'},
      },
      request: {method: 'POST', url: 'Observation'},
    });
  }

  // 3x Read existing resources
  entries.push({request: {method: 'GET', url: `Patient/${patientId}`}});
  entries.push({request: {method: 'GET', url: `Observation?patient=Patient/${patientId}&_count=5`}});
  entries.push({request: {method: 'GET', url: `Encounter?patient=Patient/${patientId}&_count=3`}});

  // 2x Create Condition
  for (let i = 0; i < 2; i++) {
    entries.push({
      resource: {
        resourceType: 'Condition',
        clinicalStatus: {coding: [{system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active'}]},
        verificationStatus: {coding: [{system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed'}]},
        code: {coding: [{system: 'http://snomed.info/sct', code: '73211009', display: 'Diabetes mellitus'}]},
        subject: {reference: `Patient/${patientId}`},
        onsetDateTime: new Date().toISOString().split('T')[0],
      },
      request: {method: 'POST', url: 'Condition'},
    });
  }

  return {resourceType: 'Bundle', type: 'transaction', entry: entries};
}

/** Builds a batch bundle (independent entries, no atomicity). */
function buildBatchBundle() {
  const entries = [];

  // 5x Read random patients
  for (let i = 0; i < 5; i++) {
    entries.push({request: {method: 'GET', url: `Patient/${pick(ids.patients)}`}});
  }

  // 3x Read random observations
  for (let i = 0; i < 3; i++) {
    entries.push({request: {method: 'GET', url: `Observation/${pick(ids.observations)}`}});
  }

  // 2x Create observations
  for (let i = 0; i < 2; i++) {
    entries.push({
      resource: {
        resourceType: 'Observation', status: 'final',
        code: {coding: [{system: 'http://loinc.org', code: '29463-7', display: 'Body weight'}]},
        subject: {reference: `Patient/${pick(ids.patients)}`},
        effectiveDateTime: new Date().toISOString(),
        valueQuantity: {value: Math.round(50 + Math.random() * 50), unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg'},
      },
      request: {method: 'POST', url: 'Observation'},
    });
  }

  return {resourceType: 'Bundle', type: 'batch', entry: entries};
}

export default function () {
  const isTransaction = Math.random() < 0.5;
  const bundle = isTransaction ? buildTransactionBundle() : buildBatchBundle();
  const res = http.post(FHIR_URL, JSON.stringify(bundle), {headers: FHIR_HEADERS});

  check(res, {
    'status is 200': (r) => r.status === 200,
    'is Bundle': (r) => r.json('resourceType') === 'Bundle',
    'has entries': (r) => {
      const entry = r.json('entry');
      return Array.isArray(entry) && entry.length > 0;
    },
  });
}
