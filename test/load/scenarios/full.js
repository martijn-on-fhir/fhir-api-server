import http from 'k6/http';
import {check, sleep} from 'k6';
import {SharedArray} from 'k6/data';
import {FHIR_URL, FHIR_HEADERS} from '../config.js';

const seedIds = new SharedArray('seedIds', () => [JSON.parse(open('../.seed-ids.json'))]);
const ids = seedIds[0];

/**
 * Full load test: runs all scenario types simultaneously to simulate realistic mixed traffic.
 * - readers: high-frequency single resource reads
 * - searchers: moderate-frequency search queries
 * - writers: low-frequency creates and updates
 */
export const options = {
  scenarios: {
    readers: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'readScenario',
    },
    searchers: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 30,
      maxVUs: 100,
      exec: 'searchScenario',
    },
    writers: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: 'writeScenario',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    'http_req_duration{scenario:readers}': ['p(95)<200'],
    'http_req_duration{scenario:searchers}': ['p(95)<500'],
    'http_req_duration{scenario:writers}': ['p(95)<1000'],
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function readScenario() {
  const roll = Math.random();
  let url;

  if (roll < 0.4) {
    url = `${FHIR_URL}/Patient/${pick(ids.patients)}`;
  } else if (roll < 0.7) {
    url = `${FHIR_URL}/Observation/${pick(ids.observations)}`;
  } else if (roll < 0.9) {
    url = `${FHIR_URL}/Encounter/${pick(ids.encounters)}`;
  } else {
    url = `${FHIR_URL}/metadata`;
  }

  const res = http.get(url, {headers: FHIR_HEADERS});
  check(res, {'read ok': (r) => r.status === 200});
}

export function searchScenario() {
  const roll = Math.random();
  let url;

  if (roll < 0.25) {
    url = `${FHIR_URL}/Patient?name=Jan&_count=20`;
  } else if (roll < 0.5) {
    url = `${FHIR_URL}/Observation?patient=Patient/${pick(ids.patients)}&_sort=-date&_count=10`;
  } else if (roll < 0.75) {
    url = `${FHIR_URL}/Encounter?patient=Patient/${pick(ids.patients)}&_count=20`;
  } else {
    url = `${FHIR_URL}/Condition?patient=Patient/${pick(ids.patients)}&_include=Condition:subject`;
  }

  const res = http.get(url, {headers: FHIR_HEADERS});
  check(res, {'search ok': (r) => r.status === 200, 'is Bundle': (r) => r.json('resourceType') === 'Bundle'});
}

export function writeScenario() {
  const roll = Math.random();

  if (roll < 0.7) {
    // Create Observation
    const body = JSON.stringify({
      resourceType: 'Observation', status: 'final',
      code: {coding: [{system: 'http://loinc.org', code: '8867-4', display: 'Heart rate'}]},
      subject: {reference: `Patient/${pick(ids.patients)}`},
      effectiveDateTime: new Date().toISOString(),
      valueQuantity: {value: Math.round(60 + Math.random() * 40), unit: '/min', system: 'http://unitsofmeasure.org', code: '/min'},
    });
    const res = http.post(`${FHIR_URL}/Observation`, body, {headers: FHIR_HEADERS});
    check(res, {'create ok': (r) => r.status === 201});
  } else {
    // Update Patient
    const patientId = pick(ids.patients);
    const readRes = http.get(`${FHIR_URL}/Patient/${patientId}`, {headers: FHIR_HEADERS});
    if (readRes.status === 200) {
      const patient = readRes.json();
      patient.name = [{family: 'LoadTest', given: ['Updated']}];
      const etag = readRes.headers['Etag'] || readRes.headers['etag'] || '';
      const res = http.put(`${FHIR_URL}/Patient/${patientId}`, JSON.stringify(patient), {headers: {...FHIR_HEADERS, 'If-Match': etag}});
      check(res, {'update ok': (r) => r.status === 200});
    }
  }
}
